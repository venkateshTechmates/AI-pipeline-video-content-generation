import { useEffect, useState } from "react";
import { Link, Navigate, Route, Routes } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { Compass } from "lucide-react";
import { Login } from "./Login";
import { Shell } from "./components/Shell";
import { EmptyState, Loading } from "./components/ui";
import { StatsPage } from "./pages/StatsPage";
import { TraceDetailPage } from "./pages/TraceDetailPage";
import { TracesPage } from "./pages/TracesPage";
import { BrandScopeProvider } from "./state";
import { authEnabled, supabase } from "./supabase";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(!authEnabled);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (!ready) return <Loading />;
  if (authEnabled && !session) return <Login />;

  return (
    <BrandScopeProvider>
      <Shell email={session?.user.email}>
        <Routes>
          <Route path="/" element={<TracesPage />} />
          <Route path="/traces" element={<Navigate to="/" replace />} />
          <Route path="/traces/:id" element={<TraceDetailPage />} />
          <Route path="/stats" element={<StatsPage />} />
          <Route
            path="*"
            element={
              <EmptyState
                icon={<Compass size={30} />}
                title="Page not found"
                body="That route doesn't exist."
                action={
                  <Link className="btn" to="/">
                    Back to traces
                  </Link>
                }
              />
            }
          />
        </Routes>
      </Shell>
    </BrandScopeProvider>
  );
}
