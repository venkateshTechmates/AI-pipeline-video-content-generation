/** Forest, savanna, meadow, mountains, ice and open-sky settings. */
import React from "react";
import type { Ctx } from "../ctx";
import { darken, lighten, mix } from "../lib/color";
import { mod, rnd, rr, smoothPath, TAU, wobble, type Pt } from "../lib/math";
import { Layer, tiles, useSid, visibleX } from "../lib/svg";
import { Clouds, Ground, HorizonHaze, hillNoise, Orb, Pine, ridgeNoise, ridgePath, Sky, SkyFx, Stars } from "./common";

const snowy = (ctx: Ctx) => ctx.spec.weather === "snow" || ctx.spec.setting === "ice";

/** Leafy tree: trunk + clustered two-tone canopy, swaying. Base at (0,0). */
export const LeafTree: React.FC<{ h: number; leaf: string; trunk: string; seed: number; k: string | number; sway: number; light?: string }> = ({ h, leaf, trunk, seed, k, sway, light }) => {
  const blobs = [];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rnd(seed, "lt", k, i);
    const r = h * rr(seed, 0.16, 0.24, "ltr", k, i);
    const cx = Math.cos(a) * h * 0.2 + sway * 1.2;
    const cy = -h * 0.72 + Math.sin(a) * h * 0.14;
    blobs.push([cx, cy, r] as const);
  }
  return (
    <g>
      <path d={`M${-h * 0.035},0 Q${-h * 0.02},${-h * 0.35} ${sway * 0.5 - h * 0.01},${-h * 0.62} L${sway * 0.5 + h * 0.01},${-h * 0.62} Q${h * 0.02},${-h * 0.35} ${h * 0.035},0Z`} fill={trunk} />
      <path d={`M${sway * 0.3},${-h * 0.45} L${sway * 0.6 + h * 0.12},${-h * 0.62}`} stroke={trunk} strokeWidth={h * 0.02} />
      <g fill={leaf}>
        {blobs.map(([x, y, r], i) => <circle key={i} cx={x} cy={y} r={r} />)}
        <circle cx={sway * 1.2} cy={-h * 0.74} r={h * 0.24} />
      </g>
      {light ? (
        <g fill={light} opacity={0.9}>
          {blobs.slice(0, 3).map(([x, y, r], i) => <circle key={i} cx={x - r * 0.25} cy={y - r * 0.3} r={r * 0.6} />)}
        </g>
      ) : null}
    </g>
  );
};

/** Flat-topped acacia, base at (0,0). */
const Acacia: React.FC<{ h: number; fill: string; sway: number }> = ({ h, fill, sway }) => (
  <g fill={fill}>
    <path d={`M${-h * 0.03},0 L${-h * 0.015},${-h * 0.5} L${-h * 0.25 + sway},${-h * 0.82} L${-h * 0.22 + sway},${-h * 0.84} L${sway * 0.5},${-h * 0.58} L${h * 0.2 + sway},${-h * 0.86} L${h * 0.23 + sway},${-h * 0.84} L${h * 0.02},${-h * 0.48} L${h * 0.03},0Z`} />
    <ellipse cx={-h * 0.15 + sway} cy={-h * 0.9} rx={h * 0.34} ry={h * 0.08} />
    <ellipse cx={h * 0.18 + sway} cy={-h * 0.92} rx={h * 0.3} ry={h * 0.07} />
    <ellipse cx={sway} cy={-h * 0.97} rx={h * 0.24} ry={h * 0.06} />
  </g>
);

