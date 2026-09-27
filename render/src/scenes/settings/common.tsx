/** Sky, sun/moon, stars, clouds and procedural ridgelines shared by the outdoor settings. */
import React from "react";
import type { Ctx } from "../ctx";
import { mix } from "../lib/color";
import { mod, rnd, rr, TAU } from "../lib/math";
import { Glow, Layer, tiles, useSid, visibleX } from "../lib/svg";
import { Lightning } from "../effects/atmos";

/** Sky-level effects drawn between the sky and the scenery (lightning bolts). */
export const SkyFx: React.FC<{ ctx: Ctx }> = ({ ctx }) => (ctx.spec.effects.includes("lightning") ? <Lightning ctx={ctx} /> : null);

/** Smooth deterministic height field in [-1, 1] over world x. */
export const hillNoise = (x: number, seed: number, key: string | number, scale = 1): number => {
  const p = rnd(seed, "hill", key) * 1000;
  const f = 0.0021 / scale;
  return (
    Math.sin(x * f + p) * 0.5 +
    Math.sin(x * f * 2.13 + p * 1.3) * 0.28 +
    Math.sin(x * f * 4.71 + p * 0.7) * 0.14 +
    Math.sin(x * f * 9.3 + p * 2.1) * 0.08
  );
};
/** Sharp-peaked ridge field in [0, 1]. */
export const ridgeNoise = (x: number, seed: number, key: string | number, scale = 1): number => {
  const p = rnd(seed, "ridge", key) * 1000;
  const f = 0.0026 / scale;
  const r = (v: number) => 1 - Math.abs(Math.sin(v));
  return r(x * f + p) * 0.55 + r(x * f * 2.2 + p * 1.7) * 0.28 + r(x * f * 5.1 + p * 0.3) * 0.12 + Math.sin(x * f * 13 + p) * 0.05;
};

/** Filled silhouette from a height function, visible range only. */
export const ridgePath = (ctx: Ctx, depth: number, h: (x: number) => number, bottom: number, step = 24): string => {
  const [a, b] = visibleX(ctx, depth, 300);
  const x0 = Math.floor(a / step) * step;
  let d = `M${x0},${bottom}`;
  for (let x = x0; x <= b + step; x += step) d += `L${x},${h(x).toFixed(1)}`;
  return d + `L${Math.ceil(b / step) * step + step},${bottom}Z`;
};

export const Sky: React.FC<{ ctx: Ctx; top?: string; mid?: string; low?: string; horizon?: number }> = ({ ctx, top, mid, low, horizon }) => {
  const id = useSid();
  const { pal, VW, VH, flash } = ctx;
  const hz = horizon ?? 0.62;
  const f = (c: string) => (flash > 0 ? mix(c, "#b9c8ff", flash * 0.55) : c);
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={f(top ?? pal.skyTop)} />
          <stop offset={hz * 0.6} stopColor={f(mid ?? pal.skyMid)} />
          <stop offset={hz} stopColor={f(low ?? pal.skyLow)} />
          <stop offset="1" stopColor={f(low ?? pal.skyLow)} />
        </linearGradient>
      </defs>
      <rect x={-400} y={-400} width={VW + 800} height={VH + 800} fill={`url(#${id})`} />
    </>
  );
};

export const Stars: React.FC<{ ctx: Ctx; n?: number; maxY?: number }> = ({ ctx, n, maxY = 0.7 }) => {
  const { VW, VH, t, seed, pal } = ctx;
  const count = n ?? pal.stars;
  if (!count) return null;
  const items = [];
  for (let i = 0; i < count; i++) {
    const x = rnd(seed, "sx", i) * (VW + 200) - 100;
    const y = Math.pow(rnd(seed, "sy", i), 1.4) * VH * maxY - 50;
    const r = 0.8 + Math.pow(rnd(seed, "sr", i), 3) * 3.2;
    const tw = 0.55 + 0.45 * Math.sin(t * rr(seed, 1.5, 5, "sw", i) + rnd(seed, "sp", i) * TAU);
    items.push(<circle key={i} cx={x} cy={y} r={r} fill={i % 7 === 0 ? "#ffe9c4" : i % 5 === 0 ? "#c9dcff" : "#ffffff"} opacity={tw * (1 - ctx.flash * 0.8)} />);
    if (r > 3) items.push(<Glow key={`g${i}`} cx={x} cy={y} r={r * 5} color="#dfe8ff" opacity={tw * 0.5} />);
  }
  return <Layer ctx={ctx} depth={0.02} scrollFactor={0.2}>{items}</Layer>;
};

