import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Building2, ChartColumn, ExternalLink, GanttChart, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { API_URL, getHealth, MOCK, onHealth, reviewUiHome } from "../api";
import { useTheme, type ThemePref } from "../hooks";
import { useBrandScope } from "../state";
import { authEnabled, supabase } from "../supabase";

const NAV = [
  { to: "/", label: "Traces", icon: GanttChart, end: false, match: (p: string) => p === "/" || p.startsWith("/traces") },
  { to: "/stats", label: "Stats", icon: ChartColumn, end: true, match: (p: string) => p.startsWith("/stats") },
];

export function Shell({ children, email }: { children: ReactNode; email?: string | null }) {
  const loc = useLocation();
  const [pref, setPref] = useTheme();

  useEffect(() => {
    document.getElementById("main")?.scrollTo?.(0, 0);
  }, [loc.pathname]);

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Primary">
        <div className="sidebar-head">
          <Logo />
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              className={() => `nav-item ${n.match(loc.pathname) ? "active" : ""}`}
              aria-current={n.match(loc.pathname) ? "page" : undefined}
            >
              <n.icon size={17} aria-hidden />
              <span className="nav-label">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <ApiIndicator />
          <ThemeSwitch pref={pref} setPref={setPref} />
          <div className="whoami">
            {authEnabled ? (
              <>
                <span className="whoami-email" title={email ?? ""}>
                  {email}
                </span>
                <button className="icon-btn" aria-label="Sign out" onClick={() => void supabase?.auth.signOut()}>
                  <LogOut size={16} />
                </button>
              </>
            ) : (
              <span title="VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set">
                <span className="dot-sep" /> Dev mode · no auth
              </span>
            )}
          </div>
        </div>
      </aside>

      <div className="main-col">
        <header className="topbar">
          <span className="only-mobile">
            <Logo compact />
          </span>
          <BrandSwitcher />
          <span className="grow hide-mobile" />
          <span className="only-mobile">
            <HealthDot />
          </span>
          <a className="topbar-link hide-mobile" href={reviewUiHome()} target="_blank" rel="noreferrer">
            Review UI <ExternalLink size={13} aria-hidden />
          </a>
        </header>
        <main id="main" className="main" tabIndex={-1}>
          {children}
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Primary (mobile)">
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to} className={() => `bottom-item ${n.match(loc.pathname) ? "active" : ""}`}>
            <n.icon size={20} aria-hidden />
            <span>{n.label}</span>
          </NavLink>
        ))}
        <button
          type="button"
          className="bottom-item"
          onClick={() => setPref(pref === "system" ? "light" : pref === "light" ? "dark" : "system")}
          aria-label={`Theme: ${pref}. Tap to change.`}
        >
          {pref === "light" ? <Sun size={20} aria-hidden /> : pref === "dark" ? <Moon size={20} aria-hidden /> : <Monitor size={20} aria-hidden />}
          <span>Theme</span>
        </button>
      </nav>
    </div>
  );
}

export function Logo({ compact }: { compact?: boolean }) {
  return (
    <NavLink to="/" className="logo" aria-label="ClipForge Tracing home">
      <span className="logo-mark" aria-hidden>
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor">
          <rect x="3" y="5" width="11" height="3" rx="1.5" />
          <rect x="7" y="10.5" width="13" height="3" rx="1.5" opacity=".85" />
          <rect x="11" y="16" width="7" height="3" rx="1.5" opacity=".7" />
        </svg>
      </span>
      {!compact && (
        <span className="logo-text">
          ClipForge<span className="logo-sub">Tracing</span>
        </span>
      )}
    </NavLink>
  );
}

function useHealth() {
  const [h, setH] = useState(getHealth());
  useEffect(() => onHealth(setH), []);
  return h;
}

function HealthDot() {
  const h = useHealth();
  return (
    <span
      className={`health-dot ${h.ok === true ? "ok" : h.ok === false ? "bad" : ""}`}
      role="img"
      aria-label={h.ok === false ? `API unreachable: ${h.message ?? ""}` : h.ok ? "API connected" : "API: connecting"}
      title={`${API_URL}${MOCK ? " (mock data)" : ""}`}
    />
  );
}

function ApiIndicator() {
  const h = useHealth();
  const state = h.ok === true ? "Connected" : h.ok === false ? "Unreachable" : "Connecting…";
  return (
    <div className="api-card" title={h.message ?? `${state} · ${API_URL}`}>
      <div className="api-card-head">
        <HealthDot />
        <span>API · {MOCK ? "Fixtures" : state}</span>
        {MOCK && <span className="mock-badge">MOCK</span>}
      </div>
      <div className="api-url" title={API_URL}>
        {MOCK ? "src/mock.ts" : (API_URL.startsWith("/") ? `${location.host}${API_URL}` : API_URL.replace(/^https?:\/\//, ""))}
      </div>
    </div>
  );
}

function ThemeSwitch({ pref, setPref }: { pref: ThemePref; setPref: (t: ThemePref) => void }) {
  const opts: { id: ThemePref; icon: typeof Sun; label: string }[] = [
    { id: "light", icon: Sun, label: "Light" },
    { id: "system", icon: Monitor, label: "System" },
    { id: "dark", icon: Moon, label: "Dark" },
  ];
  return (
    <div className="theme-switch" role="radiogroup" aria-label="Theme">
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={pref === o.id}
          aria-label={o.label}
          title={o.label}
          className={pref === o.id ? "active" : ""}
          onClick={() => setPref(o.id)}
        >
          <o.icon size={14} />
        </button>
      ))}
    </div>
  );
}

function BrandSwitcher() {
  const { brands, brandId, setBrandId } = useBrandScope();
  return (
    <label className="brand-switch">
      <span className="sr-only">Brand</span>
      <Building2 size={15} aria-hidden className="brand-switch-icon" />
      <select value={brandId} onChange={(e) => setBrandId(e.target.value)} aria-label="Brand filter">
        <option value="">All brands</option>
        {brands.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
    </label>
  );
}