/** Swaying grass tufts along a line. */
const GrassBand: React.FC<{ ctx: Ctx; depth: number; y: number; color: string; tip?: string; h: number; spacing: number; k: string; flowers?: boolean }> = ({ ctx, depth, y, color, tip, h, spacing, k, flowers }) => {
  const { t, seed } = ctx;
  let d = "";
  let dt = "";
  const fl: React.ReactNode[] = [];
  for (const { i, x } of tiles(ctx, depth, spacing, spacing * 3)) {
    const hh = h * rr(seed, 0.5, 1.2, k, "h", i);
    const bx = x + rr(seed, -0.4, 0.4, k, "x", i) * spacing;
    const by = y + rr(seed, -0.5, 0.5, k, "y", i) * h * 0.5;
    const blades = 3 + Math.floor(rnd(seed, k, "b", i) * 3);
    for (let b = 0; b < blades; b++) {
      const lean = (b - blades / 2) * 0.35 + wobble(t * 1.4 + bx * 0.004, seed, "wind") * 0.35 + Math.sin(t * 2.2 + bx * 0.01) * 0.12;
      const bh = hh * (0.7 + 0.3 * Math.sin(b * 2.1 + i));
      const tx = bx + b * 6 + Math.sin(lean) * bh, ty = by - Math.cos(lean) * bh;
      const w = Math.max(3, h * 0.05);
      d += `M${bx + b * 6 - w},${by} Q${bx + b * 6 + Math.sin(lean) * bh * 0.4},${by - bh * 0.6} ${tx},${ty} Q${bx + b * 6 + Math.sin(lean) * bh * 0.4 + w},${by - bh * 0.5} ${bx + b * 6 + w},${by}Z`;
      if (tip) dt += `M${tx},${ty} l${-2},${bh * 0.25} l${4},0Z`;
    }
    if (flowers && rnd(seed, k, "f", i) < 0.5) {
      const fx = bx + Math.sin(t * 2 + i) * 6, fy = by - hh * 0.8;
      const fc = ["#ff6b8b", "#ffd166", "#ffffff", "#b48cff", "#ff9f43"][i & 3 ? Math.floor(rnd(seed, k, "fc", i) * 5) : 0]!;
      fl.push(
        <g key={i}>
          <path d={`M${bx},${by} Q${bx + 4},${by - hh * 0.4} ${fx},${fy}`} stroke={color} strokeWidth={3} fill="none" />
          {[0, 1, 2, 3, 4].map((p) => <circle key={p} cx={fx + Math.cos((p / 5) * TAU + t) * h * 0.07} cy={fy + Math.sin((p / 5) * TAU + t) * h * 0.07} r={h * 0.06} fill={ctx.lit(fc)} />)}
          <circle cx={fx} cy={fy} r={h * 0.045} fill={ctx.lit("#ffcf3f")} />
        </g>,
      );
    }
  }
  return (
    <Layer ctx={ctx} depth={depth}>
      <path d={d} fill={color} />
      {tip ? <path d={dt} fill={tip} /> : null}
      {fl}
    </Layer>
  );
};

/** Distant flock of flapping birds. */
export const FarBirds: React.FC<{ ctx: Ctx; y: number; n?: number; color?: string }> = ({ ctx, y, n = 5, color }) => {
  const { t, seed, VW } = ctx;
  const c = color ?? darken(ctx.pal.haze, 0.5);
  const out = [];
  for (let i = 0; i < n; i++) {
    const x = mod(rnd(seed, "fbx", i) * VW * 0.4 + t * 60 + i * 50, VW + 400) - 200;
    const yy = y + rr(seed, -60, 60, "fby", i) + Math.sin(t * 1.3 + i) * 8;
    const f = Math.sin(t * 9 + i * 1.7) * 9;
    out.push(<path key={i} d={`M${x - 16},${yy - f} Q${x - 8},${yy - 6} ${x},${yy} Q${x + 8},${yy - 6} ${x + 16},${yy - f}`} stroke={c} strokeWidth={3} fill="none" strokeLinecap="round" />);
  }
  return <Layer ctx={ctx} depth={0.1}>{out}</Layer>;
};

// ---------------------------------------------------------------------------

