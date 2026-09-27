/** Ocean surface (waves, glitter) and underwater (light rays, kelp, coral, caustics). Also outer space. */
import React from "react";
import type { Ctx } from "../ctx";
import { darken, lighten, mix } from "../lib/color";
import { mod, rnd, rr, TAU, wobble } from "../lib/math";
import { Glow, Layer, tiles, useSid, visibleX } from "../lib/svg";
import { Clouds, HorizonHaze, hillNoise, Orb, ridgePath, Sky, SkyFx, Stars } from "./common";
import { FarBirds } from "./nature";

/** A band of water whose top edge is a travelling wave, with a foam crest line. */
const WaveBand: React.FC<{ ctx: Ctx; depth: number; y: number; amp: number; len: number; speed: number; fill: string; fill2?: string; crest?: string; k: string; foam?: boolean }> = ({
  ctx, depth, y, amp, len, speed, fill, fill2, crest, k, foam,
}) => {
  const id = useSid();
  const { t, seed } = ctx;
  const [a, b] = visibleX(ctx, depth, 200);
  const ph = rnd(seed, "wph", k) * TAU;
  const f = TAU / len;
  const h = (x: number) => y + Math.sin(x * f - t * speed + ph) * amp + Math.sin(x * f * 2.3 + t * speed * 0.7 + ph) * amp * 0.35 + wobble(x * 0.002 + t * 0.3, seed, k) * amp * 0.5;
  const step = Math.max(8, len / 14);
  let top = "";
  let d = `M${a},${ctx.VH + 600}`;
  for (let x = Math.floor(a / step) * step; x <= b + step; x += step) {
    const yy = h(x).toFixed(1);
    d += `L${x},${yy}`;
    top += `${top ? "L" : "M"}${x},${yy}`;
  }
  d += `L${b + step},${ctx.VH + 600}Z`;
  const flecks = [];
  if (foam) {
    for (const { i, x } of tiles(ctx, depth, len * 0.5, len)) {
      const fx = x + rr(seed, 0, len * 0.5, k, "fx", i);
      const fy = h(fx) + rr(seed, 10, 60, k, "fy", i);
      flecks.push(<ellipse key={i} cx={fx + Math.sin(t * 2 + i) * 6} cy={fy} rx={rr(seed, 8, 26, k, "fr", i)} ry={3} fill={crest ?? "#fff"} opacity={0.35} />);
    }
  }
  return (
    <Layer ctx={ctx} depth={depth}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={fill} />
          <stop offset="1" stopColor={fill2 ?? darken(fill, 0.35)} />
        </linearGradient>
      </defs>
      <g transform={`translate(0,0)`}>
        <path d={d} fill={`url(#${id})`} />
        {crest ? <path d={top} stroke={crest} strokeWidth={Math.max(3, amp * 0.25)} fill="none" opacity={0.8} strokeLinecap="round" /> : null}
        {flecks}
      </g>
    </Layer>
  );
};

export const OceanBack: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { VH, VW, pal, t, seed } = ctx;
  const hz = VH * 0.5;
  const sea = ctx.lit(pal.night ? "#16305a" : "#1f7fb8");
  const orb = pal.orb;
  const glitter = [];
  if (orb) {
    for (let i = 0; i < 40; i++) {
      const y = hz + 8 + Math.pow(rnd(seed, "gy", i), 1.6) * (VH * 0.3);
      const spread = 20 + (y - hz) * 0.5;
      const x = orb.x * VW + (rnd(seed, "gx", i) - 0.5) * spread * 2 + Math.sin(t * 2 + i) * 8;
      const on = Math.max(0, Math.sin(t * rr(seed, 3, 7, "gs", i) + i * 1.9));
      glitter.push(<rect key={i} x={x} y={y} width={10 + (y - hz) * 0.12} height={3} fill={orb.color} opacity={on} />);
    }
  }
  return (
    <>
      <Sky ctx={ctx} horizon={0.5} />
      <Stars ctx={ctx} maxY={0.45} />
      <Orb ctx={ctx} />
      <SkyFx ctx={ctx} />
      <Clouds ctx={ctx} depth={0.04} y={VH * 0.22} size={560} density={0.55} />
      <FarBirds ctx={ctx} y={VH * 0.32} n={4} />
      <Clouds ctx={ctx} depth={0.06} y={hz - 20} size={420} density={0.6} spread={10} opacity={0.6} k="low" />
      <rect x={-400} y={hz} width={VW + 800} height={VH} fill={mix(sea, pal.haze, 0.45)} />
      <HorizonHaze ctx={ctx} y={hz} h={80} opacity={0.7} />
      <g style={{ mixBlendMode: "screen" }}>{glitter}</g>
      <WaveBand ctx={ctx} depth={0.15} y={hz + 60} amp={6} len={120} speed={1.5} fill={mix(sea, pal.haze, 0.35)} crest={mix(lighten(sea, 0.4), pal.haze, 0.3)} k="w1" />
      <WaveBand ctx={ctx} depth={0.35} y={hz + 190} amp={12} len={260} speed={1.8} fill={mix(sea, pal.haze, 0.2)} crest={lighten(sea, 0.45)} k="w2" />
      <WaveBand ctx={ctx} depth={0.65} y={hz + 380} amp={22} len={420} speed={2.0} fill={sea} crest={lighten(sea, 0.5)} k="w3" foam />
    </>
  );
};
export const OceanFront: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const sea = ctx.lit(ctx.pal.night ? "#11264a" : "#176a9e");
  return (
    <>
      <WaveBand ctx={ctx} depth={1} y={ctx.VH * 0.8} amp={34} len={560} speed={2.2} fill={sea} fill2={darken(sea, 0.4)} crest={lighten(sea, 0.55)} k="w4" foam />
      <WaveBand ctx={ctx} depth={1.4} y={ctx.VH * 0.93} amp={40} len={700} speed={2.5} fill={darken(sea, 0.12)} fill2={darken(sea, 0.5)} crest={lighten(sea, 0.45)} k="w5" foam />
    </>
  );
};

