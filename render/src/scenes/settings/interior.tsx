/** Interiors: hospital corridor, science lab, power station with a sparking generator. */
import React from "react";
import type { Ctx } from "../ctx";
import { darken, lighten, mix } from "../lib/color";
import { mod, pts, rnd, rr, TAU, type Pt } from "../lib/math";
import { Glow, Layer, useSid } from "../lib/svg";
import { Arc, Sparks } from "../effects/energy";

/** One-point-perspective room: P(sx, sy, z) with sx,sy in [-1,1] and z 0 (near) … 1 (back wall). */
const room = (ctx: Ctx, vpY: number, backW: number, backH: number) => {
  const { VW, VH } = ctx;
  const ext = 260;
  const vx = VW / 2, vy = vpY;
  const nearHalfW = VW / 2 + ext;
  const r = backW / 2 / nearHalfW;
  const A = 1 / r - 1;
  const f = (z: number) => 1 / (1 + A * z);
  const up = vy + ext, down = VH + ext - vy;
  const bUp = backH * 0.55 / (up * r), bDown = backH * 0.45 / (down * r);
  const P = (sx: number, sy: number, z: number): Pt => [vx + sx * nearHalfW * f(z), vy + (sy < 0 ? sy * up * bUp : sy * down * bDown) * f(z)];
  return { P, f, vx, vy };
};

const poly = (p: Pt[], fill: string, opacity?: number, key?: string | number) => <polygon key={key} points={pts(p)} fill={fill} opacity={opacity} />;

/** Pulsing ECG trace inside a w×h box at (x,y). */
const Ecg: React.FC<{ x: number; y: number; w: number; h: number; t: number; color: string }> = ({ x, y, w, h, t, color }) => {
  const beat = (u: number) => {
    const p = mod(u, 1);
    if (p < 0.08) return Math.sin((p / 0.08) * Math.PI) * 0.15;
    if (p > 0.18 && p < 0.22) return -0.2;
    if (p >= 0.22 && p < 0.27) return 1;
    if (p >= 0.27 && p < 0.32) return -0.4;
    if (p > 0.45 && p < 0.6) return Math.sin(((p - 0.45) / 0.15) * Math.PI) * 0.25;
    return 0;
  };
  const head = mod(t * 0.9, 1);
  let d = "";
  for (let i = 0; i <= 60; i++) {
    const u = i / 60;
    const age = mod(head - u, 1);
    if (age > 0.85) continue;
    d += `${d && age < 0.84 ? "L" : "M"}${(x + u * w).toFixed(1)},${(y + h / 2 - beat(u * 2.2 - t * 0) * h * 0.42).toFixed(1)}`;
  }
  return (
    <g>
      <path d={d} stroke={color} strokeWidth={3.5} fill="none" strokeLinejoin="round" />
      <circle cx={x + head * w} cy={y + h / 2 - beat(head * 2.2) * h * 0.42} r={5} fill="#ffffff" />
      <Glow cx={x + head * w} cy={y + h / 2 - beat(head * 2.2) * h * 0.42} r={22} color={color} opacity={0.8} />
    </g>
  );
};