export const ForestBack: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { VH, pal, t, seed } = ctx;
  const g = forestGround(VH);
  const snow = snowy(ctx);
  const night = pal.night;
  const pineFar = mix(night ? "#1c3a45" : "#2f6b5a", pal.haze, 0.62);
  const pineMid = mix(night ? "#10262e" : "#23584a", pal.haze, 0.35);
  const leaf = ctx.lit(night ? "#1e4a3e" : "#3f8f5a");
  const trunk = ctx.lit("#5a3a2a");
  return (
    <>
      <Sky ctx={ctx} horizon={0.66} />
      <Stars ctx={ctx} maxY={0.5} />
      <Orb ctx={ctx} />
      <SkyFx ctx={ctx} />
      <Clouds ctx={ctx} depth={0.05} y={VH * 0.2} size={460} density={0.5} opacity={0.85} />
      <Layer ctx={ctx} depth={0.08}>
        <path d={ridgePath(ctx, 0.08, (x) => g - 260 + hillNoise(x, seed, "fh") * 90, VH + 400)} fill={mix(pineFar, pal.haze, 0.45)} />
      </Layer>
      <Layer ctx={ctx} depth={0.18}>
        {tiles(ctx, 0.18, 46, 100).map(({ i, x }) => (
          <g key={i} transform={`translate(${x + rr(seed, -15, 15, "fp", i)},${g - 150 + rr(seed, -20, 20, "fpy", i)})`}>
            <Pine h={rr(seed, 150, 260, "fph", i)} fill={pineFar} snow={snow} />
          </g>
        ))}
        <rect x={-9000} y={g - 152} width={30000} height={600} fill={pineFar} />
      </Layer>
      <HorizonHaze ctx={ctx} y={g - 150} h={220} opacity={0.5} />
      <Layer ctx={ctx} depth={0.4}>
        {tiles(ctx, 0.4, 150, 200).map(({ i, x }) => {
          const sway = Math.sin(t * 0.9 + i) * 6;
          const yy = g - 60 + rr(seed, -15, 15, "mpy", i);
          return (
            <g key={i} transform={`translate(${x + rr(seed, -40, 40, "mp", i)},${yy})`}>
              {rnd(seed, "mk", i) < 0.65 || snow ? <Pine h={rr(seed, 280, 480, "mph", i)} fill={pineMid} light={lighten(pineMid, 0.08)} snow={snow} sway={sway} /> : <LeafTree h={rr(seed, 300, 420, "mlh", i)} leaf={mix(leaf, pal.haze, 0.3)} trunk={mix(trunk, pal.haze, 0.3)} seed={seed} k={`m${i}`} sway={sway} />}
            </g>
          );
        })}
      </Layer>
      <Ground ctx={ctx} y={g} top={ctx.lit(snow ? "#eef4fb" : night ? "#1f3b2e" : "#5f9a4b")} bottom={ctx.lit(snow ? "#b9cbe0" : night ? "#0f2019" : "#3b6b35")} curve={14} />
      <Layer ctx={ctx} depth={0.75}>
        {tiles(ctx, 0.75, 520, 400).map(({ i, x }) => {
          if (rnd(seed, "nt", i) < 0.35) return null;
          const sway = Math.sin(t * 0.8 + i * 1.3) * 10;
          const h = rr(seed, 700, 980, "nth", i);
          return (
            <g key={i} transform={`translate(${x + rr(seed, -100, 100, "ntx", i)},${g + 20})`}>
              {snow || rnd(seed, "ntk", i) < 0.5 ? <Pine h={h} fill={ctx.lit(night ? "#0f2a26" : "#1f5a45")} light={ctx.lit(night ? "#16362f" : "#2b7257")} snow={snow} sway={sway} /> : <LeafTree h={h} leaf={leaf} light={lighten(leaf, 0.12)} trunk={trunk} seed={seed} k={`n${i}`} sway={sway} />}
            </g>
          );
        })}
      </Layer>
      <GrassBand ctx={ctx} depth={1} y={g + 8} color={ctx.lit(snow ? "#d7e3f0" : "#4d8a3f")} h={snow ? 16 : 34} spacing={60} k="fg" />
    </>
  );
};
export const ForestFront: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { VH, t, seed, pal } = ctx;
  const snow = snowy(ctx);
  const c = ctx.lit(snow ? "#c3d2e4" : pal.night ? "#0c1d17" : "#2d5e33");
  return (
    <Layer ctx={ctx} depth={1.35}>
      {tiles(ctx, 1.35, 380, 300).map(({ i, x }) => {
        if (rnd(seed, "fb", i) < 0.45) return null;
        const s = rr(seed, 0.8, 1.3, "fbs", i);
        const sw = Math.sin(t * 1.5 + i) * 8;
        const pts: Pt[] = [[-180 * s, 0], [-150 * s + sw, -90 * s], [-60 * s + sw, -150 * s], [40 * s + sw, -130 * s], [150 * s + sw, -80 * s], [190 * s, 0]];
        return <path key={i} d={smoothPath(pts, true)} transform={`translate(${x},${VH + 40})`} fill={c} />;
      })}
    </Layer>
  );
};
export const forestGround = (VH: number) => VH * 0.8;