// ---------------------------------------------------------------------------

const Kelp: React.FC<{ h: number; color: string; t: number; k: number }> = ({ h, color, t, k }) => {
  let d = "M0,0";
  const segs = 8;
  const pts: [number, number][] = [];
  for (let i = 1; i <= segs; i++) {
    const u = i / segs;
    pts.push([Math.sin(t * 1.1 + u * 3 + k) * 26 * u + Math.sin(t * 0.6 + k) * 16 * u, -h * u]);
  }
  for (const [x, y] of pts) d += `L${x.toFixed(1)},${y.toFixed(1)}`;
  const leaves = pts.filter((_, i) => i % 2 === 1).map(([x, y], i) => (
    <ellipse key={i} cx={x + (i % 2 ? 14 : -14)} cy={y} rx={18} ry={7} fill={color} transform={`rotate(${i % 2 ? -30 : 30} ${x + (i % 2 ? 14 : -14)} ${y})`} />
  ));
  return (
    <g>
      <path d={d} stroke={color} strokeWidth={9} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {leaves}
    </g>
  );
};

const Coral: React.FC<{ s: number; color: string; kind: number; t: number }> = ({ s, color, kind, t }) => {
  if (kind === 0) {
    // branching
    const br = (x: number, y: number, a: number, l: number, depth: number): string =>
      depth === 0 ? "" : `M${x},${y}l${Math.sin(a) * l},${-Math.cos(a) * l}` + br(x + Math.sin(a) * l, y - Math.cos(a) * l, a - 0.45, l * 0.7, depth - 1) + br(x + Math.sin(a) * l, y - Math.cos(a) * l, a + 0.45, l * 0.7, depth - 1);
    return <path d={br(0, 0, Math.sin(t) * 0.05, 60 * s, 4)} stroke={color} strokeWidth={10 * s} strokeLinecap="round" fill="none" />;
  }
  if (kind === 1)
    return (
      <g>
        <ellipse cx={0} cy={-30 * s} rx={60 * s} ry={34 * s} fill={color} />
        <path d={`M${-44 * s},${-34 * s} q${22 * s},-20 ${44 * s},0 q${22 * s},20 ${44 * s},0`} stroke={darken(color, 0.2)} strokeWidth={5 * s} fill="none" />
      </g>
    );
  // anemone
  const arms = [];
  for (let i = 0; i < 9; i++) {
    const a = -0.9 + (i / 8) * 1.8 + Math.sin(t * 2 + i) * 0.12;
    arms.push(<path key={i} d={`M0,${-20 * s} q${Math.sin(a) * 30 * s},${-30 * s} ${Math.sin(a) * 50 * s},${-70 * s * Math.cos(a * 0.5)}`} stroke={color} strokeWidth={8 * s} strokeLinecap="round" fill="none" />);
  }
  return <g>{arms}<ellipse cx={0} cy={-12 * s} rx={26 * s} ry={16 * s} fill={darken(color, 0.15)} /></g>;
};