/** Sun (with halo) or moon (with craters and halo). */
export const Orb: React.FC<{ ctx: Ctx; y?: number; x?: number; rise?: number }> = ({ ctx, x, y, rise = 0 }) => {
  const { pal, VW, VH, t } = ctx;
  const o = pal.orb;
  if (!o) return null;
  const cx = (x ?? o.x) * VW;
  const cy = (y ?? o.y) * VH - rise * t;
  const pulse = 1 + Math.sin(t * 1.3) * 0.03;
  return (
    <Layer ctx={ctx} depth={0.03} scrollFactor={0}>
      <Glow cx={cx} cy={cy} r={o.r * 9 * pulse} color={o.glow} opacity={o.moon ? 0.35 : 0.55} />
      <Glow cx={cx} cy={cy} r={o.r * 3.2} color={o.glow} opacity={o.moon ? 0.5 : 0.8} />
      <circle cx={cx} cy={cy} r={o.r} fill={o.color} />
      {o.moon ? (
        <g opacity={0.16} fill="#6a6f8c">
          <circle cx={cx - o.r * 0.3} cy={cy - o.r * 0.2} r={o.r * 0.22} />
          <circle cx={cx + o.r * 0.35} cy={cy + o.r * 0.25} r={o.r * 0.16} />
          <circle cx={cx + o.r * 0.1} cy={cy - o.r * 0.5} r={o.r * 0.1} />
          <circle cx={cx - o.r * 0.25} cy={cy + o.r * 0.45} r={o.r * 0.12} />
        </g>
      ) : (
        <circle cx={cx} cy={cy} r={o.r * 0.82} fill="#ffffff" opacity={0.45} />
      )}
    </Layer>
  );
};

/** One puffy flat cloud centred at (0,0), width ~w. */
export const CloudShape: React.FC<{ w: number; seed: number; k: string | number; fill: string; shade: string; opacity?: number }> = ({ w, seed, k, fill, shade, opacity = 1 }) => {
  const id = useSid();
  const bumps = 4 + Math.floor(rnd(seed, "cb", k) * 3);
  const circles = [];
  for (let i = 0; i < bumps; i++) {
    const u = (i + 0.5) / bumps;
    const r = w * (0.13 + 0.14 * Math.sin(Math.PI * u)) * rr(seed, 0.8, 1.2, "cr", k, i);
    circles.push(<circle key={i} cx={(u - 0.5) * w * 0.8} cy={-r * 0.55} r={r} />);
  }
  return (
    <g opacity={opacity}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.2" stopColor={fill} />
          <stop offset="1" stopColor={shade} />
        </linearGradient>
      </defs>
      <g fill={`url(#${id})`}>
        {circles}
        <rect x={-w * 0.45} y={-w * 0.12} width={w * 0.9} height={w * 0.12} rx={w * 0.06} />
      </g>
    </g>
  );
};

