/** Lion (mane, roar) and cat (tail swish, blink, walk). Ground at y = 0, facing +x. */
import React from "react";
import { roarStart } from "../camera";
import { darken, lighten } from "../lib/color";
import { easeOut, pick, prog, smoothPath, wobble, type Pt } from "../lib/math";
import { chain, ribbon } from "../lib/rig";
import { J } from "../lib/svg";
import { Eye, GAITS, quadLegs, SoundRings, WALK_PHASE, type LegDef } from "./quad";
import type { CharProps } from "./types";

/** 0..1 roar envelope and anticipation dip. */
export const roarEnv = (t: number, dur: number): { roar: number; dip: number } => {
  const rs = roarStart(dur);
  const end = Math.min(dur - 0.4, rs + 1.9);
  const roar = easeOut(prog(t, rs, rs + 0.22)) * (1 - easeOut(prog(t, end, end + 0.35)));
  const dip = prog(t, rs - 0.45, rs - 0.1) * (1 - prog(t, rs - 0.05, rs + 0.1));
  return { roar, dip };
};

const tailPath = (base: Pt, ang: number, t: number, seed: number, segs: number, len: number, curl: number, sway: number): Pt[] =>
  chain(base, ang, segs, len, (i) => curl + Math.sin(t * 2.2 - i * 0.55) * sway + wobble(t * 0.7, seed, "tail") * 0.04);

/** Fluffy lobed ring (mane) as a closed smooth path. */
const lobes = (n: number, r0: number, r1: number, t: number, seed: number, k: string, flare: number): string => {
  const pts: Pt[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (i / (n * 2)) * Math.PI * 2;
    const r = (i % 2 ? r0 : r1) * (1 + flare) + wobble(t * 1.8 + i * 0.7, seed, `${k}${i}`) * 6;
    pts.push([Math.cos(a) * r, Math.sin(a) * r * 1.08]);
  }
  return smoothPath(pts, true, 1);
};

