import { createFileRoute, useRouter, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in | MedVault AI" },
      { name: "description", content: "Sign in securely to access your private medical scans and AI-generated reports." },
      { property: "og:title", content: "Sign in | MedVault AI" },
      { property: "og:description", content: "Access your private MedVault AI medical report workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (data.user) throw redirect({ to: "/dashboard" });
  },
  component: AuthPage,
});

function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/auth" },
        });
        if (error) throw error;
        if (data.session) {
          toast.success("Vault created.");
          router.navigate({ to: "/dashboard", replace: true });
          return;
        }
        // No session: try an immediate sign-in (auto-confirm enabled projects)
        const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) {
          toast.success("Check your email to confirm, then sign in.");
          setMode("signin");
          return;
        }
        router.navigate({ to: "/dashboard", replace: true });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        router.navigate({ to: "/dashboard", replace: true });
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }


  async function handleGoogle() {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/auth",
    });
    if (result.error) {
      toast.error("Google sign-in failed");
      setLoading(false);
      return;
    }
    if (result.redirected) return;
    router.navigate({ to: "/dashboard", replace: true });
  }

  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2">
      <aside className="hidden lg:flex flex-col justify-between p-12 bg-card border-r border-border">
        <Link to="/" className="font-serif italic text-2xl tracking-tight">MedVault AI</Link>
        <div>
          <p className="label-mono">(A private folder for your health)</p>
          <h2 className="mt-6 font-serif italic text-5xl leading-[1.05] text-balance max-w-[16ch]">
            Sign in to your <span className="text-primary">vault.</span>
          </h2>
          <p className="mt-6 max-w-[45ch] text-sm text-muted-foreground leading-relaxed">
            Your reports are end-to-end encrypted and never shared. Only you and the people
            you explicitly grant access can view them.
          </p>
        </div>
        <p className="label-mono opacity-60">Vault Secured · Encrypted at rest</p>
      </aside>

      <main className="flex items-center justify-center p-8">
        <div className="w-full max-w-sm animate-entrance">
          <p className="label-mono">{mode === "signin" ? "(01) Welcome back" : "(01) Create your vault"}</p>
          <h1 className="mt-3 font-serif italic text-4xl">
            {mode === "signin" ? "Sign in" : "Get started"}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {mode === "signin" ? "to continue to MedVault." : "in under a minute."}
          </p>

          <button
            onClick={handleGoogle}
            disabled={loading}
            className="mt-8 w-full py-2.5 px-4 rounded-sm border border-border bg-card text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            Continue with Google
          </button>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />
            <span className="label-mono">or email</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@domain.com"
              className="w-full py-2.5 px-3 rounded-sm border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full py-2.5 px-3 rounded-sm border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-sm bg-primary text-primary-foreground text-sm font-medium shadow-sm hover:brightness-110 transition-all disabled:opacity-50"
            >
              {loading ? "…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
          </form>

          <button
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
            className="mt-6 label-mono hover:text-foreground transition-colors"
          >
            {mode === "signin" ? "→ Create a new vault" : "→ I already have a vault"}
          </button>

          <p className="mt-8 text-[10px] leading-relaxed italic text-muted-foreground max-w-[40ch]">
            MedVault provides educational summaries only. It is not a substitute for
            professional medical advice, diagnosis, or treatment.
          </p>
        </div>
      </main>
    </div>
  );
}
