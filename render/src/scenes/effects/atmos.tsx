/** Screen-wide effects: rain, snow, fireflies, dust, light rays, bubbles, lens flare, lightning, speed lines, aura. */
import React from "react";
import { strikeTimes } from "../camera";
import type { Ctx } from "../ctx";
import { jagged, mod, pts, rnd, rr, TAU, wobble, type Pt } from "../lib/math";
import { Glow, Layer, useSid } from "../lib/svg";

/** Slanted rain streaks in two depths plus ground splashes. */
export const Rain: React.FC<{ ctx: Ctx; front?: boolean; heavy?: number }> = ({ ctx, front, heavy = 1 }) => {
  const { VW, VH, t, seed, flash } = ctx;
  const n = Math.round((front ? 70 : 110) * heavy * (VW / 900 + 0.3) / 1.3);
  const speed = front ? 2600 : 1700;
  const len = front ? 90 : 55;
  const slant = 0.22;
  const col = flash > 0.2 ? "#ffffff" : "#b9c9e6";
  let d = "";
  for (let i = 0; i < n; i++) {
    const x0 = rnd(seed, "rx", front ? 1 : 0, i) * (VW + 600) - 300;
    const ph = rnd(seed, "ry", front ? 1 : 0, i);
    const y = mod(ph * (VH + 400) + t * speed, VH + 400) - 200;
    const x = x0 - y * slant + t * speed * slant * 0;
    d += `M${x.toFixed(1)},${y.toFixed(1)}l${(-len * slant).toFixed(1)},${len}`;
  }
  const splashes = [];
  if (front) {
    for (let i = 0; i < 26; i++) {
      const period = rr(seed, 0.35, 0.7, "sp", i);
      const u = mod(t / period + rnd(seed, "spo", i), 1);
      const slot = Math.floor(t / period + rnd(seed, "spo", i));
      const x = rnd(seed, "spx", i, slot) * VW;
      const y = ctx.groundY + rr(seed, 0, 140, "spy", i, slot);
      splashes.push(<ellipse key={i} cx={x} cy={y} rx={6 + u * 22} ry={2 + u * 5} fill="none" stroke={col} strokeWidth={2} opacity={(1 - u) * 0.6} />);
    }
  }
  return (
    <g>
      <path d={d} stroke={col} strokeWidth={front ? 3 : 1.8} opacity={front ? 0.55 : 0.35} strokeLinecap="round" />
      {splashes}
    </g>
  );
};

export const Snow: React.FC<{ ctx: Ctx; front?: boolean }> = ({ ctx, front }) => {
  const { VW, VH, t, seed } = ctx;
  const n = Math.round((front ? 45 : 90) * (VW / 900 + 0.4) / 1.4);
  const flakes = [];
  for (let i = 0; i < n; i++) {
    const k = front ? 1 : 0;
    const sp = front ? rr(seed, 140, 220, "sns", k, i) : rr(seed, 60, 120, "sns", k, i);
    const y = mod(rnd(seed, "sny", k, i) * (VH + 200) + t * sp, VH + 200) - 100;
    const x = mod(rnd(seed, "snx", k, i) * (VW + 200) + wobble(t * 0.8 + i, seed, `sw${i}`) * 40 - ctx.scroll * (front ? 1.3 : 0.5) - t * 30, VW + 200) - 100;
    const r = front ? rr(seed, 5, 10, "snr", k, i) : rr(seed, 2, 5, "snr", k, i);
    flakes.push(<circle key={i} cx={x} cy={y} r={r} fill="#ffffff" opacity={front ? 0.9 : 0.7} />);
  }
  return <g>{flakes}</g>;
};

/** Wandering, blinking fireflies. */
export const Fireflies: React.FC<{ ctx: Ctx; n?: number; area?: [number, number]; front?: boolean }> = ({ ctx, n = 22, area, front }) => {
  const { VW, VH, t, seed } = ctx;
  const [y0, y1] = area ?? [VH * 0.35, VH * 0.95];
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = front ? 1 : 0;
    const bx = rnd(seed, "ffx", k, i) * VW;
    const by = y0 + rnd(seed, "ffy", k, i) * (y1 - y0);
    const x = bx + wobble(t * 0.5, seed, `fx${k}${i}`) * 90 - ctx.scroll * 0.3;
    const y = by + wobble(t * 0.6, seed, `fy${k}${i}`) * 60;
    const on = Math.max(0, Math.sin(t * rr(seed, 1.2, 2.6, "ffs", k, i) + rnd(seed, "ffp", k, i) * TAU));
    const r = front ? 7 : 4;
    const xx = mod(x, VW + 100) - 50;
    out.push(
      <g key={i} opacity={0.25 + on * 0.75}>
        <Glow cx={xx} cy={y} r={r * 9} color="#d8ff6a" opacity={0.55} />
        <circle cx={xx} cy={y} r={r} fill="#f6ffc2" />
      </g>,
    );
  }
  return <g>{out}</g>;
};

