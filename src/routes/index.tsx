import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  ssr: false,
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/dashboard" });
  },
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen">
      <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <span className="font-serif italic text-xl tracking-tight">MedVault AI</span>
          <Link
            to="/auth"
            className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-sm shadow-sm hover:brightness-110 transition-all"
          >
            Sign in
          </Link>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-24 grid grid-cols-12 gap-8 animate-entrance">
        <div className="col-span-12 lg:col-span-8">
          <p className="label-mono">(01) A private folder for your health</p>
          <h1 className="mt-6 font-serif italic text-6xl leading-[1.05] text-balance max-w-[18ch]">
            Your medical reports,{" "}
            <span className="text-primary">understood.</span>
          </h1>
          <p className="mt-8 max-w-[55ch] text-muted-foreground leading-relaxed">
            MedVault reads your lab results, prescriptions, and scans, then explains them in
            plain language — so you walk into every appointment already informed. Encrypted,
            private, and always yours.
          </p>
          <div className="mt-10 flex gap-4">
            <Link
              to="/auth"
              className="px-6 py-3 bg-primary text-primary-foreground text-sm font-medium rounded-sm shadow-sm hover:brightness-110 transition-all"
            >
              Start your vault
            </Link>
          </div>
        </div>

        <aside className="col-span-12 lg:col-span-4 space-y-6">
          <div className="p-6 bg-card ring-1 ring-black/5 rounded-sm">
            <p className="label-mono">Latest synthesis · sample</p>
            <p className="mt-4 font-serif italic text-xl leading-snug">
              Your LDL is slightly elevated at 132 mg/dL, but your HDL improved 5%.
            </p>
            <p className="mt-3 text-xs text-muted-foreground italic">
              Educational only, not medical advice.
            </p>
          </div>
          <div className="p-6 bg-accent/5 ring-1 ring-accent/10 rounded-sm">
            <p className="label-mono text-accent">Clinical Note</p>
            <p className="mt-3 text-xs italic leading-relaxed text-accent/80">
              AI summaries are for informational purposes and do not constitute medical
              advice, diagnosis, or treatment.
            </p>
          </div>
        </aside>
      </main>
    </div>
  );
}
