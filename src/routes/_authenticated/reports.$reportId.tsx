import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { analyzeReport } from "@/lib/reports.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reports/$reportId")({
  component: ReportDetail,
});

type Value = { name: string; value: string; unit?: string | null; range?: string | null; flag?: "low" | "normal" | "high" | null };
type Extracted = {
  patient_name?: string | null;
  hospital?: string | null;
  doctor?: string | null;
  report_date?: string | null;
  key_findings?: string[];
  values?: Value[];
  impression?: string | null;
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

  return (
    <main className="max-w-6xl mx-auto px-6 py-12 grid grid-cols-12 gap-8 animate-entrance">
      <div className="col-span-12 lg:col-span-8 space-y-10">
        <div>
          <Link to="/dashboard" className="label-mono hover:text-foreground transition-colors">
            ← Back to vault
          </Link>
          <p className="label-mono mt-6">
            ({report.report_type.replace("_", " ")}) ·{" "}
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

        {/* AI Explanation */}
        <section className="relative p-8 bg-card ring-1 ring-black/5 rounded-sm">
          <h2 className="label-mono mb-4">Plain-language explanation</h2>
          {report.ai_status === "processing" && (
            <p className="font-serif italic text-xl text-muted-foreground">
              Reading your report…
            </p>
          )}
          {report.ai_status === "error" && (
            <div>
              <p className="text-sm text-destructive">
                {report.ai_error ?? "AI could not process this file."}
              </p>
              <button
                onClick={handleReanalyze}
                className="mt-4 label-mono hover:text-foreground transition-colors"
              >
                → Try again
              </button>
            </div>
          )}
          {report.ai_status === "done" && (
            <>
              <p className="text-foreground leading-relaxed whitespace-pre-line max-w-[65ch]">
                {report.explanation}
              </p>
              <p className="mt-6 text-[10px] leading-relaxed italic text-muted-foreground max-w-[55ch]">
                Educational summary only — not medical advice. Discuss any concerns with your doctor.
              </p>
            </>
          )}
        </section>

        {/* Values */}
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

        {ext?.key_findings && ext.key_findings.length > 0 && (
          <section>
            <h2 className="label-mono mb-4">Key findings</h2>
            <ul className="space-y-2">
              {ext.key_findings.map((f, i) => (
                <li key={i} className="text-sm leading-relaxed pl-4 border-l-2 border-border">{f}</li>
              ))}
            </ul>
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
      </div>

      <aside className="col-span-12 lg:col-span-4 space-y-6">
        <div className="p-6 bg-card ring-1 ring-black/5 rounded-sm">
          <h3 className="label-mono mb-4">Source document</h3>
          {fileUrl ? (
            <>
              {isImage && (
                <img src={fileUrl} alt={report.title} className="w-full rounded-sm border border-border" />
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
          <h4 className="label-mono text-accent">Actions</h4>
          <div className="mt-4 space-y-2 text-sm">
            <button
              onClick={handleReanalyze}
              className="block label-mono hover:text-foreground transition-colors"
            >
              → Re-analyze with AI
            </button>
            <button
              onClick={handleDelete}
              className="block label-mono hover:text-destructive transition-colors"
            >
              → Delete from vault
            </button>
          </div>
        </div>
      </aside>
    </main>
  );
}