/** Dust motes floating in light. */
export const Dust: React.FC<{ ctx: Ctx; color?: string; n?: number }> = ({ ctx, color = "#fff6d8", n = 40 }) => {
  const { VW, VH, t, seed } = ctx;
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = mod(rnd(seed, "dx", i) * VW + wobble(t * 0.3, seed, `dx${i}`) * 80 + t * 12 - ctx.scroll * 0.9, VW + 40) - 20;
    const y = mod(rnd(seed, "dy", i) * VH - t * rr(seed, 6, 20, "dvy", i) + wobble(t * 0.4, seed, `dy${i}`) * 50, VH);
    const r = rr(seed, 1.5, 4.5, "dr", i);
    out.push(<circle key={i} cx={x} cy={y} r={r} fill={color} opacity={0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t * 2 + i))} />);
  }
  return <g>{out}</g>;
};

/** God rays fanning from a point above the frame. */
export const LightRays: React.FC<{ ctx: Ctx; x?: number; y?: number; color?: string; n?: number; opacity?: number; spread?: number }> = ({ ctx, x, y, color = "#e6fbff", n = 7, opacity = 0.22, spread = 0.9 }) => {
  const id = useSid();
  const { VW, VH, t, seed } = ctx;
  const ox = x ?? VW * 0.35, oy = y ?? -VH * 0.1;
  const len = VH * 1.35;
  const rays = [];
  for (let i = 0; i < n; i++) {
    const a = Math.PI / 2 + (i / (n - 1) - 0.5) * spread + wobble(t * 0.25, seed, `ray${i}`) * 0.05;
    const w = rr(seed, 0.03, 0.08, "rw", i);
    const o = (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * rr(seed, 0.5, 1.2, "rs", i) + i * 2))) * opacity;
    const p1: Pt = [ox + Math.cos(a - w) * len, oy + Math.sin(a - w) * len];
    const p2: Pt = [ox + Math.cos(a + w) * len, oy + Math.sin(a + w) * len];
    rays.push(<polygon key={i} points={pts([[ox, oy], p1, p2])} fill={`url(#${id})`} opacity={o} />);
  }
  return (
    <g style={{ mixBlendMode: "screen" }}>
      <defs>
        <radialGradient id={id} cx={ox} cy={oy} r={len} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={color} stopOpacity={1} />
          <stop offset="0.7" stopColor={color} stopOpacity={0.35} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </radialGradient>
      </defs>
      {rays}
    </g>
  );
};

export const Bubbles: React.FC<{ ctx: Ctx; n?: number; from?: Pt; spread?: number }> = ({ ctx, n = 30, from, spread }) => {
  const { VW, VH, t, seed } = ctx;
  const out = [];
  for (let i = 0; i < n; i++) {
    const sp = rr(seed, 80, 200, "bs", i);
    const bx = from ? from[0] + (rnd(seed, "bx", i) - 0.5) * (spread ?? 60) : rnd(seed, "bx", i) * VW;
    const y0 = from ? from[1] : VH + 40;
    const range = from ? 500 : VH + 80;
    const age = mod(rnd(seed, "by", i) * range + t * sp, range);
    const y = y0 - age;
    const x = bx + Math.sin(t * 3 + i) * 10 - (from ? 0 : ctx.scroll * 0.4);
    const r = rr(seed, 3, 11, "br", i) * (from ? 0.7 : 1);
    out.push(
      <g key={i} opacity={from ? 1 - age / range : 0.8}>
        <circle cx={mod(x, VW + 60) - 30} cy={y} r={r} fill="none" stroke="#dff8ff" strokeWidth={2} opacity={0.7} />
        <circle cx={mod(x, VW + 60) - 30 - r * 0.35} cy={y - r * 0.35} r={r * 0.25} fill="#ffffff" opacity={0.8} />
      </g>,
    );
  }
  return <g>{out}</g>;
};

/** Lens flare streak + ghosts from a light source (screen coords) through the frame centre. */
export const LensFlare: React.FC<{ ctx: Ctx; sx: number; sy: number; strength?: number }> = ({ ctx, sx, sy, strength = 1 }) => {
  const { VW, VH, t } = ctx;
  const cx = VW / 2, cy = VH / 2;
  const dx = cx - sx, dy = cy - sy;
  const ghosts: [number, number, string, number][] = [
    [0.35, 22, "#ffd9a0", 0.14], [0.6, 50, "#9fd7ff", 0.06], [0.85, 12, "#ffffff", 0.16], [1.25, 70, "#ffb38a", 0.05], [1.55, 30, "#b6ffcf", 0.07],
  ];
  const pulse = 0.85 + 0.15 * Math.sin(t * 1.7);
  return (
    <g style={{ mixBlendMode: "screen" }} opacity={strength * pulse}>
      <Glow cx={sx} cy={sy} r={380} ry={26} color="#fff1cf" opacity={0.6} />
      <Glow cx={sx} cy={sy} r={160} color="#fff6e0" opacity={0.5} />
      {ghosts.map(([k, r, c, a], i) => (
        <circle key={i} cx={sx + dx * k} cy={sy + dy * k} r={r} fill={c} opacity={a} />
      ))}
    </g>
  );
};