// ---------------------------------------------------------------------------

export const SavannaBack: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { VH, pal, t, seed } = ctx;
  const g = savannaGround(VH);
  const night = pal.night;
  const mesa = mix(night ? "#2a2a4a" : "#b0665a", pal.haze, 0.55);
  const tree = mix(ctx.lit("#3b2a2a"), pal.haze, 0.25);
  const grass = ctx.lit(night ? "#6b6a3a" : "#e0b057");
  return (
    <>
      <Sky ctx={ctx} horizon={0.7} />
      <Stars ctx={ctx} maxY={0.5} />
      <Orb ctx={ctx} />
      <SkyFx ctx={ctx} />
      <Clouds ctx={ctx} depth={0.04} y={VH * 0.25} size={600} density={0.45} opacity={0.75} spread={120} />
      <FarBirds ctx={ctx} y={VH * 0.33} n={6} />
      <Layer ctx={ctx} depth={0.06}>
        <path d={ridgePath(ctx, 0.06, (x) => {
          const n = hillNoise(x, seed, "mesa", 1.5);
          return g - 70 - Math.max(0, Math.min(1, (n + 0.1) * 3)) * 150;
        }, VH + 400, 16)} fill={mesa} />
      </Layer>
      <HorizonHaze ctx={ctx} y={g - 40} h={180} opacity={0.6} />
      {/* heat shimmer */}
      <g opacity={night ? 0 : 0.35}>
        {[0, 1, 2, 3].map((i) => {
          const yy = g - 30 + i * 14;
          let d = `M-100,${yy}`;
          for (let x = -100; x <= ctx.VW + 100; x += 40) d += `L${x},${yy + Math.sin(x * 0.03 + t * 6 + i) * 3}`;
          return <path key={i} d={d} stroke={lighten(pal.skyLow, 0.4)} strokeWidth={3} fill="none" />;
        })}
      </g>
      <Layer ctx={ctx} depth={0.22}>
        {tiles(ctx, 0.22, 420, 400).map(({ i, x }) => rnd(seed, "ac", i) < 0.55 ? (
          <g key={i} transform={`translate(${x + rr(seed, -120, 120, "acx", i)},${g - 18})`}>
            <Acacia h={rr(seed, 160, 260, "ach", i)} fill={mix(tree, pal.haze, 0.35)} sway={Math.sin(t + i) * 2} />
          </g>
        ) : null)}
      </Layer>
      <Ground ctx={ctx} y={g} top={mix(grass, pal.haze, 0.25)} bottom={darken(grass, 0.25)} curve={10} />
      <GrassBand ctx={ctx} depth={0.5} y={g + 6} color={mix(darken(grass, 0.1), pal.haze, 0.2)} h={26} spacing={34} k="s1" />
      <Layer ctx={ctx} depth={0.55}>
        {tiles(ctx, 0.55, 900, 500).map(({ i, x }) => rnd(seed, "ac2", i) < 0.6 ? (
          <g key={i} transform={`translate(${x + rr(seed, -200, 200, "ac2x", i)},${g + 30})`}>
            <Acacia h={rr(seed, 460, 600, "ac2h", i)} fill={tree} sway={Math.sin(t * 0.8 + i) * 6} />
          </g>
        ) : null)}
      </Layer>
      <GrassBand ctx={ctx} depth={1} y={g + 60} color={darken(grass, 0.05)} tip={lighten(grass, 0.3)} h={60} spacing={46} k="s2" />
    </>
  );
};
export const SavannaFront: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const grass = ctx.lit(ctx.pal.night ? "#4f4e2a" : "#c8963f");
  return <GrassBand ctx={ctx} depth={1.4} y={ctx.VH + 30} color={darken(grass, 0.15)} tip={lighten(grass, 0.25)} h={170} spacing={70} k="s3" />;
};
export const savannaGround = (VH: number) => VH * 0.78;

// ---------------------------------------------------------------------------

