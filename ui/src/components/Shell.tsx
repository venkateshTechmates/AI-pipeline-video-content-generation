import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Building2,
  ChartColumn,
  Inbox,
  Keyboard,
  ListVideo,
  LogOut,
  Menu,
  Monitor,
  Moon,
  Plus,
  Sun,
  Wallet,
  X,
} from "lucide-react";
import { money } from "../format";
import { isTypingTarget, useTheme, type ThemePref } from "../hooks";
import { useBrandScope, useQueue, useSpendToday } from "../state";
import { authEnabled, supabase } from "../supabase";
import { Kbd, Modal } from "./ui";

const NAV = [
  { to: "/", label: "Review queue", icon: Inbox, end: true, key: "q", badge: true },
  { to: "/runs", label: "Runs", icon: ListVideo, end: true, key: "r" },
  { to: "/runs/new", label: "New run", icon: Plus, end: true, key: "n" },
  { to: "/costs", label: "Costs", icon: ChartColumn, end: false, key: "c" },
  { to: "/brands", label: "Brands", icon: Building2, end: false, key: "b" },
] as const;

export function Shell({ children, email }: { children: ReactNode; email?: string | null }) {
  const [drawer, setDrawer] = useState(false);
  const [help, setHelp] = useState(false);
  const loc = useLocation();
  const nav = useNavigate();
  const queue = useQueue();
  const gPending = useRef(0);

  useEffect(() => setDrawer(false), [loc.pathname]);

  // Global shortcuts: ? = sheet, g+q/r/n/c/b = go to.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "?") {
        setHelp((h) => !h);
        e.preventDefault();
        return;
      }
      if (e.key === "g") {
        gPending.current = Date.now();
        return;
      }
      if (Date.now() - gPending.current < 1200) {
        const item = NAV.find((n) => n.key === e.key);
        gPending.current = 0;
        if (item) {
          nav(item.to);
          e.preventDefault();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav]);

  const count = queue.items.length;

  return (
    <div className={`shell ${drawer ? "drawer-open" : ""}`}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Primary">
        <div className="sidebar-head">
          <Logo />
          <button className="icon-btn only-mobile" aria-label="Close menu" onClick={() => setDrawer(false)}>
            <X size={18} />
          </button>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="nav-item">
              <n.icon size={17} aria-hidden />
              <span className="nav-label">{n.label}</span>
              {"badge" in n && count > 0 && (
                <span className="nav-badge" aria-label={`${count} awaiting review`}>
                  {count}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button className="nav-item" onClick={() => setHelp(true)}>
            <Keyboard size={17} aria-hidden />
            <span className="nav-label">Shortcuts</span>
            <Kbd>?</Kbd>
          </button>
          <ThemeSwitch />
          <div className="whoami">
            {authEnabled ? (
              <>
                <span className="avatar" aria-hidden>
                  {(email ?? "?").slice(0, 1).toUpperCase()}
                </span>
                <span className="whoami-email" title={email ?? ""}>
                  {email}
                </span>
                <button className="icon-btn" aria-label="Sign out" onClick={() => void supabase?.auth.signOut()}>
                  <LogOut size={16} />
                </button>
              </>
            ) : (
              <span className="muted small" title="VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set">
                <span className="dot-sep" /> Dev mode · no auth
              </span>
            )}
          </div>
        </div>
      </aside>
      <div className="scrim" onClick={() => setDrawer(false)} aria-hidden />

      <div className="main-col">
        <header className="topbar">
          <button className="icon-btn only-mobile" aria-label="Open menu" onClick={() => setDrawer(true)}>
            <Menu size={20} />
          </button>
          <span className="only-mobile topbar-logo">
            <Logo compact />
          </span>
          <BrandSwitcher />
          <span className="grow" />
          <SpendToday />
        </header>
        <main id="main" className="main" tabIndex={-1}>
          {children}
        </main>
      </div>

      <nav className="bottom-nav" aria-label="Primary (mobile)">
        {NAV.filter((n) => n.to !== "/brands").map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} className="bottom-item">
            <span className="bottom-icon">
              <n.icon size={20} aria-hidden />
              {"badge" in n && count > 0 && <span className="nav-badge nav-badge-dot">{count}</span>}
            </span>
            <span>{n.label.replace("Review queue", "Review")}</span>
          </NavLink>
        ))}
      </nav>

      <ShortcutSheet open={help} onClose={() => setHelp(false)} />
    </div>
  );
}

function Logo({ compact }: { compact?: boolean }) {
  return (
    <NavLink to="/" className="logo" aria-label="ClipForge home">
      <span className="logo-mark" aria-hidden>
        <svg viewBox="0 0 24 24" width="14" height="14">
          <path d="M8 5.5v13l10.5-6.5z" fill="currentColor" />
        </svg>
      </span>
      {!compact && (
        <span className="logo-text">
          ClipForge<span className="logo-sub">Console</span>
        </span>
      )}
    </NavLink>
  );
}

function BrandSwitcher() {
  const { brands, brandId, setBrandId } = useBrandScope();
  return (
    <label className="brand-switch">
      <span className="sr-only">Brand</span>
      <Building2 size={15} aria-hidden className="brand-switch-icon" />
      <select value={brandId} onChange={(e) => setBrandId(e.target.value)} aria-label="Brand scope">
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

function SpendToday() {
  const { spent, budget, ready } = useSpendToday();
  const ratio = budget > 0 && spent !== null ? spent / budget : 0;
  const tone = ratio > 1 ? "danger" : ratio > 0.8 ? "warn" : "success";
  return (
    <NavLink to="/costs" className="spend" title="Spend today (UTC) vs daily budget">
      <Wallet size={15} aria-hidden />
      <span className="spend-label">Today</span>
      <span className="spend-value tabular">{ready ? money(spent) : "—"}</span>
      {budget > 0 && (
        <>
          <span className="spend-budget tabular">/ {money(budget, 0)}</span>
          <span className="spend-track" aria-hidden>
            <span className={`spend-fill tone-bg-${tone}`} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
          </span>
        </>
      )}
    </NavLink>
  );
}

function ThemeSwitch() {
  const [pref, setPref] = useTheme();
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

const SHORTCUTS: { group: string; items: [string[], string][] }[] = [
  {
    group: "Review queue",
    items: [
      [["J"], "Next card"],
      [["K"], "Previous card"],
      [["A"], "Approve"],
      [["R"], "Regenerate… (then 1–6 to pick a stage)"],
      [["E"], "Edit script"],
      [["X"], "Reject with note"],
      [["O"], "Open run detail"],
      [["Space"], "Play / pause preview"],
    ],
  },
  {
    group: "Navigation",
    items: [
      [["G", "Q"], "Review queue"],
      [["G", "R"], "Runs"],
      [["G", "N"], "New run"],
      [["G", "C"], "Costs"],
      [["G", "B"], "Brands"],
      [["?"], "Toggle this sheet"],
    ],
  },
];

function ShortcutSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
      <div className="shortcuts">
        {SHORTCUTS.map((g) => (
          <div key={g.group}>
            <h3 className="eyebrow">{g.group}</h3>
            <dl>
              {g.items.map(([keys, what]) => (
                <div key={what} className="shortcut-row">
                  <dt>{what}</dt>
                  <dd>
                    {keys.map((k, i) => (
                      <span key={k}>
                        {i > 0 && <span className="muted small"> then </span>}
                        <Kbd>{k}</Kbd>
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
    </Modal>
  );
}
