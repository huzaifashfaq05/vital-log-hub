import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AnalyzeInput, RADIOLOGY_SYSTEM_PROMPT, type Extracted } from "./reports.helpers";

export const analyzeReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AnalyzeInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const { data: report, error: rerr } = await supabase
      .from("reports")
      .select("id, user_id, file_path, file_mime, title, clinical_history, patient_name, patient_age, patient_sex, patient_id_ref, referring_doctor")
      .eq("id", data.reportId)
      .single();
    if (rerr || !report) throw new Error("Report not found");
    if (report.user_id !== userId) throw new Error("Forbidden");

    await supabase.from("reports").update({ ai_status: "processing", ai_error: null }).eq("id", report.id);

    try {
      const dl = await supabase.storage.from("medical-reports").download(report.file_path);
      if (dl.error || !dl.data) throw new Error("Could not read file");
      const buf = new Uint8Array(await dl.data.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      const b64 = btoa(bin);
      const mime = report.file_mime || "application/octet-stream";

      const history = (report.clinical_history ?? "").trim();
      const demographics = [
        report.patient_name ? `Name: ${report.patient_name}` : null,
        report.patient_age ? `Age: ${report.patient_age}` : null,
        report.patient_sex ? `Sex: ${report.patient_sex}` : null,
        report.patient_id_ref ? `Patient ID: ${report.patient_id_ref}` : null,
        report.referring_doctor ? `Referring doctor: ${report.referring_doctor}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      const isImage = mime.startsWith("image/");
      const userContent: Array<Record<string, unknown>> = [
        {
          type: "text",
          text:
            "Analyze this medical image/document as a radiologist. Identify visible anatomy and any abnormalities (fractures, effusions, masses, consolidations, degenerative changes, stones, etc.). Produce the structured radiology report as strict JSON per the schema. Reply with ONLY the JSON object, no prose, no markdown fences." +
            (demographics
              ? `\n\nPatient demographics provided by the user (use these for patient_name and to adjust age/sex-appropriate interpretation):\n"""\n${demographics}\n"""`
              : "") +
            (history
              ? `\n\nPatient clinical history provided by the user (correlate your findings with it, and reflect it in the examination/impression/recommendations where relevant; never treat it as a diagnosis):\n"""\n${history.slice(0, 2000)}\n"""`
              : ""),
        },
      ];


      if (isImage) {
        userContent.push({ type: "image_url", image_url: { url: `data:${mime};base64,${b64}` } });
      } else {
        userContent.push({
          type: "file",
          file: { filename: report.title || "report", file_data: `data:${mime};base64,${b64}` },
        });
      }

      const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: [
            { role: "system", content: RADIOLOGY_SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (resp.status === 429) throw new Error("Rate limit — please try again shortly.");
      if (resp.status === 402) throw new Error("AI credits exhausted. Add credits in Settings.");
      if (!resp.ok) throw new Error(`AI error ${resp.status}: ${await resp.text()}`);

      const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
      const raw = json.choices?.[0]?.message?.content ?? "{}";
      const cleaned = raw.replace(/^```json\s*/i, "").replace(/```\s*$/i, "").trim();
      const parsed = JSON.parse(cleaned) as {
        title?: string;
        report_type?: string;
        extracted?: Extracted;
        explanation?: string;
      };

      const DISCLAIMER =
        "This AI interpretation is for informational purposes only and should be confirmed by a qualified radiologist or physician before making medical decisions.";
      let explanation = parsed.explanation ?? "";
      if (explanation && !explanation.includes("informational purposes only")) {
        explanation = `${explanation.trim()}\n\n${DISCLAIMER}`;
      }

      await supabase
        .from("reports")
        .update({
          ai_status: "done",
          explanation: explanation || null,
          extracted: (parsed.extracted ?? null) as never,
          ...(parsed.title ? { title: parsed.title } : {}),
          ...(parsed.report_type ? { report_type: parsed.report_type as never } : {}),
          ...(parsed.extracted?.hospital ? { hospital: parsed.extracted.hospital } : {}),
          ...(parsed.extracted?.doctor ? { doctor: parsed.extracted.doctor } : {}),
          ...(parsed.extracted?.report_date ? { report_date: parsed.extracted.report_date } : {}),
        })
        .eq("id", report.id);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabase.from("reports").update({ ai_status: "error", ai_error: msg }).eq("id", report.id);
      throw err;
    }
  });