export const MeadowBack: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { VH, pal, t, seed } = ctx;
  const g = VH * 0.8;
  const snow = snowy(ctx);
  const hill = (c: string, k: number) => mix(ctx.lit(snow ? "#e8eef6" : c), pal.haze, k);
  return (
    <>
      <Sky ctx={ctx} horizon={0.64} />
      <Stars ctx={ctx} maxY={0.5} />
      <Orb ctx={ctx} />
      <SkyFx ctx={ctx} />
      <Clouds ctx={ctx} depth={0.05} y={VH * 0.2} size={500} density={0.65} />
      <FarBirds ctx={ctx} y={VH * 0.3} n={4} />
      <Layer ctx={ctx} depth={0.07}>
        <path d={ridgePath(ctx, 0.07, (x) => g - 300 + ridgeNoise(x, seed, "mm") * -160, VH + 400)} fill={hill("#7aa7c7", 0.6)} />
      </Layer>
      <HorizonHaze ctx={ctx} y={g - 230} h={200} opacity={0.4} />
      <Layer ctx={ctx} depth={0.15}>
        <path d={ridgePath(ctx, 0.15, (x) => g - 200 + hillNoise(x, seed, "m1") * 70, VH + 400)} fill={hill("#8cc063", 0.4)} />
        {tiles(ctx, 0.15, 240, 200).map(({ i, x }) => rnd(seed, "mt", i) < 0.4 ? (
          <g key={i} transform={`translate(${x},${g - 200 + hillNoise(x, seed, "m1") * 70 + 10})`}>
            <LeafTree h={rr(seed, 90, 140, "mth", i)} leaf={hill("#4f8f4a", 0.35)} trunk={hill("#5a3a2a", 0.35)} seed={seed} k={`mt${i}`} sway={Math.sin(t + i) * 2} />
          </g>
        ) : null)}
      </Layer>
      <Layer ctx={ctx} depth={0.35}>
        <path d={ridgePath(ctx, 0.35, (x) => g - 90 + hillNoise(x, seed, "m2") * 60, VH + 400)} fill={hill("#79b155", 0.2)} />
        {tiles(ctx, 0.35, 600, 300).map(({ i, x }) => rnd(seed, "mt2", i) < 0.5 ? (
          <g key={i} transform={`translate(${x},${g - 80 + hillNoise(x, seed, "m2") * 60})`}>
            <LeafTree h={rr(seed, 260, 340, "mt2h", i)} leaf={hill("#3f8a45", 0.15)} light={hill("#62ad55", 0.15)} trunk={ctx.lit("#6a4430")} seed={seed} k={`mm${i}`} sway={Math.sin(t * 0.9 + i) * 5} />
          </g>
        ) : null)}
      </Layer>
      <Ground ctx={ctx} y={g} top={ctx.lit(snow ? "#f2f6fb" : "#6fb04c")} bottom={ctx.lit(snow ? "#c5d4e6" : "#3f7d34")} curve={16} />
      <GrassBand ctx={ctx} depth={1} y={g + 30} color={ctx.lit(snow ? "#d5e0ec" : "#4f9440")} h={40} spacing={40} k="mg" flowers={!snow} />
    </>
  );
};
export const MeadowFront: React.FC<{ ctx: Ctx }> = ({ ctx }) => (
  <GrassBand ctx={ctx} depth={1.4} y={ctx.VH + 40} color={ctx.lit(snowy(ctx) ? "#c2d1e3" : "#3d7f35")} h={150} spacing={80} k="mf" flowers={!snowy(ctx)} />
);

// ---------------------------------------------------------------------------