/** Monitor with screen content (ecg / bars / helix). */
const Monitor: React.FC<{ ctx: Ctx; x: number; y: number; w: number; h: number; kind: number; k: number }> = ({ ctx, x, y, w, h, kind, k }) => {
  const { t } = ctx;
  const scr = "#0b1e2a";
  const c = ["#4dffb0", "#58c7ff", "#ffcf5a", "#ff7ab8"][k % 4]!;
  const content = [];
  if (kind === 0) content.push(<Ecg key="e" x={x + w * 0.06} y={y + h * 0.15} w={w * 0.88} h={h * 0.6} t={t + k} color={c} />);
  else if (kind === 1) {
    for (let i = 0; i < 7; i++) {
      const bh = (0.25 + 0.6 * Math.abs(Math.sin(t * (1.2 + i * 0.3) + i + k))) * h * 0.7;
      content.push(<rect key={i} x={x + w * 0.08 + i * w * 0.12} y={y + h * 0.88 - bh} width={w * 0.08} height={bh} fill={c} opacity={0.85} />);
    }
  } else {
    for (let i = 0; i < 16; i++) {
      const u = i / 15;
      const a = t * 2 + u * TAU * 1.2;
      const cx = x + w / 2, cy = y + h * 0.1 + u * h * 0.8;
      content.push(<circle key={`a${i}`} cx={cx + Math.sin(a) * w * 0.25} cy={cy} r={4 + Math.cos(a) * 1.5} fill={c} />);
      content.push(<circle key={`b${i}`} cx={cx - Math.sin(a) * w * 0.25} cy={cy} r={4 - Math.cos(a) * 1.5} fill={lighten(c, 0.4)} />);
      if (i % 2 === 0) content.push(<line key={`l${i}`} x1={cx + Math.sin(a) * w * 0.25} y1={cy} x2={cx - Math.sin(a) * w * 0.25} y2={cy} stroke={c} strokeWidth={2} opacity={0.5} />);
    }
  }
  const blink = Math.sin(t * 5 + k) > 0;
  return (
    <g>
      <rect x={x - 10} y={y - 10} width={w + 20} height={h + 20} rx={10} fill={ctx.lit("#3a4452")} />
      <rect x={x} y={y} width={w} height={h} rx={4} fill={scr} />
      <Glow cx={x + w / 2} cy={y + h / 2} r={w * 0.8} ry={h * 0.8} color={c} opacity={0.18} />
      {content}
      <circle cx={x + w - 8} cy={y + h + 2} r={3.5} fill={blink ? "#ff5a5a" : "#5a2020"} />
    </g>
  );
};

// ---------------------------------------------------------------------------

