import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Medical Report Dashboard | MedVault AI" },
      { name: "description", content: "View all previous scans, diagnoses, findings, and AI-assisted medical reports in one private dashboard." },
      { property: "og:title", content: "Medical Report Dashboard | MedVault AI" },
      { property: "og:description", content: "Your private history of scans and AI-assisted medical reports." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Dashboard,
});

type Report = {
  id: string;
  title: string;
  report_type: string;
  hospital: string | null;
  doctor: string | null;
  report_date: string | null;
  file_mime: string;
  explanation: string | null;
  extracted: {
    impression?: string | null;
    severity?: string | null;
    pathologies?: Array<{ name: string; severity?: string | null }>;
  } | null;
  ai_status: string;
  created_at: string;
};

async function fetchReports(): Promise<Report[]> {
  const { data, error } = await supabase
    .from("reports")
    .select("id, title, report_type, hospital, doctor, report_date, file_mime, explanation, extracted, ai_status, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as Report[];
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function fmtShort(d: string | null) {
  if (!d) return "—";
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : new Date(d);
  return `${MONTHS[dt.getMonth()]} ${String(dt.getDate()).padStart(2, "0")} '${String(dt.getFullYear()).slice(2)}`;
}
function fmtMonth(d: string) {
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T12:00:00`) : new Date(d);
  return `${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}
function extBadge(mime: string) {
  if (mime.includes("pdf")) return "PDF";
  if (mime.startsWith("image/")) return "IMG";
  return "DOC";
}

function diagnosisSummary(report: Report) {
  const names = report.extracted?.pathologies?.map((pathology) => pathology.name).filter(Boolean);
  if (names && names.length > 0) return names.slice(0, 3).join(" · ");
  return report.extracted?.impression ?? (report.ai_status === "processing" ? "Analysis in progress" : "No diagnosis recorded");
}

function Dashboard() {
  const { data: reports, isLoading, error } = useQuery({ queryKey: ["reports"], queryFn: fetchReports });

  const latest = reports?.find((r) => r.explanation && r.ai_status === "done");
  const recent = reports ?? [];
  const timeline = reports?.slice(0, 6) ?? [];

  return (
    <main className="max-w-7xl mx-auto px-6 py-12 grid grid-cols-12 gap-8">
      <div className="col-span-12 lg:col-span-8 space-y-12 animate-entrance">
        {/* AI INSIGHT */}
        <section>
          <header className="mb-6 flex items-end justify-between">
            <h2 className="label-mono">(01) Latest Synthesis</h2>
            <span className="label-mono">
              {latest ? new Date(latest.created_at).toDateString().toUpperCase() : "—"}
            </span>
          </header>
          <div className="relative p-8 bg-card ring-1 ring-black/5 rounded-sm">
            {latest ? (
              <div className="max-w-[60ch]">
                <h3 className="font-serif italic text-3xl mb-4 text-balance leading-tight">
                  {latest.title}
                </h3>
                <p className="text-muted-foreground leading-relaxed mb-6 whitespace-pre-line">
                  {latest.explanation}
                </p>
                <Link
                  to="/reports/$reportId"
                  params={{ reportId: latest.id }}
                  className="label-mono hover:text-foreground transition-colors"
                >
                  → Read full report
                </Link>
                <div className="absolute top-8 right-8 label-mono text-accent bg-accent/10 px-2 py-0.5 rounded italic normal-case tracking-normal text-[10px] font-mono">
                  Verified extraction
                </div>
              </div>
            ) : (
              <div className="max-w-[60ch]">
                <h3 className="font-serif italic text-3xl mb-4 text-balance leading-tight">
                  Your vault is quiet.
                </h3>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  {isLoading
                    ? "Loading your records…"
                    : "Upload your first medical report and we'll extract the key fields and write a plain-language explanation. Nothing leaves your vault without your consent."}
                </p>
                <Link
                  to="/upload"
                  className="inline-flex items-center px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-sm shadow-sm hover:brightness-110 transition-all"
                >
                  Upload a report
                </Link>
              </div>
            )}
          </div>
        </section>

        {/* RECENT */}
        <section className="animate-entrance" style={{ animationDelay: "100ms" }}>
          <header className="mb-6 flex items-end justify-between gap-4">
            <div>
              <h2 className="label-mono">(02) Scan & Report History</h2>
              <p className="mt-2 text-sm text-muted-foreground">All previous uploads and their latest diagnostic result.</p>
            </div>
            <span className="label-mono">{recent.length} total</span>
          </header>
          {error ? (
            <div className="border border-destructive/20 bg-destructive/5 p-5 text-sm text-destructive">
              Your report history could not be loaded. Refresh the page to try again.
            </div>
          ) : recent.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No documents yet.</p>
          ) : (
            <div className="divide-y divide-border border-t border-b border-border">
              {recent.map((r) => (
                <Link
                  key={r.id}
                  to="/reports/$reportId"
                  params={{ reportId: r.id }}
                  className="group grid grid-cols-12 gap-x-3 gap-y-2 py-5 items-center hover:bg-card/70 transition-colors cursor-pointer"
                >
                  <div className="col-span-3 sm:col-span-2 label-mono">{fmtShort(r.report_date ?? r.created_at)}</div>
                  <div className="col-span-7 sm:col-span-8 min-w-0">
                    <p className="font-medium truncate">{r.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{diagnosisSummary(r)}</p>
                  </div>
                  <div className="col-span-2 text-right">
                    <span className="text-xs font-mono px-2 py-0.5 border border-border rounded">
                      {r.ai_status === "processing" ? "…" : extBadge(r.file_mime)}
                    </span>
                    {r.extracted?.severity && (
                      <p className="mt-2 label-mono">{r.extracted.severity}</p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* UPLOAD CTA */}
        <section className="animate-entrance" style={{ animationDelay: "200ms" }}>
          <Link
            to="/upload"
            className="block border-2 border-dashed border-border p-12 rounded-lg bg-white/30 text-center hover:bg-white/60 transition-colors"
          >
            <div className="mb-4 inline-flex size-12 items-center justify-center rounded-full bg-background border border-border">
              <span className="font-serif italic text-xl text-primary">+</span>
            </div>
            <p className="text-sm font-medium">Drop medical records here</p>
            <p className="text-xs text-muted-foreground mt-1">
              PDF, JPG, or PNG · up to 20MB
            </p>
          </Link>
        </section>
      </div>

      {/* SIDEBAR */}
      <aside className="col-span-12 lg:col-span-4 space-y-8 animate-entrance" style={{ animationDelay: "300ms" }}>
        <div className="p-6 bg-card ring-1 ring-black/5 rounded-sm space-y-6">
          <h3 className="label-mono">Vault Summary</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-end pb-4 border-b border-border">
              <div>
                <p className="text-xs text-muted-foreground">Reports</p>
                <p className="font-serif italic text-2xl">{reports?.length ?? 0}</p>
              </div>
              <div className="label-mono text-primary">Stored</div>
            </div>
            <div className="flex justify-between items-end pb-4 border-b border-border">
              <div>
                <p className="text-xs text-muted-foreground">Explained by AI</p>
                <p className="font-serif italic text-2xl">
                  {reports?.filter((r) => r.ai_status === "done").length ?? 0}
                </p>
              </div>
              <div className="label-mono text-accent">Ready</div>
            </div>
            <div className="flex justify-between items-end">
              <div>
                <p className="text-xs text-muted-foreground">In review</p>
                <p className="font-serif italic text-2xl">
                  {reports?.filter((r) => r.ai_status === "processing").length ?? 0}
                </p>
              </div>
              <div className="label-mono">Working</div>
            </div>
          </div>
        </div>

        <div className="p-6 bg-accent/5 ring-1 ring-accent/10 rounded-sm">
          <h4 className="label-mono text-accent">Clinical Note</h4>
          <p className="mt-3 text-xs leading-relaxed italic text-accent/80">
            AI synthesis is for informational purposes. This summary does not constitute
            professional medical advice, diagnosis, or treatment. Always seek the advice of
            your physician.
          </p>
        </div>

        <div className="space-y-4">
          <h3 className="label-mono px-1">Health Timeline</h3>
          <div className="relative pl-4 border-l border-border space-y-8">
            {timeline.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">Your timeline is empty.</p>
            ) : (
              timeline.map((r, i) => (
                <div key={r.id} className="relative">
                  <div
                    className={`absolute -left-[21px] top-1 size-2.5 rounded-full border-2 border-background ${
                      i === 0 ? "bg-primary" : "bg-border"
                    }`}
                  />
                  <p className="label-mono">{fmtMonth(r.report_date ?? r.created_at)}</p>
                  <p className="text-xs font-medium">{r.title}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>
    </main>
  );
}