export const Lion: React.FC<CharProps> = (p) => {
  const { ctx, t, seed, action } = p;
  const L = ctx.lit;
  const fur = L("#dc9d42"), furLight = L("#f5d08a"), furDark = L("#b97a2c"), mane = L("#7e3a14"), mane2 = L("#a9531f"), mane3 = L("#c9702f"), dark = L("#3a2014");
  const moving = action === "walk" || action === "run";
  const { roar, dip } = action === "roar" ? roarEnv(t, ctx.dur) : { roar: 0, dip: 0 };
  const legs: LegDef[] = [
    { x: -118, y: -200, l1: 112, l2: 104, w: [72, 44, 34], bend: -1, phase: WALK_PHASE.lh, near: false },
    { x: 150, y: -200, l1: 106, l2: 104, w: [58, 42, 36], bend: 1, phase: WALK_PHASE.lf, near: false, footDx: 6 },
    { x: -145, y: -202, l1: 114, l2: 106, w: [80, 46, 36], bend: -1, phase: WALK_PHASE.rh, near: true },
    { x: 122, y: -202, l1: 108, l2: 104, w: [64, 44, 38], bend: 1, phase: WALK_PHASE.rf, near: true, footDx: 6 },
  ];
  const { far, near, bob } = quadLegs(p, legs, GAITS.walk, moving, fur, (f, _k, n) => (
    <g>
      <ellipse cx={f[0] + 14} cy={f[1] - 13} rx={31} ry={16} fill={n ? furLight : darken(furLight, 0.28)} />
      {n ? <path d={`M${f[0] + 14},${f[1] - 20} v12 M${f[0] + 28},${f[1] - 19} v11`} stroke={furDark} strokeWidth={3} strokeLinecap="round" /> : null}
    </g>
  ));
  const breathe = Math.sin(t * 2.1) * 3;
  const tail = tailPath([-190, -250 + bob], Math.PI * 0.78, t, seed, 11, 24, -0.075, 0.13);
  const tip = tail[tail.length - 1]!;
  const nod = moving ? Math.sin((t * Math.PI * 4) / GAITS.walk.period) * 2 : wobble(t * 0.6, seed, "nod") * 4;
  const headRot = nod + dip * 12 - roar * 18;
  const headX = 205 + roar * 22, headY = -300 + bob + dip * 16 - roar * 10;
  const open = roar * (0.85 + Math.sin(t * 34) * 0.08);
  return (
    <g>
      {far}
      <path d={smoothPath(ribbon(tail, (u) => 17 - u * 7), true, 0.6)} fill={fur} />
      <ellipse cx={tip[0]} cy={tip[1]} rx={24} ry={17} fill={mane} transform={`rotate(${Math.sin(t * 2) * 20} ${tip[0]} ${tip[1]})`} />
      <g transform={`translate(0,${bob}) scale(1,${1 + breathe * 0.003})`}>
        <path d={smoothPath([[-195, -262], [-120, -300], [20, -290], [130, -318], [205, -300], [228, -226], [196, -156], [100, -134], [-40, -136], [-150, -146], [-205, -196]], true)} fill={fur} />
        <path d={smoothPath([[190, -170], [100, -140], [-40, -142], [-140, -152], [-40, -170], [100, -176]], true)} fill={furLight} opacity={0.85} />
        <ellipse cx={-145} cy={-205} rx={82} ry={90} fill={furDark} opacity={0.55} />
        <ellipse cx={122} cy={-215} rx={62} ry={80} fill={furDark} opacity={0.35} />
        <path d="M-185,-252 Q-130,-294 -60,-276 Q40,-266 120,-300" stroke={lighten(fur, 0.25)} strokeWidth={9} fill="none" strokeLinecap="round" opacity={0.55} />
      </g>
      {near}
      <J x={headX} y={headY} r={headRot}>
        {/* mane: three lobed layers + chest ruff */}
        <g transform={`translate(-34,14)`}>
          <ellipse cx={-20} cy={80} rx={80} ry={95} fill={mane} />
          <path d={lobes(13, 128, 150, t, seed, "a", roar * 0.1)} fill={mane} />
          <path d={lobes(12, 104, 124, t + 1, seed, "b", roar * 0.08)} fill={mane2} />
          <path d={lobes(11, 84, 100, t + 2, seed, "c", roar * 0.06)} fill={mane3} opacity={0.9} />
        </g>
        <ellipse cx={-30} cy={-60} rx={21} ry={19} fill={fur} />
        <ellipse cx={-28} cy={-58} rx={11} ry={10} fill={dark} opacity={0.45} />
        <ellipse cx={34} cy={-72} rx={19} ry={18} fill={fur} />
        <ellipse cx={34} cy={-70} rx={10} ry={9} fill={dark} opacity={0.45} />
        <ellipse cx={14} cy={-4} rx={70} ry={70} fill={fur} />
        <path d="M-30,-44 Q14,-72 60,-50" stroke={lighten(fur, 0.22)} strokeWidth={10} fill="none" strokeLinecap="round" opacity={0.55} />
        {/* mouth (open when roaring) */}
        {open > 0.03 ? (
          <g>
            <path d={`M26,32 Q60,${30 + 70 * open} 98,32 Q96,20 60,22 Q34,22 26,32Z`} fill="#4a1010" />
            <ellipse cx={62} cy={32 + 48 * open} rx={24} ry={10 * open} fill="#c2485a" />
            <path d={`M34,30 l7,${18 * open + 4} l7,${-18 * open - 4}Z M76,30 l7,${18 * open + 4} l7,${-18 * open - 4}Z`} fill="#fffbee" />
            <path d={`M38,${32 + 62 * open} l6,${-16 * open - 3} l6,${16 * open + 3}Z M74,${32 + 62 * open} l6,${-16 * open - 3} l6,${16 * open + 3}Z`} fill="#fffbee" />
            <path d={`M24,${34 + 58 * open} Q60,${62 + 70 * open} 100,${32 + 58 * open} Q96,${50 + 64 * open} 60,${56 + 66 * open} Q30,${52 + 62 * open} 24,${34 + 58 * open}Z`} fill={furLight} />
          </g>
        ) : (
          <ellipse cx={58} cy={46} rx={30} ry={14} fill={furLight} />
        )}
        {/* muzzle */}
        <ellipse cx={42} cy={18} rx={30} ry={22} fill={furLight} />
        <ellipse cx={80} cy={18} rx={30} ry={22} fill={furLight} />
        <path d="M44,-4 Q62,-10 80,-4 Q84,10 62,20 Q40,10 44,-4Z" fill={L("#4a2618")} />
        <path d="M58,-2 Q64,-6 70,-2" stroke="#8a5a44" strokeWidth={3} fill="none" strokeLinecap="round" />
        {open <= 0.03 ? <path d="M62,20 L62,32 M62,32 Q50,42 36,36 M62,32 Q74,42 88,36" stroke={dark} strokeWidth={3.5} fill="none" strokeLinecap="round" /> : null}
        {[0, 1, 2].map((i) => <circle key={i} cx={36 + i * 8} cy={16 + (i % 2) * 6} r={2.3} fill={dark} opacity={0.5} />)}
        {[0, 1, 2].map((i) => <circle key={`r${i}`} cx={80 + i * 8} cy={16 + (i % 2) * 6} r={2.3} fill={dark} opacity={0.5} />)}
        <path d={`M4,${-34 - roar * 8} Q20,${-44 - roar * 10} 34,${-34 - roar * 4}`} stroke={dark} strokeWidth={5} fill="none" strokeLinecap="round" />
        <path d={`M72,${-38 - roar * 4} Q86,${-46 - roar * 10} 98,${-36 - roar * 8}`} stroke={dark} strokeWidth={5} fill="none" strokeLinecap="round" />
        <Eye x={20} y={-20} r={11} t={t} seed={seed} iris="#c9851f" look={0.3} />
        <Eye x={84} y={-22} r={11} t={t} seed={seed} iris="#c9851f" look={0.3} />
      </J>
      <SoundRings x={headX + 115} y={headY + 30} ang={-0.35} t={t} on={roar} color="#fff4d8" size={1.3} />
    </g>
  );
};