export const HospitalBack: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { VW, VH, t, seed } = ctx;
  const { P } = room(ctx, VH * 0.44, VW * 0.34, VH * 0.24);
  const wall = ctx.lit("#dcebea"), wallDark = ctx.lit("#b9d3d3"), floor = ctx.lit("#c4d0da"), ceil = ctx.lit("#eef4f5");
  const stripe = ctx.lit("#3fa7a0");
  const door = ctx.lit("#5aa6c9");
  const out: React.ReactNode[] = [];
  const Z = [0, 1];
  // surfaces
  out.push(poly([P(-1, 1, 0), P(1, 1, 0), P(1, 1, 1), P(-1, 1, 1)], floor, 1, "floor"));
  out.push(poly([P(-1, -1, 0), P(1, -1, 0), P(1, -1, 1), P(-1, -1, 1)], ceil, 1, "ceil"));
  out.push(poly([P(-1, -1, 0), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, 0)], wall, 1, "lw"));
  out.push(poly([P(1, -1, 0), P(1, -1, 1), P(1, 1, 1), P(1, 1, 0)], wallDark, 1, "rw"));
  out.push(poly([P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)], lighten(wall, 0.1), 1, "bw"));
  // floor tiles
  for (let i = -4; i <= 4; i++) out.push(<line key={`fl${i}`} x1={P(i / 4, 1, 0)[0]} y1={P(i / 4, 1, 0)[1]} x2={P(i / 4, 1, 1)[0]} y2={P(i / 4, 1, 1)[1]} stroke={darken(floor, 0.08)} strokeWidth={2} />);
  for (let j = 1; j < 14; j++) {
    const z = 1 - Math.pow(1 - j / 14, 1.2);
    out.push(<line key={`fz${j}`} x1={P(-1, 1, z)[0]} y1={P(-1, 1, z)[1]} x2={P(1, 1, z)[0]} y2={P(1, 1, z)[1]} stroke={darken(floor, 0.08)} strokeWidth={2} />);
  }
  // floor reflection of the back window
  out.push(poly([P(-0.35, 1, 1), P(0.35, 1, 1), P(0.6, 1, 0.3), P(-0.6, 1, 0.3)], "#ffffff", 0.25, "refl"));
  // wall stripes + handrails
  for (const sx of [-1, 1]) {
    out.push(poly([P(sx, 0.05, 0), P(sx, 0.05, 1), P(sx, 0.18, 1), P(sx, 0.18, 0)], stripe, 0.9, `st${sx}`));
    out.push(<line key={`hr${sx}`} x1={P(sx, -0.02, 0)[0]} y1={P(sx, -0.02, 0)[1]} x2={P(sx, -0.02, 1)[0]} y2={P(sx, -0.02, 1)[1]} stroke={ctx.lit("#9aa9b3")} strokeWidth={8} />);
  }
  // doors
  for (const sx of [-1, 1]) {
    for (const z0 of [0.18, 0.5, 0.75]) {
      const z1 = z0 + 0.1;
      out.push(poly([P(sx, -0.45, z0), P(sx, -0.45, z1), P(sx, 1, z1), P(sx, 1, z0)], door, 1, `d${sx}${z0}`));
      out.push(poly([P(sx, -0.35, z0 + 0.02), P(sx, -0.35, z1 - 0.03), P(sx, -0.1, z1 - 0.03), P(sx, -0.1, z0 + 0.02)], "#cfefff", 0.9, `dw${sx}${z0}`));
    }
  }
  // back doors + exit sign
  const b0 = P(-0.4, -0.5, 1), b1 = P(0.4, 1, 1);
  out.push(<rect key="bd" x={b0[0]} y={b0[1]} width={b1[0] - b0[0]} height={b1[1] - b0[1]} fill={door} />);
  out.push(<line key="bdl" x1={(b0[0] + b1[0]) / 2} y1={b0[1]} x2={(b0[0] + b1[0]) / 2} y2={b1[1]} stroke={darken(door, 0.3)} strokeWidth={3} />);
  out.push(<circle key="bw1" cx={b0[0] + (b1[0] - b0[0]) * 0.25} cy={b0[1] + (b1[1] - b0[1]) * 0.3} r={(b1[0] - b0[0]) * 0.12} fill="#e8fbff" />);
  out.push(<circle key="bw2" cx={b0[0] + (b1[0] - b0[0]) * 0.75} cy={b0[1] + (b1[1] - b0[1]) * 0.3} r={(b1[0] - b0[0]) * 0.12} fill="#e8fbff" />);
  const ex = P(0, -0.8, 1);
  out.push(<rect key="ex" x={ex[0] - 40} y={ex[1] - 14} width={80} height={28} rx={4} fill="#1faa59" />);
  out.push(<Glow key="exg" cx={ex[0]} cy={ex[1]} r={70} color="#3dff8a" opacity={0.4} />);
  // medical cross sign on the left wall
  const cs = P(-1, -0.55, 0.32);
  out.push(<g key="cross" transform={`translate(${cs[0] + 20},${cs[1]})`}><rect x={-26} y={-26} width={52} height={52} rx={8} fill="#ffffff" /><path d="M-7,-18h14v11h11v14h-11v11h-14v-11h-11v-14h11Z" fill="#e2464f" /></g>);
  // ceiling light panels (one flickers)
  for (let j = 0; j < 6; j++) {
    const z0 = j / 6 + 0.02, z1 = z0 + 0.06;
    const flick = j === 2 ? (rnd(seed, "fl", Math.floor(t * 12)) < 0.15 ? 0.3 : 1) : 1;
    const q = [P(-0.35, -1, z0), P(0.35, -1, z0), P(0.35, -1, z1), P(-0.35, -1, z1)];
    out.push(poly(q, "#ffffff", flick, `lp${j}`));
    const c = P(0, -1, (z0 + z1) / 2);
    out.push(<Glow key={`lg${j}`} cx={c[0]} cy={c[1] + 10} r={(q[1]![0] - q[0]![0]) * 0.9} ry={60 * (1 - z0)} color="#fdfdf0" opacity={0.5 * flick} />);
  }
  // vp glow
  out.push(<Glow key="vpg" cx={VW / 2} cy={VH * 0.44} r={VW * 0.5} color="#ffffff" opacity={0.35} />);
  void Z;
  return <Layer ctx={ctx} depth={0.7} scrollFactor={0}>{out}</Layer>;
};

