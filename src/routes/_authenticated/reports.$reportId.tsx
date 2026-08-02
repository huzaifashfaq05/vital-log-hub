import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { analyzeReport } from "@/lib/reports.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reports/$reportId")({
  head: () => ({
    meta: [
      { title: "Radiology Report | MedVault AI" },
      { name: "description", content: "Review structured findings, impression, confidence, and recommendations for your medical report." },
      { property: "og:title", content: "Radiology Report | MedVault AI" },
      { property: "og:description", content: "Private structured AI-assisted radiology report." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ReportDetail,
});

type Value = { name: string; value: string; unit?: string | null; range?: string | null; flag?: "low" | "normal" | "high" | null };
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
  key_findings?: string[];
  values?: Value[];
  medicines?: string[];
  follow_up_date?: string | null;
};

async function fetchReport(id: string) {
  const { data, error } = await supabase
    .from("reports")
    .select("id, title, report_type, hospital, doctor, report_date, file_path, file_mime, explanation, extracted, ai_status, ai_error, created_at")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as {
    id: string;
    title: string;
    report_type: string;
    hospital: string | null;
    doctor: string | null;
    report_date: string | null;
    file_path: string;
    file_mime: string;
    explanation: string | null;
    extracted: Extracted | null;
    ai_status: string;
    ai_error: string | null;
    created_at: string;
  };
}

function flagColor(flag?: string | null) {
  if (flag === "high") return "text-destructive";
  if (flag === "low") return "text-accent";
  return "text-primary";
}

function severityStyle(sev?: string | null) {
  switch (sev) {
    case "critical":
      return "bg-destructive text-destructive-foreground";
    case "severe":
      return "bg-destructive/85 text-destructive-foreground";
    case "moderate":
      return "bg-accent text-accent-foreground";
    case "mild":
      return "bg-primary/15 text-primary";
    case "none":
      return "bg-primary/10 text-primary";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function pct(v?: number | null) {
  if (v == null || Number.isNaN(v)) return null;
  const clamped = Math.max(0, Math.min(1, v));
  return Math.round(clamped * 100);
}

function ReportDetail() {
  const { reportId } = Route.useParams();
  const router = useRouter();
  const analyze = useServerFn(analyzeReport);
  const [fileUrl, setFileUrl] = useState<string | null>(null);

  const { data: report, refetch } = useQuery({
    queryKey: ["report", reportId],
    queryFn: () => fetchReport(reportId),
    refetchInterval: (q) => {
      const r = q.state.data;
      return r && r.ai_status === "processing" ? 2500 : false;
    },
  });

  useEffect(() => {
    if (!report?.file_path) return;
    supabase.storage
      .from("medical-reports")
      .createSignedUrl(report.file_path, 60 * 60)
      .then(({ data }) => setFileUrl(data?.signedUrl ?? null));
  }, [report?.file_path]);

  async function handleDelete() {
    if (!report) return;
    if (!confirm("Delete this report from your vault? This cannot be undone.")) return;
    await supabase.storage.from("medical-reports").remove([report.file_path]);
    await supabase.from("reports").delete().eq("id", report.id);
    toast.success("Deleted");
    router.navigate({ to: "/dashboard" });
  }

  async function handleReanalyze() {
    if (!report) return;
    toast.info("Re-analyzing…");
    try {
      await analyze({ data: { reportId: report.id } });
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    }
  }

  if (!report) {
    return <main className="max-w-6xl mx-auto px-6 py-12 label-mono">Loading…</main>;
  }

  const ext = report.extracted;
  const isImage = report.file_mime.startsWith("image/");
  const isPdf = report.file_mime.includes("pdf");
  const overallConfidence = pct(ext?.confidence_score);

  return (
    <main className="max-w-6xl mx-auto px-6 py-12 grid grid-cols-12 gap-8 animate-entrance">
      <div className="col-span-12 lg:col-span-8 space-y-8">
        <div>
          <Link to="/dashboard" className="label-mono hover:text-foreground transition-colors">
            ← Back to vault
          </Link>
          <p className="label-mono mt-6">
            RADIOLOGY REPORT · ({report.report_type.replace("_", " ")}) ·{" "}
            {report.report_date ?? new Date(report.created_at).toDateString()}
          </p>
          <h1 className="mt-2 font-serif italic text-4xl text-balance leading-tight">
            {report.title}
          </h1>
          {(report.hospital || report.doctor) && (
            <p className="mt-3 text-sm text-muted-foreground">
              {[report.hospital, report.doctor].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>

        {report.ai_status === "processing" && (
          <section className="p-8 bg-card ring-1 ring-black/5 rounded-sm">
            <p className="label-mono mb-2">AI Radiologist</p>
            <p className="font-serif italic text-xl text-muted-foreground">
              Interpreting image…
            </p>
          </section>
        )}

        {report.ai_status === "error" && (
          <section className="p-8 bg-card ring-1 ring-destructive/20 rounded-sm">
            <p className="text-sm text-destructive">
              {report.ai_error ?? "AI could not process this file."}
            </p>
            <button
              onClick={handleReanalyze}
              className="mt-4 label-mono hover:text-foreground transition-colors"
            >
              → Try again
            </button>
          </section>
        )}

        {report.ai_status === "done" && (
          <>
            {/* Header meta strip */}
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-4 bg-card ring-1 ring-black/5 rounded-sm">
                <p className="label-mono">Examination</p>
                <p className="mt-2 text-sm font-medium leading-snug">
                  {ext?.examination ?? "—"}
                </p>
              </div>
              <div className="p-4 bg-card ring-1 ring-black/5 rounded-sm">
                <p className="label-mono">Technique</p>
                <p className="mt-2 text-sm font-medium leading-snug">
                  {ext?.technique ?? "—"}
                </p>
              </div>
              <div className="p-4 bg-card ring-1 ring-black/5 rounded-sm">
                <p className="label-mono">Image quality</p>
                <p className="mt-2 text-sm font-medium leading-snug">
                  {ext?.image_quality ?? "—"}
                </p>
              </div>
              <div className="p-4 bg-card ring-1 ring-black/5 rounded-sm">
                <p className="label-mono">Severity / Confidence</p>
                <div className="mt-2 flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider ${severityStyle(ext?.severity)}`}>
                    {ext?.severity ?? "unknown"}
                  </span>
                  {overallConfidence != null && (
                    <span className="text-sm font-medium">{overallConfidence}%</span>
                  )}
                </div>
              </div>
            </section>

            {/* Findings */}
            <section className="p-8 bg-card ring-1 ring-black/5 rounded-sm">
              <h2 className="label-mono mb-4">Findings</h2>
              {ext?.findings && ext.findings.length > 0 ? (
                <ul className="space-y-2">
                  {ext.findings.map((f, i) => (
                    <li key={i} className="text-sm leading-relaxed pl-4 border-l-2 border-border">
                      {f}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="font-serif italic text-muted-foreground">
                  No obvious abnormality detected on this image.
                </p>
              )}
            </section>

            {/* Detected Pathologies */}
            {ext?.pathologies && ext.pathologies.length > 0 && (
              <section>
                <h2 className="label-mono mb-4">Detected pathologies</h2>
                <div className="space-y-3">
                  {ext.pathologies.map((p, i) => {
                    const conf = pct(p.confidence);
                    return (
                      <div
                        key={i}
                        className="p-5 bg-card ring-1 ring-black/5 rounded-sm"
                      >
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <h3 className="font-serif italic text-xl">{p.name}</h3>
                          {p.location && (
                            <span className="label-mono">{p.location}</span>
                          )}
                          <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider ${severityStyle(p.severity)}`}>
                            {p.severity ?? "unknown"}
                          </span>
                        </div>
                        {p.description && (
                          <p className="mt-2 text-sm text-foreground leading-relaxed">
                            {p.description}
                          </p>
                        )}
                        {conf != null && (
                          <div className="mt-4">
                            <div className="flex items-center justify-between label-mono mb-1">
                              <span>Confidence</span>
                              <span>{conf}%</span>
                            </div>
                            <div className="h-1 bg-border rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary"
                                style={{ width: `${conf}%` }}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Impression */}
            {ext?.impression && (
              <section className="p-8 bg-primary/5 ring-1 ring-primary/15 rounded-sm">
                <h2 className="label-mono mb-3 text-primary">Impression</h2>
                <p className="font-serif italic text-xl leading-snug text-foreground max-w-[55ch]">
                  {ext.impression}
                </p>
              </section>
            )}

            {/* Differential */}
            {ext?.differential_diagnosis && ext.differential_diagnosis.length > 0 && (
              <section>
                <h2 className="label-mono mb-4">Differential diagnosis</h2>
                <ol className="space-y-2 list-decimal list-inside">
                  {ext.differential_diagnosis.map((d, i) => (
                    <li key={i} className="text-sm leading-relaxed">{d}</li>
                  ))}
                </ol>
              </section>
            )}

            {/* Recommendations */}
            {ext?.recommendations && ext.recommendations.length > 0 && (
              <section>
                <h2 className="label-mono mb-4">Recommendations</h2>
                <ul className="space-y-2">
                  {ext.recommendations.map((r, i) => (
                    <li key={i} className="text-sm leading-relaxed pl-4 border-l-2 border-accent">
                      {r}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Plain-language explanation */}
            {report.explanation && (
              <section className="p-8 bg-card ring-1 ring-black/5 rounded-sm">
                <h2 className="label-mono mb-4">Plain-language explanation</h2>
                <p className="text-foreground leading-relaxed whitespace-pre-line max-w-[65ch]">
                  {report.explanation}
                </p>
              </section>
            )}

            {/* Values (labs) */}
            {ext?.values && ext.values.length > 0 && (
              <section>
                <h2 className="label-mono mb-4">Extracted values</h2>
                <div className="divide-y divide-border border-t border-b border-border">
                  {ext.values.map((v, i) => (
                    <div key={i} className="grid grid-cols-12 py-3 items-center">
                      <div className="col-span-5 sm:col-span-6 text-sm font-medium">{v.name}</div>
                      <div className={`col-span-4 sm:col-span-3 font-serif italic text-lg ${flagColor(v.flag)}`}>
                        {v.value} <span className="text-xs font-sans not-italic text-muted-foreground">{v.unit ?? ""}</span>
                      </div>
                      <div className="col-span-3 text-right label-mono">
                        {v.range ?? (v.flag ?? "—")}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {ext?.medicines && ext.medicines.length > 0 && (
              <section>
                <h2 className="label-mono mb-4">Medicines</h2>
                <ul className="flex flex-wrap gap-2">
                  {ext.medicines.map((m, i) => (
                    <li key={i} className="text-xs font-mono px-3 py-1 border border-border rounded-full">
                      {m}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>

      <aside className="col-span-12 lg:col-span-4 space-y-6">
        <div className="p-6 bg-card ring-1 ring-black/5 rounded-sm">
          <h3 className="label-mono mb-4">Source image</h3>
          {fileUrl ? (
            <>
              {isImage && (
                <img src={fileUrl} alt={report.title} className="w-full rounded-sm border border-border bg-black" />
              )}
              {isPdf && (
                <iframe
                  src={fileUrl}
                  title={report.title}
                  className="w-full h-96 rounded-sm border border-border"
                />
              )}
              {!isImage && !isPdf && (
                <p className="text-xs text-muted-foreground italic">Preview not available.</p>
              )}
              <a
                href={fileUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex label-mono hover:text-foreground transition-colors"
              >
                → Open original
              </a>
            </>
          ) : (
            <p className="label-mono">Loading file…</p>
          )}
        </div>

        <div className="p-6 bg-accent/5 ring-1 ring-accent/10 rounded-sm">
          <h4 className="label-mono text-accent">Report actions</h4>
          <div className="mt-4 space-y-2 text-sm">
            <button
              onClick={handleReanalyze}
              className="block label-mono hover:text-foreground transition-colors"
            >
              → Re-run AI radiologist
            </button>
            <button
              onClick={handleDelete}
              className="block label-mono hover:text-destructive transition-colors"
            >
              → Delete from vault
            </button>
          </div>
        </div>

        <div className="p-6 bg-muted/40 ring-1 ring-black/5 rounded-sm">
          <p className="text-[11px] leading-relaxed italic text-muted-foreground">
            This AI interpretation is for informational purposes only and should be
            confirmed by a qualified radiologist or physician before making medical decisions.
          </p>
        </div>
      </aside>
    </main>
  );
}