export const UnderwaterBack: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { VH, VW, pal, t, seed } = ctx;
  const bed = VH * 0.9;
  const far = mix("#0b4a74", pal.haze, 0.5);
  // surface ripples
  let rip = "";
  for (let r = 0; r < 4; r++) {
    const y = 40 + r * 34;
    rip += `M-100,${y}`;
    for (let x = -100; x <= VW + 100; x += 30) rip += `L${x},${(y + Math.sin(x * 0.02 + t * 2 + r) * 8 + Math.sin(x * 0.051 - t * 1.3) * 4).toFixed(1)}`;
  }
  return (
    <>
      <Sky ctx={ctx} horizon={0.9} />
      <Glow cx={VW * 0.35} cy={-VH * 0.05} r={VW * 0.9} ry={VH * 0.35} color="#bff4ff" opacity={0.45} />
      <path d={rip} stroke="#dffbff" strokeWidth={5} fill="none" opacity={0.35} />
      <Layer ctx={ctx} depth={0.1}>
        <path d={ridgePath(ctx, 0.1, (x) => bed - 330 + hillNoise(x, seed, "uw0") * 120 - Math.max(0, hillNoise(x * 3, seed, "uwp")) * 160, VH + 400)} fill={far} opacity={0.8} />
      </Layer>
      <Layer ctx={ctx} depth={0.18}>
        {tiles(ctx, 0.18, 90, 100).map(({ i, x }) => rnd(seed, "fk", i) < 0.5 ? (
          <g key={i} transform={`translate(${x},${bed - 230 + hillNoise(x, seed, "uw0") * 60})`}>
            <Kelp h={rr(seed, 200, 380, "fkh", i)} color={mix(far, pal.haze, 0.2)} t={t} k={i} />
          </g>
        ) : null)}
      </Layer>
      <Layer ctx={ctx} depth={0.45}>
        <path d={ridgePath(ctx, 0.45, (x) => bed - 90 + hillNoise(x, seed, "uw1") * 50, VH + 400)} fill={mix(ctx.lit("#c9a86a"), pal.haze, 0.55)} />
        {tiles(ctx, 0.45, 150, 150).map(({ i, x }) => {
          const kind = Math.floor(rnd(seed, "ck", i) * 3);
          const col = mix(ctx.lit(["#ff7a6b", "#ff9fd0", "#ffb347", "#b48cff", "#6fe3c1"][Math.floor(rnd(seed, "cc", i) * 5)]!), pal.haze, 0.35);
          return (
            <g key={i} transform={`translate(${x + rr(seed, -40, 40, "cx", i)},${bed - 80 + hillNoise(x, seed, "uw1") * 50})`}>
              {rnd(seed, "cr", i) < 0.35 ? <Kelp h={rr(seed, 300, 520, "kh", i)} color={mix(ctx.lit("#2f8f5a"), pal.haze, 0.35)} t={t} k={i * 3} /> : <Coral s={rr(seed, 0.8, 1.4, "cs", i)} color={col} kind={kind} t={t + i} />}
            </g>
          );
        })}
      </Layer>
      {/* caustic light on the sea floor */}
      <g opacity={0.25} style={{ mixBlendMode: "screen" }}>
        {[0, 1, 2].map((r) => {
          let d = `M-100,${bed - 40 + r * 50}`;
          for (let x = -100; x <= VW + 100; x += 40) d += `L${x},${(bed - 40 + r * 50 + Math.sin(x * 0.03 + t * 2.4 + r * 2) * 12).toFixed(1)}`;
          return <path key={r} d={d} stroke="#e8ffff" strokeWidth={4} fill="none" />;
        })}
      </g>
    </>
  );
};
export const UnderwaterFront: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { VH, t, seed, pal } = ctx;
  const bed = VH * 0.97;
  return (
    <Layer ctx={ctx} depth={1.3}>
      <path d={ridgePath(ctx, 1.3, (x) => bed + hillNoise(x, seed, "uwf") * 40, VH + 400)} fill={mix(ctx.lit("#b08a52"), pal.haze, 0.2)} />
      {tiles(ctx, 1.3, 500, 300).map(({ i, x }) => rnd(seed, "fkf", i) < 0.45 ? (
        <g key={i} transform={`translate(${x},${bed + 30})`}>
          <Kelp h={rr(seed, 400, 700, "fkfh", i)} color={darken(ctx.lit("#1f6b48"), 0.3)} t={t} k={i * 7} />
        </g>
      ) : null)}
    </Layer>
  );
};

// ---------------------------------------------------------------------------