const CAT_COLORS: Record<string, [string, string, string]> = {
  orange: ["#e8923c", "#fbe3c4", "#b8621f"],
  black: ["#2d2d38", "#4a4a58", "#1b1b22"],
  white: ["#f4f1ec", "#ffffff", "#d8d2c8"],
  gray: ["#8d939e", "#d9dde3", "#6a707a"],
  brown: ["#8a5a3a", "#d8b894", "#5e3a22"],
};

export const Cat: React.FC<CharProps> = (p) => {
  const { ctx, t, seed, action } = p;
  const L = ctx.lit;
  const key = ctx.spec.color && CAT_COLORS[ctx.spec.color] ? ctx.spec.color : pick(seed, ["orange", "gray", "black", "orange", "white"] as const, "cat");
  const [c0, c1, c2] = CAT_COLORS[key]!;
  const fur = L(c0), light = L(c1), stripe = L(c2);
  const moving = action === "walk" || action === "run";
  const legs: LegDef[] = [
    { x: -78, y: -146, l1: 84, l2: 80, w: [46, 28, 22], bend: -1, phase: WALK_PHASE.lh, near: false },
    { x: 104, y: -146, l1: 78, l2: 76, w: [34, 26, 22], bend: 1, phase: WALK_PHASE.lf, near: false },
    { x: -98, y: -148, l1: 86, l2: 80, w: [50, 30, 24], bend: -1, phase: WALK_PHASE.rh, near: true },
    { x: 84, y: -148, l1: 80, l2: 76, w: [36, 26, 22], bend: 1, phase: WALK_PHASE.rf, near: true },
  ];
  const { far, near, bob } = quadLegs(p, legs, GAITS.walk, moving, fur, (f, _k, n) => <ellipse cx={f[0] + 8} cy={f[1] - 8} rx={17} ry={9} fill={n ? light : darken(light, 0.3)} />);
  const tail = chain([-122, -180 + bob], -Math.PI * 0.62, 12, 20, (i) => 0.08 + Math.sin(t * 1.8 - i * 0.45) * 0.13 + (i > 8 ? 0.12 : 0));
  const tilt = wobble(t * 0.5, seed, "tilt") * 8;
  const earTw = Math.max(0, Math.sin(t * 1.3 + 2) - 0.85) * 60;
  const breathe = Math.sin(t * 2.4) * 2;
  return (
    <g>
      {far}
      <path d={smoothPath(ribbon(tail, (u) => 18 - u * 6), true, 0.6)} fill={fur} />
      <g transform={`translate(0,${bob}) scale(1,${1 + breathe * 0.004})`}>
        <path d={smoothPath([[-132, -172], [-82, -208], [20, -198], [112, -212], [150, -176], [130, -122], [50, -112], [-50, -108], [-126, -122]], true)} fill={fur} />
        <path d={smoothPath([[118, -134], [50, -116], [-50, -114], [-110, -124], [0, -134]], true)} fill={light} opacity={0.8} />
        {key === "orange" || key === "gray" || key === "brown"
          ? [-86, -52, -18, 16, 50].map((x) => <path key={x} d={`M${x},-208 q10,22 0,44`} stroke={stripe} strokeWidth={10} fill="none" strokeLinecap="round" />)
          : null}
      </g>
      {near}
      <J x={162} y={-226 + bob} r={tilt} s={1.15}>
        <path d={`M-38,-24 L-44,-${86 + earTw * 0.3} L-6,-46Z`} fill={fur} />
        <path d={`M-32,-34 L-38,-${74 + earTw * 0.3} L-14,-48Z`} fill={L("#f2a7a7")} />
        <J x={14} y={-40} r={-earTw}>
          <path d="M-12,4 L4,-44 L26,4Z" fill={fur} />
          <path d="M-5,0 L5,-32 L17,0Z" fill={L("#f2a7a7")} />
        </J>
        <ellipse cx={0} cy={0} rx={56} ry={50} fill={fur} />
        <ellipse cx={30} cy={20} rx={30} ry={22} fill={light} />
        {key !== "black" ? <path d="M-10,-46 l6,20 M4,-48 l2,20 M18,-46 l-2,18" stroke={stripe} strokeWidth={5} strokeLinecap="round" /> : null}
        <Eye x={10} y={-6} r={11} t={t} seed={seed} iris="#7cc242" look={0.3} slit />
        <Eye x={40} y={-6} r={9} t={t} seed={seed} iris="#7cc242" look={0.3} slit />
        <path d="M50,12 L60,12 L55,19Z" fill={L("#e87a8a")} />
        <path d="M55,19 Q55,28 46,28 M55,19 Q56,28 64,27" stroke={darken(fur, 0.5)} strokeWidth={2.5} fill="none" strokeLinecap="round" />
        <path d="M42,22 L-4,16 M42,26 L-2,30 M66,22 L104,14 M66,26 L102,30" stroke={light} strokeWidth={2} opacity={0.9} />
      </J>
    </g>
  );
};
