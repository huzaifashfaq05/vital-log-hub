import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/dashboard")({
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
  ai_status: string;
  created_at: string;
};

async function fetchReports(): Promise<Report[]> {
  const { data, error } = await supabase
    .from("reports")
    .select("id, title, report_type, hospital, doctor, report_date, file_mime, explanation, ai_status, created_at")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return data as Report[];
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
function fmtShort(d: string | null) {
  if (!d) return "—";
  const dt = new Date(d);
  return `${MONTHS[dt.getMonth()]} ${String(dt.getDate()).padStart(2, "0")} '${String(dt.getFullYear()).slice(2)}`;
}
function fmtMonth(d: string) {
  const dt = new Date(d);
  return `${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}
function extBadge(mime: string) {
  if (mime.includes("pdf")) return "PDF";
  if (mime.startsWith("image/")) return "IMG";
  return "DOC";
}

function Dashboard() {
  const { data: reports, isLoading } = useQuery({ queryKey: ["reports"], queryFn: fetchReports });

  const latest = reports?.find((r) => r.explanation && r.ai_status === "done");
  const recent = reports?.slice(0, 5) ?? [];
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
          <header className="mb-6">
            <h2 className="label-mono">(02) Recent Documents</h2>
          </header>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">No documents yet.</p>
          ) : (
            <div className="divide-y divide-border border-t border-b border-border">
              {recent.map((r) => (
                <Link
                  key={r.id}
                  to="/reports/$reportId"
                  params={{ reportId: r.id }}
                  className="group grid grid-cols-12 py-4 items-center hover:bg-white/50 transition-colors cursor-pointer"
                >
                  <div className="col-span-3 sm:col-span-2 label-mono">{fmtShort(r.report_date ?? r.created_at)}</div>
                  <div className="col-span-6 font-medium truncate pr-2">{r.title}</div>
                  <div className="hidden sm:block col-span-3 text-xs text-muted-foreground truncate">{r.hospital ?? "—"}</div>
                  <div className="col-span-3 sm:col-span-1 text-right">
                    <span className="text-xs font-mono px-2 py-0.5 border border-border rounded">
                      {r.ai_status === "processing" ? "…" : extBadge(r.file_mime)}
                    </span>
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
