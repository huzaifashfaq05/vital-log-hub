import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const AnalyzeInput = z.object({ reportId: z.string().uuid() });

type Pathology = {
  name: string;
  location?: string | null;
  description?: string | null;
  severity?: "mild" | "moderate" | "severe" | "unknown" | null;
  confidence?: number | null;
};

type Extracted = {
  patient_name?: string | null;
  hospital?: string | null;
  doctor?: string | null;
  report_date?: string | null;
  report_type?: string | null;

  // Radiology-style structured report
  examination?: string | null;
  technique?: string | null;
  image_quality?: string | null;
  findings?: string[];
  pathologies?: Pathology[];
  impression?: string | null;
  severity?: "none" | "mild" | "moderate" | "severe" | "critical" | "unknown" | null;
  confidence_score?: number | null;
  differential_diagnosis?: string[];
  recommendations?: string[];

  // Legacy / lab-report fields (kept optional)
  key_findings?: string[];
  values?: Array<{ name: string; value: string; unit?: string | null; range?: string | null; flag?: "low" | "normal" | "high" | null }>;
  medicines?: string[];
  follow_up_date?: string | null;
};

const SYSTEM = `You are an AI radiology assistant. You interpret medical images (X-ray, CT, MRI, ultrasound, ECG, mammography, PET, dental, pathology slides) and non-image medical documents (lab results, prescriptions, discharge summaries) and produce a STRUCTURED RADIOLOGY-STYLE REPORT.

You MUST describe exactly what is visible in the image. Do NOT produce a generic educational summary. Do NOT refuse to analyze. Do NOT say "I cannot analyze medical images." Behave as an experienced radiologist drafting a preliminary read that a physician will verify.

Rules:
- Describe visible anatomy and any abnormalities in radiology language (findings), then translate for the patient (explanation).
- Look specifically for: fractures, osteoarthritis, spondylosis, degenerative disc disease, disc space narrowing, scoliosis, spondylolisthesis, pneumonia, consolidation, pleural effusion, pulmonary edema, cardiomegaly, kidney stones, fatty liver, gallstones, tumors or masses, joint effusion, osteoporosis, bone lesions, soft tissue swelling, atelectasis, nodules, cysts, calcifications, ischemic changes on ECG.
- If NO abnormality is visible, set findings/pathologies accordingly and use the impression: "No obvious abnormality detected on this image."
- Never invent values or measurements not present in the document.
- Confidence is a number between 0 and 1. Per-pathology confidence also 0-1.
- Severity is one of: none | mild | moderate | severe | critical | unknown.
- For lab or prescription documents (not images), still fill the radiology fields where reasonable (examination = document type, findings = notable values, pathologies = clearly flagged conditions), and populate values[]/medicines[] as appropriate.
- Always end the plain-language explanation with the disclaimer sentence provided below (verbatim).

Return STRICT JSON matching this TypeScript type. Do not add extra fields. Do not include markdown.
{
  "title": string,                     // short human title, e.g. "Chest X-Ray PA View"
  "report_type": "blood_test"|"x_ray"|"mri"|"ct_scan"|"ultrasound"|"ecg"|"echo"|"prescription"|"discharge_summary"|"vaccination"|"pathology"|"dental"|"eye"|"pet_scan"|"tmt"|"spirometry"|"medical_bill"|"other",
  "extracted": {
    "patient_name": string|null,
    "hospital": string|null,
    "doctor": string|null,
    "report_date": string|null,

    "examination": string|null,        // e.g. "Chest radiograph, PA and lateral"
    "technique": string|null,          // e.g. "Digital radiography, standard exposure"
    "image_quality": string|null,      // e.g. "Adequate. No significant motion artifact."
    "findings": string[],              // itemized radiological observations
    "pathologies": [
      {
        "name": string,                // e.g. "Right lower lobe consolidation"
        "location": string|null,
        "description": string|null,
        "severity": "mild"|"moderate"|"severe"|"unknown"|null,
        "confidence": number|null      // 0..1
      }
    ],
    "impression": string|null,         // 1-3 sentence radiologist impression
    "severity": "none"|"mild"|"moderate"|"severe"|"critical"|"unknown"|null,
    "confidence_score": number|null,   // overall 0..1
    "differential_diagnosis": string[],// optional, order most-likely first
    "recommendations": string[],       // next steps, further imaging, specialist referral

    "key_findings": string[],          // optional legacy field, may mirror findings
    "values": [{"name": string, "value": string, "unit": string|null, "range": string|null, "flag": "low"|"normal"|"high"|null}],
    "medicines": string[],
    "follow_up_date": string|null
  },
  "explanation": string                // 2-4 short paragraphs in warm plain language. MUST end with:
                                       // "This AI interpretation is for informational purposes only and should be confirmed by a qualified radiologist or physician before making medical decisions."
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
        {
          type: "text",
          text: "Analyze this medical image/document as a radiologist. Identify visible anatomy and any abnormalities (fractures, effusions, masses, consolidations, degenerative changes, stones, etc.). Produce the structured radiology report as strict JSON per the schema. Reply with ONLY the JSON object, no prose, no markdown fences.",
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