export const HospitalFront: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { VW, VH, t } = ctx;
  const mx = VW * 0.83, my = VH * 0.58;
  const drip = mod(t * 1.3, 1);
  return (
    <Layer ctx={ctx} depth={1.25} scrollFactor={0}>
      {/* heart monitor on a stand */}
      <rect x={mx - 6} y={my + 120} width={12} height={VH} fill={ctx.lit("#7c8894")} />
      <Monitor ctx={ctx} x={mx - 120} y={my - 40} w={240} h={150} kind={0} k={1} />
      <text x={mx + 70} y={my - 52} fontSize={26} fontFamily="sans-serif" fontWeight={700} fill="#4dffb0">{72 + Math.round(Math.sin(t) * 3)}</text>
      {/* IV stand */}
      <g transform={`translate(${VW * 0.1},${VH * 0.35})`}>
        <rect x={-4} y={0} width={8} height={VH} fill={ctx.lit("#9aa6b1")} />
        <path d="M-60,0 L60,0" stroke={ctx.lit("#9aa6b1")} strokeWidth={8} strokeLinecap="round" />
        <g transform={`rotate(${Math.sin(t * 1.1) * 2} 40 0)`}>
          <path d="M20,10 Q20,0 40,0 Q60,0 60,10 L62,110 Q40,130 18,110Z" fill="#e8f6ff" opacity={0.85} />
          <path d="M22,60 L58,60 L60,110 Q40,128 20,110Z" fill="#9fd8ff" opacity={0.8} />
          <rect x={36} y={122} width={8} height={30} fill="#d8e8f0" />
          <circle cx={40} cy={158 + drip * 40} r={4} fill="#9fd8ff" opacity={1 - drip} />
          <path d="M40,152 Q60,300 20,500" stroke="#d8e8f0" strokeWidth={4} fill="none" />
        </g>
      </g>
    </Layer>
  );
};

// ---------------------------------------------------------------------------

