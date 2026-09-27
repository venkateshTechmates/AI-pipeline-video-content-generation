import { useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { Login } from "./Login";
import { BrandsPage } from "./pages/BrandsPage";
import { CostsPage } from "./pages/CostsPage";
import { NewRunPage } from "./pages/NewRunPage";
import { QueuePage } from "./pages/QueuePage";
import { RunDetailPage } from "./pages/RunDetailPage";
import { RunsPage } from "./pages/RunsPage";
import { authEnabled, supabase } from "./supabase";
import { EmptyState, Loading } from "./components/ui";
import { Shell } from "./components/Shell";
import { BrandScopeProvider, QueueProvider, ToastProvider } from "./state";

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
    <ToastProvider>
      <BrandScopeProvider>
        <QueueProvider>
          <Shell email={session?.user.email}>
            <Routes>
              <Route path="/" element={<QueuePage />} />
              <Route path="/runs" element={<RunsPage />} />
              <Route path="/runs/new" element={<NewRunPage />} />
              <Route path="/runs/:id" element={<RunDetailPage />} />
              <Route path="/costs" element={<CostsPage />} />
              <Route path="/brands/:id/costs" element={<CostsPage />} />
              <Route path="/brands" element={<BrandsPage />} />
              <Route path="/brands/:id" element={<BrandsPage />} />
              <Route
                path="*"
                element={
                  <EmptyState
                    title="Page not found"
                    body="That route doesn't exist."
                    action={
                      <Link className="btn" to="/">
                        Back to the queue
                      </Link>
                    }
                  />
                }
              />
            </Routes>
          </Shell>
        </QueueProvider>
      </BrandScopeProvider>
    </ToastProvider>
  );
}
