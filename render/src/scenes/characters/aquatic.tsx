/** Whale (swim, spout), fish school and dolphin (jump arcs with splashes). */
import React from "react";
import { travelSpeed } from "../camera";
import { darken, lighten, mix } from "../lib/color";
import { mod, pick, rnd, rr, smoothPath, wobble, type Pt } from "../lib/math";
import { ribbon } from "../lib/rig";
import { Glow, J } from "../lib/svg";
import { Sparks } from "../effects/energy";
import { Eye } from "./quad";
import type { CharProps } from "./types";

/** Undulating centre-line from head (u=0, +x) to tail (u=1). */
const spine = (len: number, n: number, t: number, freq: number, amp: (u: number) => number, phase = 0): Pt[] => {
  const out: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    out.push([len / 2 - u * len, Math.sin(t * freq - u * 4 + phase) * amp(u)]);
  }
  return out;
};

export const Whale: React.FC<CharProps> = (p) => {
  const { ctx, t, seed, action } = p;
  const L = ctx.lit;
  const orca = /\borca\b/.test(ctx.spec.matched.character ?? "");
  const top = L(orca ? "#16181f" : "#36557a"), belly = L(orca ? "#f4f6f8" : "#c9d8e4"), fin = L(orca ? "#16181f" : "#9fb4c8"), dark = darken(top, 0.3);
  const surface = ctx.spec.setting === "ocean";
  const f = 2.2;
  const line = spine(820, 16, t, f, (u) => 6 + u * u * 46);
  const w = (u: number) => (u < 0.14 ? 70 + Math.sqrt(u / 0.14) * 150 : u < 0.5 ? 220 - (u - 0.14) * 140 : Math.max(26, 170 - (u - 0.5) * 300));
  const outline = ribbon(line, w);
  const tail = line[line.length - 1]!, pre = line[line.length - 2]!;
  const tailAng = Math.atan2(tail[1] - pre[1], tail[0] - pre[0]) * (180 / Math.PI) + 180;
  // belly: lower edge of the ribbon over the front 70%
  const n = line.length;
  const lower = outline.slice(n, n * 2).reverse(); // right side of ribbon = lower edge (facing +x)
  const bellyPts: Pt[] = [];
  for (let i = 1; i < Math.floor(n * 0.72); i++) {
    const c = line[i]!, lo = lower[i]!;
    bellyPts.push([c[0], c[1] + (lo[1] - c[1]) * 0.15]);
  }
  const bellyPoly = [...bellyPts, ...lower.slice(1, Math.floor(n * 0.72)).reverse()];
  const pec = Math.sin(t * 1.3) * 16;
  const spoutCyc = mod(t + rnd(seed, "sp") * 2, 3.2);
  const spouting = (surface || action === "spout") && spoutCyc < 1.3;
  const head = line[1]!;
  return (
    <g transform={surface ? `translate(0,${(Math.sin(t * 0.9) * 34).toFixed(1)}) rotate(${(Math.cos(t * 0.9) * -4).toFixed(2)})` : `rotate(${Math.sin(t * 0.8) * 2})`}>
      {/* far pectoral fin */}
      <J x={170} y={line[4]![1] + 70} r={30 + pec * 0.6}>
        <path d="M0,0 Q-60,120 -150,190 Q-120,120 -30,-10Z" fill={darken(fin, 0.3)} />
      </J>
      <J x={tail[0]} y={tail[1]} r={tailAng}>
        <path d="M-6,0 C-30,-50 -90,-130 -190,-150 Q-150,-90 -150,-40 Q-120,-8 -60,0 Q-120,8 -150,40 Q-150,90 -190,150 C-90,130 -30,50 -6,0Z" transform="scale(-1,1)" fill={top} />
      </J>
      <path d={smoothPath(outline, true, 0.8)} fill={top} />
      <path d={smoothPath(bellyPoly, true, 0.8)} fill={belly} />
      {!orca ? Array.from({ length: 7 }, (_, i) => {
        const a = lower[2 + i]!, c = line[2 + i]!;
        return <path key={i} d={`M${a[0]},${a[1] - 8} L${c[0] - 30},${c[1] + (a[1] - c[1]) * 0.35}`} stroke={darken(belly, 0.18)} strokeWidth={4} opacity={0.7} />;
      }) : <ellipse cx={head[0] - 90} cy={head[1] - 30} rx={50} ry={22} fill={belly} />}
      {!orca ? [[330, -60], [360, -30], [300, -84], [260, -70]].map(([x, y], i) => <circle key={i} cx={x} cy={y! + head[1]} r={7} fill={lighten(top, 0.25)} />) : null}
      <path d={`M${head[0] + 30},${head[1] + 20} Q${head[0] - 60},${head[1] + 60} ${head[0] - 150},${head[1] + 30}`} stroke={dark} strokeWidth={5} fill="none" strokeLinecap="round" />
      {/* dorsal hump */}
      <path d={`M${line[10]![0] + 40},${line[10]![1] - w(10 / 16) / 2 + 6} Q${line[10]![0]},${line[10]![1] - w(10 / 16) / 2 - 40} ${line[10]![0] - 40},${line[10]![1] - w(10 / 16) / 2 + 4}Z`} fill={top} />
      <Eye x={head[0] - 110} y={head[1] + 6} r={9} t={t} seed={seed} iris="#111" look={0.4} />
      <J x={120} y={line[5]![1] + 70} r={20 + pec}>
        <path d="M0,0 Q-50,130 -170,210 Q-140,130 -40,-10Z" fill={fin} />
        <path d="M-40,40 l-10,10 M-70,90 l-10,10 M-110,140 l-10,10" stroke={darken(fin, 0.2)} strokeWidth={6} strokeLinecap="round" />
      </J>
      {spouting ? (
        <g>
          <Sparks x={head[0] - 150} y={head[1] - 100} t={spoutCyc} seed={seed} k="spout" rate={110} speed={820} spread={0.5} gravity={900} life={1.1} color="#e8f7ff" size={2.8} />
          <Glow cx={head[0] - 150} cy={head[1] - 260} r={130} ry={170} color="#f0fbff" opacity={Math.max(0, 1 - spoutCyc / 1.3) * 0.8} />
        </g>
      ) : null}
    </g>
  );
};