export const LabBack: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { VW, VH, t, seed } = ctx;
  const wall = ctx.lit("#dfe8f0"), floor = ctx.lit("#aeb9c6");
  const benchY = VH * 0.66;
  const out: React.ReactNode[] = [];
  out.push(<rect key="w" x={-300} y={-300} width={VW + 600} height={benchY + 400} fill={wall} />);
  out.push(<rect key="wp" x={-300} y={benchY - 330} width={VW + 600} height={14} fill={ctx.lit("#8fb8d8")} />);
  out.push(<rect key="f" x={-300} y={benchY + 120} width={VW + 600} height={VH} fill={floor} />);
  // monitors wall
  const cols = Math.max(2, Math.round(VW / 300));
  for (let i = 0; i < cols; i++) {
    const w = 190, h = 130;
    const x = (i + 0.5) * (VW / cols) - w / 2;
    out.push(<Monitor key={`m${i}`} ctx={ctx} x={x} y={VH * 0.2 + (i % 2) * 40} w={w} h={h} kind={i % 3} k={i} />);
  }
  // shelves with bottles
  for (let i = 0; i < cols; i++) {
    const x = (i + 0.5) * (VW / cols);
    out.push(<rect key={`sh${i}`} x={x - 120} y={VH * 0.44} width={240} height={10} fill={ctx.lit("#9aa5b3")} />);
    for (let b = 0; b < 4; b++) {
      const bc = ["#ff7a7a", "#6fd3ff", "#8dff9a", "#ffd36b", "#c38bff"][Math.floor(rnd(seed, "bc", i, b) * 5)]!;
      out.push(<g key={`b${i}${b}`} transform={`translate(${x - 90 + b * 58},${VH * 0.44})`}><rect x={-14} y={-60} width={28} height={60} rx={6} fill={ctx.lit(bc)} opacity={0.85} /><rect x={-6} y={-76} width={12} height={18} fill={ctx.lit("#c8d2dc")} /></g>);
    }
  }
  // bench
  out.push(<rect key="bt" x={-300} y={benchY} width={VW + 600} height={26} fill={ctx.lit("#3b4656")} />);
  out.push(<rect key="bb" x={-300} y={benchY + 26} width={VW + 600} height={100} fill={ctx.lit("#cfd8e2")} />);
  for (let i = 0; i < 6; i++) out.push(<rect key={`dr${i}`} x={i * (VW / 5) - 60} y={benchY + 40} width={VW / 5 - 30} height={70} rx={6} fill={ctx.lit("#b8c4d0")} />);
  // flasks bubbling
  const flasks = Math.max(3, Math.round(VW / 220));
  for (let i = 0; i < flasks; i++) {
    const x = (i + 0.5) * (VW / flasks) + rr(seed, -30, 30, "fx", i);
    const c = ["#39e6a0", "#ff5fa2", "#4fb8ff", "#ffc53d"][i % 4]!;
    const h = rr(seed, 90, 140, "fh", i);
    const bubbles = [];
    for (let b = 0; b < 6; b++) {
      const u = mod(t * rr(seed, 0.6, 1.2, "bs", i, b) + b / 6, 1);
      bubbles.push(<circle key={b} cx={x + Math.sin(u * 9 + b) * 8} cy={benchY - 16 - u * h * 0.55} r={3 + b % 3} fill="#ffffff" opacity={0.7 * (1 - u)} />);
    }
    out.push(
      <g key={`fl${i}`}>
        <Glow cx={x} cy={benchY - 30} r={90} color={c} opacity={0.35 + 0.1 * Math.sin(t * 3 + i)} />
        <path d={`M${x - 14},${benchY - h} L${x - 14},${benchY - h * 0.55} L${x - 48},${benchY} L${x + 48},${benchY} L${x + 14},${benchY - h * 0.55} L${x + 14},${benchY - h}Z`} fill="#e9f6ff" opacity={0.6} />
        <path d={`M${x - 32},${benchY - h * 0.25} L${x - 48},${benchY} L${x + 48},${benchY} L${x + 32},${benchY - h * 0.25}Z`} fill={ctx.lit(c)} opacity={0.9} />
        {bubbles}
      </g>,
    );
  }
  // ceiling lamps
  for (let i = 0; i < cols; i++) {
    const x = (i + 0.5) * (VW / cols);
    out.push(<g key={`cl${i}`}><line x1={x} y1={-100} x2={x} y2={VH * 0.08} stroke={ctx.lit("#555f6c")} strokeWidth={4} /><path d={`M${x - 60},${VH * 0.1} L${x - 30},${VH * 0.08} L${x + 30},${VH * 0.08} L${x + 60},${VH * 0.1}Z`} fill={ctx.lit("#3d4652")} /><Glow cx={x} cy={VH * 0.12} r={150} color="#fffbe8" opacity={0.55} /></g>);
  }
  return <Layer ctx={ctx} depth={0.7} scrollFactor={0}>{out}</Layer>;
};

// ---------------------------------------------------------------------------

/** Where the power-station generator's left face sits (world x). */
export const generatorX = (ctx: Ctx): number => ctx.VW * 0.55;