/** Branching lightning bolt(s) in the sky + the ambient flash. Rendered behind the scenery. */
export const Lightning: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { VW, VH, t, seed } = ctx;
  const out: React.ReactNode[] = [];
  strikeTimes(seed, ctx.dur).forEach((st, i) => {
    const d = t - st;
    if (d < -0.02 || d > 0.5) return;
    const vis = d < 0.09 ? 1 : d < 0.13 ? 0.35 : d < 0.24 ? 0.95 : 0.6 * (1 - (d - 0.24) / 0.26);
    if (vis <= 0) return;
    const x = rr(seed, 0.15, 0.85, "bx", i) * VW;
    const end: Pt = [x + rr(seed, -250, 250, "bex", i), VH * rr(seed, 0.55, 0.75, "bey", i)];
    const main = jagged([x, -50], end, 16, 90, seed, `bolt${i}`);
    const branches: Pt[][] = [];
    for (let b = 0; b < 4; b++) {
      const from = main[2 + Math.floor(rnd(seed, "bb", i, b) * 10)]!;
      const to: Pt = [from[0] + rr(seed, -260, 260, "bbx", i, b), from[1] + rr(seed, 120, 300, "bby", i, b)];
      branches.push(jagged(from, to, 7, 45, seed, `br${i}${b}`));
    }
    out.push(
      <g key={i} opacity={vis} strokeLinecap="round" strokeLinejoin="round" fill="none">
        <Glow cx={x} cy={VH * 0.2} r={VW * 0.7} ry={VH * 0.35} color="#c9d6ff" opacity={0.55} />
        {[main, ...branches].map((p, j) => (
          <g key={j}>
            <polyline points={pts(p)} stroke="#9db8ff" strokeWidth={j ? 12 : 26} opacity={0.3} />
            <polyline points={pts(p)} stroke="#e4ecff" strokeWidth={j ? 3 : 7} />
          </g>
        ))}
        <polyline points={pts(main)} stroke="#ffffff" strokeWidth={3} />
      </g>,
    );
  });
  return <Layer ctx={ctx} depth={0.05} scrollFactor={0.1}>{out}</Layer>;
};

/** Horizontal wind streaks for fast flight. */
export const SpeedLines: React.FC<{ ctx: Ctx; n?: number; color?: string; y0?: number; y1?: number }> = ({ ctx, n = 16, color = "#ffffff", y0, y1 }) => {
  const { VW, VH, t, seed } = ctx;
  const a = y0 ?? VH * 0.15, b = y1 ?? VH * 0.75;
  const out = [];
  for (let i = 0; i < n; i++) {
    const sp = rr(seed, 1800, 3200, "sls", i);
    const len = rr(seed, 120, 380, "sll", i);
    const x = VW + 400 - mod(rnd(seed, "slx", i) * (VW + 800) + t * sp, VW + 800);
    const y = a + rnd(seed, "sly", i) * (b - a);
    out.push(<line key={i} x1={x} y1={y} x2={x + len} y2={y} stroke={color} strokeWidth={rr(seed, 1.5, 4, "slw", i)} strokeLinecap="round" opacity={0.28} />);
  }
  return <g>{out}</g>;
};

/** Glowing energy aura with rotating rays, centred at (x, y). */
export const Aura: React.FC<{ ctx: Ctx; x: number; y: number; r: number; color: string; ry?: number }> = ({ ctx, x, y, r, color, ry }) => {
  const { t, seed } = ctx;
  const pulse = 1 + 0.07 * Math.sin(t * 4) + 0.04 * Math.sin(t * 11);
  const rays = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU + t * 0.35 + wobble(t * 0.4, seed, `ar${i}`) * 0.1;
    const l = r * rr(seed, 1.1, 1.7, "arl", i) * (0.85 + 0.15 * Math.sin(t * 3 + i));
    const w = 0.06;
    rays.push(<polygon key={i} points={pts([[0, 0], [Math.cos(a - w) * l, Math.sin(a - w) * l * (ry ? ry / r : 1)], [Math.cos(a + w) * l, Math.sin(a + w) * l * (ry ? ry / r : 1)]])} fill={color} opacity={0.12} />);
  }
  return (
    <g transform={`translate(${x},${y})`} style={{ mixBlendMode: "screen" }}>
      {rays}
      <Glow cx={0} cy={0} r={r * 1.5 * pulse} ry={(ry ?? r) * 1.5 * pulse} color={color} opacity={0.55} />
      <Glow cx={0} cy={0} r={r * 0.8 * pulse} ry={(ry ?? r) * 0.8 * pulse} color="#ffffff" opacity={0.25} />
    </g>
  );
};
