import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { Login } from "./Login";
import { CostsIndex, CostsPage } from "./pages/CostsPage";
import { NewRunPage } from "./pages/NewRunPage";
import { QueuePage } from "./pages/QueuePage";
import { RunDetailPage } from "./pages/RunDetailPage";
import { RunsPage } from "./pages/RunsPage";
import { authEnabled, supabase } from "./supabase";
import { Loading } from "./components/ui";

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
    <div className="app">
      <nav className="topnav">
        <NavLink to="/" className="logo">
          Clip<span className="accent">Forge</span>
        </NavLink>
        <NavLink to="/" end>
          Queue
        </NavLink>
        <NavLink to="/runs" end>
          Runs
        </NavLink>
        <NavLink to="/runs/new">New run</NavLink>
        <NavLink to="/costs">Costs</NavLink>
        <span className="spacer" />
        {authEnabled ? (
          <>
            <span className="muted small">{session?.user.email}</span>
            <button className="btn btn-ghost" onClick={() => void supabase?.auth.signOut()}>
              Sign out
            </button>
          </>
        ) : (
          <span className="muted small" title="VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set">
            dev mode · no auth
          </span>
        )}
      </nav>
      <main>
        <Routes>
          <Route path="/" element={<QueuePage />} />
          <Route path="/runs" element={<RunsPage />} />
          <Route path="/runs/new" element={<NewRunPage />} />
          <Route path="/runs/:id" element={<RunDetailPage />} />
          <Route path="/costs" element={<CostsIndex />} />
          <Route path="/brands/:id/costs" element={<CostsPage />} />
          <Route path="*" element={<div className="empty">Not found.</div>} />
        </Routes>
      </main>
    </div>
  );
}