export const PowerBack: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { VW, VH, t, seed } = ctx;
  const g = VH * 0.86;
  const wall = ctx.lit("#2a3446"), wall2 = ctx.lit("#222b3a");
  const out: React.ReactNode[] = [];
  out.push(<rect key="w" x={-300} y={-300} width={VW + 600} height={g + 300} fill={wall} />);
  for (let i = -2; i < VW / 120 + 2; i++) out.push(<rect key={`p${i}`} x={i * 120} y={-300} width={116} height={g + 300} fill={i % 2 ? wall : wall2} />);
  // pipes
  for (const [y, r, c] of [[VH * 0.18, 34, "#6b7a8f"], [VH * 0.26, 22, "#8a6a4a"], [VH * 0.52, 28, "#5a7a6a"]] as const) {
    out.push(<rect key={`pi${y}`} x={-300} y={y - r} width={VW + 600} height={r * 2} fill={ctx.lit(c)} />);
    out.push(<rect key={`ph${y}`} x={-300} y={y - r * 0.6} width={VW + 600} height={r * 0.35} fill={lighten(ctx.lit(c), 0.25)} opacity={0.6} />);
    for (let i = 0; i < VW / 240 + 1; i++) out.push(<rect key={`pj${y}${i}`} x={i * 240 + 60} y={y - r - 6} width={20} height={r * 2 + 12} fill={darken(ctx.lit(c), 0.3)} />);
  }
  // gauges
  for (let i = 0; i < 3; i++) {
    const x = VW * (0.15 + i * 0.12), y = VH * 0.38;
    const a = -0.8 + 1.1 * (0.5 + 0.5 * Math.sin(t * (1.5 + i))) + (rnd(seed, "gj", i, Math.floor(t * 20)) - 0.5) * 0.12;
    out.push(<g key={`g${i}`}><circle cx={x} cy={y} r={36} fill={ctx.lit("#dfe6ee")} stroke={ctx.lit("#6c7684")} strokeWidth={8} /><path d={`M${x - 26},${y + 10} A28,28 0 0 1 ${x + 26},${y + 10}`} stroke="#e24a4a" strokeWidth={4} fill="none" strokeDasharray="4 4" /><line x1={x} y1={y} x2={x + Math.sin(a) * 28} y2={y - Math.cos(a) * 28} stroke="#222" strokeWidth={4} strokeLinecap="round" /></g>);
  }
  // high-voltage sign
  const hx = VW * 0.2, hy = VH * 0.6;
  out.push(<g key="hv" transform={`translate(${hx},${hy})`}><path d="M0,-50 L48,34 L-48,34Z" fill="#ffcc33" stroke="#1c1c1c" strokeWidth={6} strokeLinejoin="round" /><path d="M4,-24 L-10,6 L2,6 L-6,26 L12,-6 L0,-6Z" fill="#1c1c1c" /></g>);
  // rotating warning beacons
  for (let i = 0; i < 2; i++) {
    const x = VW * (0.08 + i * 0.84), y = VH * 0.1;
    const a = t * 5 + i * 2;
    const vis = Math.max(0, Math.cos(a));
    out.push(<g key={`bc${i}`}><rect x={x - 22} y={y} width={44} height={16} fill={ctx.lit("#333")} /><path d={`M${x - 18},${y} Q${x - 18},${y - 40} ${x},${y - 40} Q${x + 18},${y - 40} ${x + 18},${y}Z`} fill="#ffae2b" /><Glow cx={x} cy={y - 20} r={80 + 180 * vis} ry={60 + 40 * vis} color="#ffae2b" opacity={0.3 + 0.5 * vis} /></g>);
  }
  // floor
  out.push(<rect key="f" x={-300} y={g} width={VW + 600} height={VH} fill={ctx.lit("#1a2130")} />);
  out.push(<rect key="fs" x={-300} y={g} width={VW + 600} height={10} fill={ctx.lit("#4a5568")} />);
  let hz = "";
  for (let x = -300; x < VW + 300; x += 60) hz += `M${x},${g + 10}l30,0l-30,30l-30,0Z`;
  out.push(<g key="hz"><rect x={-300} y={g + 10} width={VW + 600} height={30} fill="#ffcc33" /><path d={hz} fill="#1c1c1c" /></g>);
  return <Layer ctx={ctx} depth={0.7} scrollFactor={0}>{out}</Layer>;
};

