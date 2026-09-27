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
      <form className="panel form" onSubmit={submit}>
        <h1>
          Clip<span className="accent">Forge</span> review
        </h1>
        <div className="tabs">
          <button type="button" className={mode === "password" ? "active" : ""} onClick={() => setMode("password")}>
            Password
          </button>
          <button type="button" className={mode === "magic" ? "active" : ""} onClick={() => setMode("magic")}>
            Magic link
          </button>
        </div>
        <label>
          Email
          <input type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode === "password" && (
          <label>
            Password
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? "…" : mode === "magic" ? "Send magic link" : "Sign in"}
        </button>
        {msg && <div className={msg.ok ? "ok-box" : "error-box"}>{msg.text}</div>}
      </form>
    </div>
  );
}