/** Mountain range with snow caps (clipped). */
const Range: React.FC<{ ctx: Ctx; depth: number; base: number; amp: number; k: string; fill: string; snow: string; snowLine: number; scale?: number }> = ({ ctx, depth, base, amp, k, fill, snow, snowLine, scale = 1 }) => {
  const id = useSid();
  const h = (x: number) => base - ridgeNoise(x, ctx.seed, k, scale) * amp;
  const d = ridgePath(ctx, depth, h, ctx.VH + 400, 14);
  // light-side facets: the same ridge, shifted, clipped to the mountain
  const shift = ctx.pal.lightSide * -26 * scale;
  const d2 = ridgePath(ctx, depth, (x) => h(x + shift) + 18, ctx.VH + 400, 14);
  const [a, b] = visibleX(ctx, depth, 300);
  let snowD = `M${a},-3000`;
  for (let x = a; x <= b; x += 20) snowD += `L${x},${(base - amp * snowLine + Math.sin(x * 0.05) * 14 + Math.sin(x * 0.013) * 30).toFixed(1)}`;
  snowD += `L${b},-3000Z`;
  return (
    <Layer ctx={ctx} depth={depth}>
      <defs>
        <clipPath id={id}><path d={d} /></clipPath>
      </defs>
      <path d={d} fill={fill} />
      <g clipPath={`url(#${id})`}>
        <path d={snowD} fill={snow} />
        <path d={d2} fill={darken(fill, 0.35)} opacity={0.35} />
      </g>
    </Layer>
  );
};

export const MountainsBack: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { VH, pal, t, seed } = ctx;
  const g = VH * 0.84;
  const c = (base: string, k: number) => mix(ctx.lit(base), pal.haze, k);
  const snow = lighten(pal.skyLow, 0.75);
  return (
    <>
      <Sky ctx={ctx} horizon={0.6} />
      <Stars ctx={ctx} maxY={0.45} />
      <Orb ctx={ctx} />
      <SkyFx ctx={ctx} />
      <Clouds ctx={ctx} depth={0.04} y={VH * 0.16} size={560} density={0.55} opacity={0.85} />
      <Range ctx={ctx} depth={0.05} base={g - 380} amp={520} k="r0" fill={c("#6f7fb0", 0.6)} snow={mix(snow, pal.haze, 0.4)} snowLine={0.6} scale={1.6} />
      <HorizonHaze ctx={ctx} y={g - 420} h={260} opacity={0.5} />
      <FarBirds ctx={ctx} y={VH * 0.28} n={4} />
      <Range ctx={ctx} depth={0.14} base={g - 220} amp={420} k="r1" fill={c("#5a6a9a", 0.4)} snow={mix(snow, pal.haze, 0.2)} snowLine={0.65} scale={1.1} />
      <Clouds ctx={ctx} depth={0.2} y={g - 280} size={700} density={0.6} opacity={pal.night ? 0.22 : 0.4} spread={40} speed={30} k="mist" fill={lighten(pal.haze, 0.25)} shade={pal.haze} />
      <Range ctx={ctx} depth={0.3} base={g - 60} amp={300} k="r2" fill={c("#3f5a78", 0.2)} snow={snow} snowLine={0.75} scale={0.8} />
      <Layer ctx={ctx} depth={0.55}>
        <path d={ridgePath(ctx, 0.55, (x) => g + 40 + hillNoise(x, seed, "mg") * 50, VH + 400)} fill={ctx.lit(snowy(ctx) ? "#d8e2ee" : "#2f5a4a")} />
        {tiles(ctx, 0.55, 70, 100).map(({ i, x }) => rnd(seed, "mp", i) < 0.7 ? (
          <g key={i} transform={`translate(${x},${g + 50 + hillNoise(x, seed, "mg") * 50})`}>
            <Pine h={rr(seed, 120, 220, "mph", i)} fill={ctx.lit("#1f4a3c")} light={ctx.lit("#2b5e4b")} snow={snowy(ctx)} sway={Math.sin(t + i) * 3} />
          </g>
        ) : null)}
      </Layer>
      <Ground ctx={ctx} y={g + 150} top={ctx.lit(snowy(ctx) ? "#e9f0f8" : "#5c7a5a")} bottom={ctx.lit(snowy(ctx) ? "#b6c6da" : "#34503c")} curve={30} />
    </>
  );
};

// ---------------------------------------------------------------------------

