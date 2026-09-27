import { useState } from "react";
import { supabase } from "./supabase";

export function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "magic">("password");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setMsg(null);
    try {
      if (mode === "magic") {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin + window.location.pathname },
        });
        if (error) throw error;
        setMsg({ ok: true, text: `Magic link sent to ${email}. Check your inbox.` });
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card card-body form" onSubmit={submit}>
        <div className="login-head">
          <span className="logo">
            <span className="logo-mark" aria-hidden>
              <svg viewBox="0 0 24 24" width="14" height="14">
                <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
              </svg>
            </span>
            <span className="logo-text">
              ClipForge<span className="logo-sub">Console</span>
            </span>
          </span>
          <p className="muted small">Sign in to review and publish runs.</p>
        </div>
        <div className="segmented" role="radiogroup" aria-label="Sign-in method">
          <button type="button" role="radio" aria-checked={mode === "password"} className={mode === "password" ? "active" : ""} onClick={() => setMode("password")}>
            Password
          </button>
          <button type="button" role="radio" aria-checked={mode === "magic"} className={mode === "magic" ? "active" : ""} onClick={() => setMode("magic")}>
            Magic link
          </button>
        </div>
        <label className="field">
          Email
          <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode === "password" && (
          <label className="field">
            Password
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "…" : mode === "magic" ? "Send magic link" : "Sign in"}
        </button>
        {msg && <div className={msg.ok ? "ok-box" : "alert tone-danger"}>{msg.text}</div>}
      </form>
    </div>
  );
}