/** A school of small fish around (0,0). */
export const FishSchool: React.FC<CharProps> = (p) => {
  const { ctx, t, seed } = p;
  const L = ctx.lit;
  const style = pick(seed, [0, 1, 2], "fishstyle");
  const colors = [["#bcd3e6", "#5f86ab", "#ffd35a"], ["#ff8a2a", "#ffffff", "#1c1c1c"], ["#ffd23f", "#2f6fdb", "#2f6fdb"]][style]!;
  const n = 26;
  const fish = [];
  for (let i = 0; i < n; i++) {
    const depth = rr(seed, 0.55, 1.1, "fd", i);
    const bx = rr(seed, -380, 380, "fx", i) + wobble(t * 0.4, seed, `fx${i}`) * 50;
    const by = rr(seed, -220, 220, "fy", i) + wobble(t * 0.5, seed, `fy${i}`) * 40 + Math.sin(t * 1.2 + bx * 0.004) * 50;
    const wag = Math.sin(t * 10 + i * 1.3) * 22;
    const c0 = mix(L(colors[0]!), ctx.pal.haze, (1.1 - depth) * 0.7), c1 = mix(L(colors[1]!), ctx.pal.haze, (1.1 - depth) * 0.7);
    fish.push({ depth, el: (
      <g key={i} transform={`translate(${bx},${by}) scale(${depth}) rotate(${wobble(t * 0.6, seed, `fr${i}`) * 8})`}>
        <J x={-40} y={0} r={wag}>
          <path d="M0,0 L-34,-24 L-28,0 L-34,24Z" fill={c1} />
        </J>
        <path d="M-44,0 Q-10,-30 30,-18 Q52,-6 52,2 Q40,20 0,22 Q-30,18 -44,0Z" fill={c0} />
        <path d="M-40,2 Q0,14 48,4" stroke={c1} strokeWidth={style === 1 ? 10 : 4} fill="none" opacity={0.9} />
        {style !== 0 ? <path d="M10,-22 Q16,0 10,22" stroke={L(colors[2]!)} strokeWidth={6} fill="none" /> : null}
        <circle cx={32} cy={-4} r={5} fill="#fff" />
        <circle cx={33} cy={-4} r={3} fill="#111" />
      </g>
    ) });
  }
  fish.sort((a, b) => a.depth - b.depth);
  return <g>{fish.map((f) => f.el)}</g>;
};