/** Drifting cloud band at a given depth. */
export const Clouds: React.FC<{ ctx: Ctx; depth: number; y: number; spread?: number; size?: number; density?: number; speed?: number; opacity?: number; k?: string; fill?: string; shade?: string }> = ({
  ctx, depth, y, spread = 200, size = 420, density = 0.7, speed = 18, opacity = 1, k = "c", fill, shade,
}) => {
  const { seed, t, pal, flash } = ctx;
  const spacing = size * 1.3;
  const drift = t * speed;
  const f = fill ?? pal.cloud, s = shade ?? pal.cloudShade;
  const fc = flash > 0 ? mix(f, "#dfe6ff", flash * 0.7) : f;
  const sc = flash > 0 ? mix(s, "#8e9bd0", flash * 0.6) : s;
  return (
    <Layer ctx={ctx} depth={depth}>
      <g transform={`translate(${drift},0)`}>
        {tiles(ctx, depth, spacing, spacing * 2).map(({ i }) => {
          const ii = i - Math.floor(drift / spacing);
          if (rnd(seed, k, "has", ii) > density) return null;
          const cx = ii * spacing + rr(seed, -0.3, 0.3, k, "x", ii) * spacing;
          const cy = y + rr(seed, -1, 1, k, "y", ii) * spread;
          const w = size * rr(seed, 0.6, 1.4, k, "w", ii);
          return (
            <g key={ii} transform={`translate(${cx},${cy})`}>
              <CloudShape w={w} seed={seed} k={`${k}${ii}`} fill={fc} shade={sc} opacity={opacity} />
            </g>
          );
        })}
      </g>
    </Layer>
  );
};

/** Hazy band that sits on the horizon for depth. */
export const HorizonHaze: React.FC<{ ctx: Ctx; y: number; h?: number; color?: string; opacity?: number }> = ({ ctx, y, h = 260, color, opacity = 0.6 }) => {
  const id = useSid();
  const c = color ?? ctx.pal.haze;
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c} stopOpacity={0} />
          <stop offset="0.5" stopColor={c} stopOpacity={opacity} />
          <stop offset="1" stopColor={c} stopOpacity={0} />
        </linearGradient>
      </defs>
      <rect x={-400} y={y - h / 2} width={ctx.VW + 800} height={h} fill={`url(#${id})`} />
    </>
  );
};

/** A simple conifer silhouette with a lighter side, base at (0,0). */
export const Pine: React.FC<{ h: number; fill: string; light?: string; snow?: boolean; sway?: number }> = ({ h, fill, light, snow, sway = 0 }) => {
  const w = h * 0.42;
  const tiers = 4;
  const parts = [];
  for (let i = 0; i < tiers; i++) {
    const top = -h + (i * h * 0.72) / tiers;
    const bottom = top + h * 0.38;
    const ww = w * (0.45 + (0.55 * (i + 1)) / tiers);
    const sx = sway * (1 - i / tiers);
    parts.push(
      <g key={i}>
        <path d={`M${sx},${top} L${ww / 2 + sx * 0.5},${bottom} Q${sx * 0.5},${bottom + h * 0.04} ${-ww / 2 + sx * 0.5},${bottom}Z`} fill={fill} />
        {light ? <path d={`M${sx},${top} L${ww / 2 + sx * 0.5},${bottom} Q${ww * 0.2},${bottom + h * 0.02} ${sx * 0.6},${bottom - h * 0.02}Z`} fill={light} /> : null}
        {snow ? <path d={`M${sx},${top} L${ww * 0.22 + sx * 0.8},${top + h * 0.16} Q${sx},${top + h * 0.12} ${-ww * 0.22 + sx * 0.8},${top + h * 0.16}Z`} fill="#f4f8ff" /> : null}
      </g>,
    );
  }
  return (
    <g>
      <rect x={-h * 0.03} y={-h * 0.12} width={h * 0.06} height={h * 0.12} fill={fill} />
      {parts}
    </g>
  );
};

/** Ground band with a gradient from `top` to `bottom`. */
export const Ground: React.FC<{ ctx: Ctx; y: number; top: string; bottom: string; depth?: number; curve?: number }> = ({ ctx, y, top, bottom, depth = 1, curve = 0 }) => {
  const id = useSid();
  const { VH } = ctx;
  return (
    <Layer ctx={ctx} depth={depth}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={top} />
          <stop offset="1" stopColor={bottom} />
        </linearGradient>
      </defs>
      <path d={ridgePath(ctx, depth, (x) => y + hillNoise(x, ctx.seed, "g" + depth) * curve, VH + 600, 40)} fill={`url(#${id})`} />
    </Layer>
  );
};

/** Fraction t over a repeating period (for looping ambient motion). */
export const cyc = (t: number, period: number, phase = 0): number => mod(t / period + phase, 1);
