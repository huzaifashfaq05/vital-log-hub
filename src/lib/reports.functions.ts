import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const AnalyzeInput = z.object({ reportId: z.string().uuid() });

type Extracted = {
  patient_name?: string | null;
  hospital?: string | null;
  doctor?: string | null;
  report_date?: string | null;
  report_type?: string | null;
  key_findings?: string[];
  values?: Array<{ name: string; value: string; unit?: string | null; range?: string | null; flag?: "low" | "normal" | "high" | null }>;
  impression?: string | null;
  medicines?: string[];
  follow_up_date?: string | null;
};

const SYSTEM = `You are a careful medical document assistant. Given a single medical report (lab result, prescription, discharge summary, or scan report), extract structured fields and write a short plain-language explanation for a non-medical reader.

Rules:
- Never diagnose. Explain what the report literally says.
- Use simple, warm, non-alarming language. 2-4 short paragraphs max.
- If a value is outside its normal range, mention it neutrally and suggest discussing with a doctor.
- Do NOT invent values. Only report what is in the document. Use null for missing fields.

Return STRICT JSON matching this TypeScript type:
{
  "title": string,           // short human title, e.g. "Complete Blood Count"
  "report_type": "blood_test"|"x_ray"|"mri"|"ct_scan"|"ultrasound"|"ecg"|"echo"|"prescription"|"discharge_summary"|"vaccination"|"pathology"|"dental"|"eye"|"pet_scan"|"tmt"|"spirometry"|"medical_bill"|"other",
  "extracted": {
    "patient_name": string|null,
    "hospital": string|null,
    "doctor": string|null,
    "report_date": string|null,        // ISO date if possible
    "key_findings": string[],
    "values": [{"name": string, "value": string, "unit": string|null, "range": string|null, "flag": "low"|"normal"|"high"|null}],
    "impression": string|null,
    "medicines": string[],
    "follow_up_date": string|null
  },
  "explanation": string      // 2-4 short paragraphs, plain language
}`;

export const analyzeReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AnalyzeInput.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("Missing LOVABLE_API_KEY");

    const { data: report, error: rerr } = await supabase
      .from("reports")
      .select("id, user_id, file_path, file_mime, title")
      .eq("id", data.reportId)
      .single();
    if (rerr || !report) throw new Error("Report not found");
    if (report.user_id !== userId) throw new Error("Forbidden");

    await supabase.from("reports").update({ ai_status: "processing", ai_error: null }).eq("id", report.id);

    try {
      // Load file from private storage as bytes -> base64
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const dl = await supabaseAdmin.storage.from("medical-reports").download(report.file_path);
      if (dl.error || !dl.data) throw new Error("Could not read file");
      const buf = new Uint8Array(await dl.data.arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      const b64 = btoa(bin);
      const mime = report.file_mime || "application/octet-stream";

      const isImage = mime.startsWith("image/");
      const userContent: Array<Record<string, unknown>> = [
        { type: "text", text: "Extract fields and write the explanation for this medical report. Reply with ONLY the JSON object, no prose, no markdown fences." },
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
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: SYSTEM },
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

      const update: Record<string, unknown> = {
        ai_status: "done",
        explanation: parsed.explanation ?? null,
        extracted: parsed.extracted ?? null,
      };
      if (parsed.title) update.title = parsed.title;
      if (parsed.report_type) update.report_type = parsed.report_type;
      if (parsed.extracted?.hospital) update.hospital = parsed.extracted.hospital;
      if (parsed.extracted?.doctor) update.doctor = parsed.extracted.doctor;
      if (parsed.extracted?.report_date) update.report_date = parsed.extracted.report_date;

      await supabase.from("reports").update(update).eq("id", report.id);
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabase.from("reports").update({ ai_status: "error", ai_error: msg }).eq("id", report.id);
      throw err;
    }
  });