/** Dolphin: at y=0 is the water line; it leaps in arcs out of the water. */
export const Dolphin: React.FC<CharProps> = (p) => {
  const { ctx, t, seed, action } = p;
  const L = ctx.lit;
  const top = L("#5c7fa6"), belly = L("#e3ecf4"), dark = L("#3d5a7c");
  const swimOnly = action === "swim" || ctx.spec.setting === "underwater";
  const P = 2.3;
  const u = mod(t / P + rnd(seed, "dph") * 0.3, 1);
  const H = 360;
  let y: number, vy: number;
  if (swimOnly) {
    y = Math.sin(t * 1.5) * 30;
    vy = Math.cos(t * 1.5) * 45;
  } else if (u < 0.5) {
    const a = u / 0.5;
    y = -H * Math.sin(Math.PI * a);
    vy = (-H * Math.PI * Math.cos(Math.PI * a)) / (0.5 * P);
  } else {
    const a = (u - 0.5) / 0.5;
    y = 300 * Math.sin(Math.PI * a);
    vy = (300 * Math.PI * Math.cos(Math.PI * a)) / (0.5 * P);
  }
  const vx = 560 + travelSpeed(ctx.spec) * 0;
  const ang = (Math.atan2(vy, vx) * 180) / Math.PI;
  const line = spine(440, 12, t, 9, (q) => 2 + q * q * 12);
  const outline = ribbon(line, (q) => (q < 0.07 ? 30 : q < 0.16 ? 30 + ((q - 0.07) / 0.09) * 64 : q < 0.45 ? 96 - (q - 0.16) * 60 : Math.max(16, 78 - (q - 0.45) * 115)));
  const tail = line[line.length - 1]!, pre = line[line.length - 3]!;
  const tailAng = (Math.atan2(tail[1] - pre[1], tail[0] - pre[0]) * 180) / Math.PI + 180;
  const head = line[0]!;
  // splashes when crossing the surface
  const exitAge = (u * P) % P;
  const entryAge = u >= 0.5 ? (u - 0.5) * P : -1;
  return (
    <g>
      {!swimOnly && exitAge < 0.7 ? <Sparks x={0} y={0} t={exitAge + 0.001} seed={seed} k="ex" rate={120} speed={520} spread={1.2} gravity={1300} life={0.7} color="#eaf8ff" size={1.8} /> : null}
      {!swimOnly && entryAge >= 0 && entryAge < 0.7 ? <Sparks x={40} y={0} t={entryAge + 0.001} seed={seed} k="en" rate={120} speed={480} spread={1.2} gravity={1300} life={0.7} color="#eaf8ff" size={1.8} /> : null}
      {!swimOnly && exitAge < 0.8 ? <ellipse cx={0} cy={4} rx={40 + exitAge * 200} ry={10 + exitAge * 20} fill="none" stroke="#eaf8ff" strokeWidth={5} opacity={0.8 - exitAge} /> : null}
      <g transform={`translate(0,${y.toFixed(1)}) rotate(${ang.toFixed(2)})`}>
        <J x={tail[0]} y={tail[1]} r={tailAng}>
          <path d="M0,0 Q20,-30 70,-56 Q56,-16 14,0 Q56,16 70,56 Q20,30 0,0Z" fill={dark} transform="scale(-1,1)" />
        </J>
        <path d={`M${line[5]![0] + 30},${line[5]![1] - 40} Q${line[6]![0]},${line[6]![1] - 110} ${line[7]![0] - 34},${line[7]![1] - 104} Q${line[7]![0] - 10},${line[7]![1] - 60} ${line[7]![0] - 20},${line[7]![1] - 30}Z`} fill={dark} />
        <path d={smoothPath(outline, true, 0.8)} fill={top} />
        <path d={`M${head[0] - 20},${head[1] + 10} Q${head[0] - 120},${head[1] + 50} ${line[7]![0]},${line[7]![1] + 22} Q${line[4]![0]},${line[4]![1] + 12} ${head[0] - 40},${head[1] + 4}Z`} fill={belly} />
        <path d={`M${head[0] + 4},${head[1] + 6} Q${head[0] - 20},${head[1] + 12} ${head[0] - 44},${head[1] + 4}`} stroke={dark} strokeWidth={3} fill="none" strokeLinecap="round" />
        <J x={line[3]![0]} y={line[3]![1] + 36} r={40 + Math.sin(t * 3) * 10}>
          <path d="M0,0 Q-10,40 -40,60 Q-30,20 -20,-4Z" fill={dark} />
        </J>
        <Eye x={head[0] - 58} y={head[1] - 8} r={7} t={t} seed={seed} iris="#111" look={0.4} />
      </g>
    </g>
  );
};