export const IceBack: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { VH, pal, t, seed } = ctx;
  const g = VH * 0.74;
  const ice = ctx.lit("#e6f3ff");
  const iceShade = ctx.lit("#9cc6e8");
  const sea = mix(ctx.lit("#2a6f9e"), pal.haze, 0.2);
  return (
    <>
      <Sky ctx={ctx} horizon={0.58} />
      <Stars ctx={ctx} maxY={0.4} />
      <Orb ctx={ctx} />
      <SkyFx ctx={ctx} />
      <Clouds ctx={ctx} depth={0.04} y={VH * 0.18} size={520} density={0.5} />
      <Layer ctx={ctx} depth={0.06}>
        <path d={ridgePath(ctx, 0.06, (x) => g - 150 - Math.max(0, hillNoise(x, seed, "ib") + 0.2) * 220, VH, 30)} fill={mix(ice, pal.haze, 0.5)} />
        <path d={ridgePath(ctx, 0.06, (x) => g - 150 - Math.max(0, hillNoise(x + 60, seed, "ib") + 0.2) * 190 + 30, VH, 30)} fill={mix(iceShade, pal.haze, 0.5)} />
      </Layer>
      <Layer ctx={ctx} depth={0.1}>
        <rect x={-9000} y={g - 150} width={30000} height={400} fill={sea} />
        {tiles(ctx, 0.1, 120, 100).map(({ i, x }) => (
          <rect key={i} x={x + Math.sin(t * 1.5 + i) * 10} y={g - 130 + (i % 5) * 20} width={rr(seed, 20, 60, "gl", i)} height={3} fill="#ffffff" opacity={0.3 + 0.3 * Math.sin(t * 3 + i)} />
        ))}
        {tiles(ctx, 0.1, 500, 300).map(({ i, x }) => rnd(seed, "berg", i) < 0.6 ? (
          <g key={`b${i}`} transform={`translate(${x},${g - 110 + Math.sin(t * 1.2 + i) * 4})`}>
            <path d="M-90,0 L-60,-70 L-20,-90 L10,-60 L50,-80 L90,0Z" fill={ice} />
            <path d="M-20,-90 L10,-60 L50,-80 L90,0 L0,0Z" fill={iceShade} opacity={0.8} />
          </g>
        ) : null)}
      </Layer>
      <Ground ctx={ctx} y={g} top={ice} bottom={iceShade} curve={20} />
      <Layer ctx={ctx} depth={1}>
        {tiles(ctx, 1, 160, 200).map(({ i, x }) => (
          <g key={i}>
            <path d={`M${x},${g + 60 + (i % 4) * 90} l${rr(seed, 30, 80, "cr", i)},${rr(seed, -20, 20, "cr2", i)} l${rr(seed, 20, 60, "cr3", i)},${rr(seed, -10, 30, "cr4", i)}`} stroke={iceShade} strokeWidth={3} fill="none" opacity={0.7} />
            <circle cx={x + 40} cy={g + 40 + (i % 6) * 70} r={3 + 3 * Math.max(0, Math.sin(t * 4 + i * 2.3))} fill="#ffffff" />
          </g>
        ))}
      </Layer>
    </>
  );
};
export const IceFront: React.FC<{ ctx: Ctx }> = ({ ctx }) => (
  <Layer ctx={ctx} depth={1.35}>
    <path d={ridgePath(ctx, 1.35, (x) => ctx.VH - 30 + hillNoise(x, ctx.seed, "drift") * 40, ctx.VH + 400)} fill={ctx.lit("#f4f9ff")} />
  </Layer>
);

// ---------------------------------------------------------------------------

export const SkyBack: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { VH } = ctx;
  return (
    <>
      <Sky ctx={ctx} horizon={0.8} />
      <Stars ctx={ctx} maxY={0.8} />
      <Orb ctx={ctx} />
      <SkyFx ctx={ctx} />
      <Clouds ctx={ctx} depth={0.05} y={VH * 0.25} size={500} density={0.6} opacity={0.8} k="a" />
      <FarBirds ctx={ctx} y={VH * 0.4} n={5} />
      <Clouds ctx={ctx} depth={0.18} y={VH * 0.62} size={650} density={0.8} k="b" spread={80} />
      <Clouds ctx={ctx} depth={0.4} y={VH * 0.9} size={900} density={0.95} k="c" spread={60} />
    </>
  );
};
export const SkyFront: React.FC<{ ctx: Ctx }> = ({ ctx }) => (
  <Clouds ctx={ctx} depth={1.5} y={ctx.VH * 1.06} size={1100} density={0.85} k="d" spread={60} speed={40} />
);