/** The generator itself sits in the subject plane so a character can touch it. */
export const PowerFront: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const { VH, t, seed, frame } = ctx;
  const g = VH * 0.86;
  const x0 = generatorX(ctx);
  const w = 520, h = 640;
  const top = g - h;
  const id = useSid();
  const zap = ctx.spec.action === "zap";
  const burst = zap ? 1 : mod(t, 2.4) < 0.7 ? 1 : 0;
  const leds = [];
  for (let i = 0; i < 12; i++) {
    const on = rnd(seed, "led", i, Math.floor(t * 4 + i * 0.3)) < 0.55;
    const c = ["#39ff88", "#ffcc33", "#ff4d4d", "#4fc3ff"][i % 4]!;
    leds.push(<circle key={i} cx={x0 + 70 + (i % 4) * 30} cy={top + 250 + Math.floor(i / 4) * 30} r={8} fill={on ? c : darken(c, 0.7)} />);
  }
  const coilGlow = 0.6 + 0.4 * Math.sin(t * 7);
  return (
    <Layer ctx={ctx} depth={1} scrollFactor={0}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor={ctx.lit("#8894a6")} />
          <stop offset="0.25" stopColor={ctx.lit("#c7d0dc")} />
          <stop offset="0.6" stopColor={ctx.lit("#6e7a8c")} />
          <stop offset="1" stopColor={ctx.lit("#3e4756")} />
        </linearGradient>
      </defs>
      <ellipse cx={x0 + w / 2} cy={g + 12} rx={w * 0.62} ry={26} fill="#000" opacity={0.4} />
      {/* housing */}
      <rect x={x0} y={top + 60} width={w} height={h - 60} rx={24} fill={`url(#${id})`} />
      <rect x={x0 + 20} y={top + 20} width={w - 40} height={80} rx={18} fill={ctx.lit("#5b6576")} />
      {/* copper coil drum */}
      <rect x={x0 + 90} y={top - 70} width={w - 180} height={110} rx={50} fill={ctx.lit("#b0662e")} />
      {Array.from({ length: 12 }, (_, i) => <rect key={i} x={x0 + 105 + i * ((w - 210) / 12)} y={top - 66} width={8} height={102} fill={ctx.lit("#e09a4f")} />)}
      <Glow cx={x0 + w / 2} cy={top - 15} r={w * 0.45} ry={90} color="#ff9a3c" opacity={coilGlow * 0.55} />
      {/* terminals */}
      {[x0 + 60, x0 + w - 60].map((tx, i) => <g key={i}><rect x={tx - 14} y={top - 120} width={28} height={140} fill={ctx.lit("#3a404a")} /><circle cx={tx} cy={top - 126} r={22} fill={ctx.lit("#c9ced6")} /></g>)}
      {/* vents */}
      {Array.from({ length: 7 }, (_, i) => <rect key={`v${i}`} x={x0 + w * 0.55} y={top + 150 + i * 36} width={w * 0.35} height={14} rx={7} fill={ctx.lit("#2b323d")} />)}
      {/* control panel */}
      <rect x={x0 + 50} y={top + 220} width={150} height={120} rx={10} fill={ctx.lit("#20262f")} />
      {leds}
      {/* hazard band */}
      <rect x={x0} y={g - 70} width={w} height={34} fill="#ffcc33" />
      <path d={Array.from({ length: 10 }, (_, i) => `M${x0 + i * 52},${g - 36}l26,-34l26,0l-26,34Z`).join("")} fill="#1c1c1c" />
      <path d={`M${x0 + w - 40},${g - 80} C${x0 + w + 40},${g - 40} ${x0 + w + 80},${g} ${x0 + w + 200},${g}`} stroke="#15181d" strokeWidth={22} fill="none" />
      {/* arcs between terminals */}
      {burst ? (
        <>
          <Arc a={[x0 + 60, top - 130]} b={[x0 + w - 60, top - 130]} frame={frame} seed={seed} k="term" width={5} amp={70} branches={3} />
          <Glow cx={x0 + w / 2} cy={top - 140} r={260} color="#8fe3ff" opacity={0.35} />
          <Sparks x={x0 + 60} y={top - 130} t={t} seed={seed} k="ts1" rate={26} color="#bff1ff" speed={460} />
          <Sparks x={x0 + w - 60} y={top - 130} t={t} seed={seed} k="ts2" rate={26} color="#bff1ff" speed={460} />
        </>
      ) : null}
    </Layer>
  );
};
export { TAU, mix };