export const SpaceBack: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { VH, VW, t, seed } = ctx;
  const neb = ["#7b3fe4", "#e0439a", "#1fb5c9", "#3b5bdb"];
  const shoot = mod(t + rnd(seed, "ss") * 3, 3.2);
  const sx = rr(seed, 0.2, 0.9, "ssx", Math.floor((t + rnd(seed, "ss") * 3) / 3.2)) * VW;
  const px = VW * rr(seed, 0.6, 0.8, "planet");
  const py = VH * 0.26;
  const pr = 170;
  const planetC = ["#e39b5d", "#6fb3e8", "#c47ae8", "#7fd6a8"][Math.floor(rnd(seed, "pc") * 4)]!;
  const idp = useSid();
  const idc = useSid();
  return (
    <>
      <Sky ctx={ctx} horizon={0.9} />
      <Layer ctx={ctx} depth={0.01} scrollFactor={0.2}>
        {neb.map((c, i) => (
          <Glow key={i} cx={rr(seed, 0, 1, "nx", i) * VW + Math.sin(t * 0.2 + i) * 20} cy={rr(seed, 0.1, 0.7, "ny", i) * VH} r={rr(seed, 300, 520, "nr", i)} ry={rr(seed, 180, 360, "nry", i)} color={c} opacity={0.32} />
        ))}
        <Glow cx={VW * 0.5} cy={VH * 0.45} r={VW * 1.2} ry={140} color="#b9a9ff" opacity={0.15} />
      </Layer>
      <Stars ctx={ctx} maxY={1} />
      {shoot < 0.6 ? (
        <line x1={sx - shoot * 900} y1={VH * 0.15 + shoot * 380} x2={sx - shoot * 900 + 160} y2={VH * 0.15 + shoot * 380 - 68} stroke="#ffffff" strokeWidth={4} strokeLinecap="round" opacity={1 - shoot / 0.6} />
      ) : null}
      <Layer ctx={ctx} depth={0.04} scrollFactor={0.3}>
        <defs>
          <radialGradient id={idp} cx="35%" cy="35%" r="75%">
            <stop offset="0" stopColor={lighten(planetC, 0.35)} />
            <stop offset="0.6" stopColor={planetC} />
            <stop offset="1" stopColor={darken(planetC, 0.7)} />
          </radialGradient>
          <clipPath id={idc}><circle cx={px} cy={py} r={pr} /></clipPath>
        </defs>
        <Glow cx={px} cy={py} r={pr * 1.8} color={planetC} opacity={0.35} />
        <ellipse cx={px} cy={py} rx={pr * 1.9} ry={pr * 0.42} fill="none" stroke={lighten(planetC, 0.4)} strokeWidth={16} opacity={0.5} transform={`rotate(-16 ${px} ${py})`} />
        <circle cx={px} cy={py} r={pr} fill={`url(#${idp})`} />
        <g clipPath={`url(#${idc})`} opacity={0.25}>
          {[0, 1, 2, 3].map((i) => <rect key={i} x={px - pr - 400 + mod(t * 20 + i * 97, 200)} y={py - pr + 40 + i * 70} width={pr * 2 + 400} height={22} fill={darken(planetC, 0.3)} />)}
        </g>
        <path d={`M${px - pr * 1.9},${py} A${pr * 1.9},${pr * 0.42} 0 0 0 ${px + pr * 1.9},${py}`} fill="none" stroke={lighten(planetC, 0.5)} strokeWidth={16} opacity={0.8} transform={`rotate(-16 ${px} ${py})`} />
        <circle cx={VW * 0.18} cy={VH * 0.12} r={40} fill="#c9c6d8" />
        <circle cx={VW * 0.18 + 12} cy={VH * 0.12 - 6} r={40} fill="#0b0a24" opacity={0.55} />
      </Layer>
      <Layer ctx={ctx} depth={0.3}>
        {tiles(ctx, 0.3, 380, 300).map(({ i, x }) => rnd(seed, "ast", i) < 0.5 ? (
          <g key={i} transform={`translate(${x + t * 20},${rr(seed, 0.3, 0.7, "asy", i) * VH}) rotate(${t * rr(seed, -30, 30, "asr", i)})`}>
            <path d="M-30,-10 L-12,-28 L18,-24 L32,0 L20,24 L-14,26 L-32,10Z" fill={ctx.lit("#6b6478")} />
            <path d="M-12,-28 L18,-24 L32,0 L6,-4Z" fill={ctx.lit("#8e87a0")} />
          </g>
        ) : null)}
      </Layer>
      <Layer ctx={ctx} depth={1}>
        <path d={ridgePath(ctx, 1, (x) => VH * 0.86 + hillNoise(x, seed, "moon") * 30, VH + 400)} fill={ctx.lit("#8d8aa0")} />
        {tiles(ctx, 1, 260, 200).map(({ i, x }) => (
          <ellipse key={i} cx={x + rr(seed, -60, 60, "crx", i)} cy={VH * 0.9 + rr(seed, 0, 120, "cry", i)} rx={rr(seed, 30, 80, "crr", i)} ry={rr(seed, 8, 16, "crr2", i)} fill={ctx.lit("#6e6a82")} />
        ))}
      </Layer>
    </>
  );
};

