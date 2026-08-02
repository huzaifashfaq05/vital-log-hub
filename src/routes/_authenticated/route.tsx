import { createFileRoute, Outlet, redirect, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  const { user } = Route.useRouteContext();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState<string>(user.email ?? "");

  useEffect(() => setEmail(user.email ?? ""), [user.email]);

  async function signOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    router.navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link to="/dashboard" className="font-serif italic text-xl tracking-tight">
              MedVault AI
            </Link>
            <div className="hidden md:flex gap-6 text-sm font-medium text-muted-foreground">
              <Link to="/dashboard" activeProps={{ className: "text-foreground" }} className="hover:text-foreground transition-colors">
                Dashboard
              </Link>
              <Link to="/upload" activeProps={{ className: "text-foreground" }} className="hover:text-foreground transition-colors">
                Upload
              </Link>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden sm:inline label-mono">{email}</span>
            <Link
              to="/upload"
              className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-sm shadow-sm hover:brightness-110 transition-all"
            >
              Upload Report
            </Link>
            <button
              onClick={signOut}
              className="text-xs font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground"
            >
              Sign out
            </button>
          </div>
        </div>
      </nav>
      <Outlet />
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-border flex justify-between items-center opacity-40">
        <div className="flex items-center gap-2">
          <div className="size-1.5 rounded-full bg-primary" />
          <span className="label-mono">Vault Secured · Encrypted at rest</span>
        </div>
        <span className="label-mono">MedVault © {new Date().getFullYear()}</span>
      </footer>
    </div>
  );
}
