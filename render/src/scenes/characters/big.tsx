/** Bear (walk), elephant (ear flap, trunk sway, walk) and deer (graze, leap, walk). Ground y = 0, facing +x. */
import React from "react";
import { roarStart } from "../camera";
import { darken, lighten } from "../lib/color";
import { easeInOut, mod, prog, rnd, smoothPath, wobble, type Pt } from "../lib/math";
import { chain, ribbon } from "../lib/rig";
import { J } from "../lib/svg";
import { Eye, GAITS, quadLegs, SoundRings, TROT_PHASE, WALK_PHASE, type LegDef } from "./quad";
import type { CharProps } from "./types";

export const Bear: React.FC<CharProps> = (p) => {
  const { ctx, t, seed, action } = p;
  const L = ctx.lit;
  const c = ctx.spec.color;
  const base = c === "white" || c === "snowy" || c === "arctic" ? "#eeeae0" : c === "black" ? "#2e2a2a" : "#7a4a2a";
  const fur = L(base), light = L(lighten(base, 0.35)), dark = L("#241612");
  const moving = action === "walk" || action === "run";
  const gait = { period: 1.25, duty: 0.64, lift: 30 };
  const legs: LegDef[] = [
    { x: -110, y: -200, l1: 104, l2: 96, w: [86, 60, 52], bend: -1, phase: WALK_PHASE.lh, near: false },
    { x: 150, y: -200, l1: 100, l2: 98, w: [74, 58, 52], bend: 1, phase: WALK_PHASE.lf, near: false, footDx: 6 },
    { x: -138, y: -202, l1: 106, l2: 96, w: [92, 62, 54], bend: -1, phase: WALK_PHASE.rh, near: true },
    { x: 122, y: -202, l1: 102, l2: 98, w: [78, 60, 54], bend: 1, phase: WALK_PHASE.rf, near: true, footDx: 6 },
  ];
  const { far, near, bob } = quadLegs(p, legs, gait, moving, fur, (f, _k, n) => (
    <g>
      <ellipse cx={f[0] + 14} cy={f[1] - 14} rx={38} ry={17} fill={n ? fur : darken(fur, 0.28)} />
      {n ? <path d={`M${f[0] + 34},${f[1] - 20} l10,4 M${f[0] + 34},${f[1] - 12} l10,4`} stroke={light} strokeWidth={3} strokeLinecap="round" /> : null}
    </g>
  ));
  const rs = roarStart(ctx.dur);
  const roar = action === "roar" ? easeInOut(prog(t, rs, rs + 0.25)) * (1 - easeInOut(prog(t, rs + 1.8, rs + 2.1))) : 0;
  const sway = moving ? Math.sin((t * Math.PI * 2) / gait.period) * 5 : wobble(t * 0.5, seed, "b") * 5;
  const breathe = Math.sin(t * 1.8) * 3;
  return (
    <g>
      {far}
      <g transform={`translate(0,${bob}) scale(1,${1 + breathe * 0.003})`}>
        <path d={smoothPath([[-200, -230], [-150, -300], [-40, -300], [80, -350], [170, -320], [215, -250], [200, -170], [120, -140], [0, -134], [-130, -140], [-205, -180]], true)} fill={fur} />
        <circle cx={-195} cy={-230} r={16} fill={fur} />
        <path d="M-170,-280 Q-60,-330 90,-340" stroke={lighten(fur, 0.2)} strokeWidth={12} fill="none" strokeLinecap="round" opacity={0.45} />
        <path d="M150,-170 Q60,-140 -60,-148" stroke={darken(fur, 0.2)} strokeWidth={14} fill="none" strokeLinecap="round" opacity={0.45} />
      </g>
      {near}
      <J x={225} y={-235 + bob} r={sway * 0.6 - roar * 16}>
        <circle cx={-26} cy={-58} r={22} fill={fur} />
        <circle cx={-24} cy={-56} r={11} fill={dark} opacity={0.5} />
        <circle cx={20} cy={-62} r={20} fill={fur} />
        <ellipse cx={0} cy={0} rx={62} ry={56} fill={fur} />
        <path d={smoothPath([[20, -22], [78, -12], [96, 8], [82, 30], [30, 34]], true)} fill={light} />
        <J x={40} y={26} r={roar * 26}>
          <path d="M-10,0 Q30,-2 56,2 Q40,20 0,16Z" fill={light} />
        </J>
        {roar > 0.1 ? <path d={`M34,26 L94,20 L88,${30 + roar * 26}Z`} fill="#4a1414" /> : null}
        {roar > 0.1 ? <path d="M48,26 l5,10 l5,-10 M72,24 l5,10 l5,-10" fill="#fff" /> : null}
        <ellipse cx={92} cy={4} rx={14} ry={11} fill={dark} />
        <Eye x={28} y={-16} r={8} t={t} seed={seed} iris="#2a1508" look={0.3} />
      </J>
      <SoundRings x={330} y={-230 + bob} ang={-0.2} t={t} on={roar} color="#fff4e0" />
    </g>
  );
};

export const Elephant: React.FC<CharProps> = (p) => {
  const { ctx, t, seed, action } = p;
  const L = ctx.lit;
  const skin = L("#949bab"), dark = L("#6e7586"), light = L("#b7bdc9");
  const moving = action === "walk" || action === "run";
  const gait = { period: 1.5, duty: 0.66, lift: 28 };
  const legs: LegDef[] = [
    { x: -130, y: -250, l1: 128, l2: 118, w: [104, 84, 80], bend: -1, phase: WALK_PHASE.lh, near: false },
    { x: 150, y: -250, l1: 126, l2: 120, w: [98, 84, 82], bend: 1, phase: WALK_PHASE.lf, near: false },
    { x: -160, y: -252, l1: 130, l2: 118, w: [110, 88, 84], bend: -1, phase: WALK_PHASE.rh, near: true },
    { x: 118, y: -252, l1: 128, l2: 120, w: [104, 88, 86], bend: 1, phase: WALK_PHASE.rf, near: true },
  ];
  const { far, near, bob } = quadLegs(p, legs, gait, moving, skin, (f, _k, n) => (
    <g>
      <ellipse cx={f[0]} cy={f[1] - 10} rx={46} ry={13} fill={n ? skin : darken(skin, 0.28)} />
      {n ? [-24, 0, 24].map((dx) => <ellipse key={dx} cx={f[0] + dx} cy={f[1] - 12} rx={9} ry={7} fill={L("#e8e2d4")} />) : null}
    </g>
  ));
  const flap = Math.sin(t * 2.6) * 0.5 + 0.5; // 0..1
  const trunk = chain([95, 60], Math.PI * 0.5 - 0.35, 10, 30, (i) => 0.05 + Math.sin(t * 1.6 - i * 0.45) * 0.09 + (i > 7 ? 0.25 : 0) + wobble(t * 0.5, seed, "tr") * 0.03);
  const tail = chain([-235, -330 + bob], Math.PI * 0.55, 6, 22, (i) => Math.sin(t * 3 - i) * 0.1);
  const tailTip = tail[tail.length - 1]!;
  const breathe = Math.sin(t * 1.5) * 3;
  return (
    <g>
      {far}
      <path d={smoothPath(ribbon(tail, (u) => 9 - u * 4), true, 0.6)} fill={dark} />
      <ellipse cx={tailTip[0]} cy={tailTip[1]} rx={7} ry={14} fill={L("#3a3a44")} />
      <g transform={`translate(0,${bob}) scale(1,${1 + breathe * 0.003})`}>
        <path d={smoothPath([[-240, -300], [-180, -420], [-40, -450], [100, -440], [200, -400], [230, -300], [200, -210], [80, -190], [-60, -186], [-200, -200]], true)} fill={skin} />
        <path d="M-210,-360 Q-100,-450 60,-440" stroke={light} strokeWidth={14} fill="none" strokeLinecap="round" opacity={0.5} />
        {[-120, -60, 0, 60].map((x) => <path key={x} d={`M${x},-210 q-8,-30 0,-60`} stroke={dark} strokeWidth={4} fill="none" opacity={0.4} />)}
      </g>
      {near}
      <J x={200} y={-380 + bob} r={wobble(t * 0.5, seed, "h") * 3}>
        <path d={smoothPath(ribbon(trunk, (u) => 56 - u * 30), true, 0.7)} fill={skin} />
        {trunk.slice(2, 9).map((q, i) => <path key={i} d={`M${q[0] - 12},${q[1]} l24,${-4}`} stroke={dark} strokeWidth={3} opacity={0.5} />)}
        <ellipse cx={30} cy={-10} rx={92} ry={98} fill={skin} />
        <ellipse cx={10} cy={-60} rx={60} ry={34} fill={light} opacity={0.4} />
        <path d="M70,50 Q110,100 150,86 Q120,78 96,40Z" fill="#f4efe2" />
        <Eye x={60} y={-10} r={9} t={t} seed={seed} iris="#2a1a10" look={0.3} />
        <path d="M48,-26 Q60,-34 74,-26" stroke={dark} strokeWidth={4} fill="none" strokeLinecap="round" />
        {/* ear flaps around its front edge */}
        <g transform={`translate(-20,-40) scale(${0.72 + flap * 0.28},1) skewY(${-flap * 6})`}>
          <path d={smoothPath([[0, -60], [-90, -90], [-150, -20], [-140, 90], [-90, 150], [-30, 120], [0, 60]], true)} fill={skin} />
          <path d={smoothPath([[-14, -40], [-84, -64], [-128, -12], [-120, 80], [-82, 124], [-34, 100], [-14, 50]], true)} fill={L("#c9a3a6")} opacity={0.55} />
        </g>
      </J>
    </g>
  );
};

export const Deer: React.FC<CharProps> = (p) => {
  const { ctx, t, seed, action } = p;
  const L = ctx.lit;
  const fur = L("#b5793f"), light = L("#f3e2c8"), dark = L("#2a1a10");
  const stag = rnd(seed, "stag") < 0.6;
  const fawnSpots = !stag && rnd(seed, "spots") < 0.6;
  const leap = action === "jump";
  const walking = action === "walk" || leap;
  const period = leap ? 1.0 : GAITS.walk.period * 1.1;
  // leap: airborne 55% of the cycle
  const cyc = mod(t / period, 1);
  const air = leap ? Math.max(0, Math.sin(Math.PI * Math.min(1, cyc / 0.55))) * (cyc < 0.55 ? 1 : 0) : 0;
  const lift = leap ? air * 170 : 0;
  const pitch = leap ? (cyc < 0.55 ? (0.275 - cyc) * 40 : 0) : 0;
  const legs: LegDef[] = [
    { x: -100, y: -200, l1: 106, l2: 104, w: [44, 22, 14], bend: -1, phase: TROT_PHASE.lh, near: false },
    { x: 120, y: -200, l1: 104, l2: 106, w: [30, 18, 14], bend: 1, phase: TROT_PHASE.lf, near: false },
    { x: -120, y: -202, l1: 108, l2: 104, w: [48, 24, 15], bend: -1, phase: TROT_PHASE.rh, near: true },
    { x: 100, y: -202, l1: 106, l2: 106, w: [32, 20, 15], bend: 1, phase: TROT_PHASE.rf, near: true },
  ];
  const footFn = leap
    ? (l: LegDef, f: Pt, hip: Pt): Pt => {
        const k = air;
        const ext: Pt = l.bend > 0 ? [hip[0] + 150, hip[1] + 120] : [hip[0] - 160, hip[1] + 110];
        const tuck: Pt = l.bend > 0 ? [hip[0] + 40, hip[1] + 130] : [hip[0] - 40, hip[1] + 140];
        const target: Pt = cyc < 0.2 || cyc > 0.45 ? tuck : ext;
        return [f[0] * (1 - k) + target[0] * k, f[1] * (1 - k) + (target[1] - lift * 0) * k];
      }
    : undefined;
  const { far, near, bob } = quadLegs({ ...p }, legs, { period, duty: 0.6, lift: 40 }, walking && !leap, fur, (f, _k, n) => <path d={`M${f[0] - 8},${f[1] - 12} L${f[0] + 12},${f[1] - 12} L${f[0] + 14},${f[1]} L${f[0] - 8},${f[1]}Z`} fill={n ? dark : darken(dark, 0.2)} />, footFn, leap ? -lift : undefined);
  // graze cycle: head down eating, occasionally up to look around
  const g = action === "graze" ? mod(t + rnd(seed, "gz") * 3, 4.2) : 0;
  const down = action === "graze" ? easeInOut(prog(g, 0, 0.6)) * (1 - easeInOut(prog(g, 2.6, 3.2))) : 0;
  const chew = down * Math.sin(t * 9) * 3;
  const neckA = -62 + down * 110 + (leap ? 10 : 0) + wobble(t * 0.4, seed, "n") * 4;
  const ear = Math.max(0, Math.sin(t * 1.7 + 1) - 0.8) * 150;
  const tailFlick = Math.max(0, Math.sin(t * 2.3) - 0.6) * 60;
  const neckBase: Pt = [120, -250 + bob];
  const neckLen = 150;
  const nr = (neckA * Math.PI) / 180;
  const headP: Pt = [neckBase[0] + Math.cos(nr) * neckLen, neckBase[1] + Math.sin(nr) * neckLen];
  const antler = (side: number) => (
    <g stroke={L("#d9c4a0")} strokeWidth={7} strokeLinecap="round" fill="none">
      <path d={`M${side * 6},-30 Q${side * 10 - 10},-90 ${side * 20 - 30},-130`} />
      <path d={`M${side * 6 - 4},-64 L${side * 6 + 22},-96`} />
      <path d={`M${side * 10 - 14},-96 L${side * 10 + 6},-128`} />
      <path d={`M${side * 6},-40 L${side * 6 - 30},-58`} />
    </g>
  );
  return (
    <g transform={`rotate(${pitch} 0 -200)`}>
      {far}
      <g transform={`translate(0,${bob})`}>
        <path d={smoothPath([[-150, -230], [-80, -270], [60, -266], [140, -280], [170, -240], [150, -186], [60, -170], [-60, -170], [-140, -186]], true)} fill={fur} />
        <path d={smoothPath([[140, -196], [60, -174], [-60, -174], [-120, -190], [0, -196]], true)} fill={light} />
        <J x={-150} y={-240} r={-tailFlick}>
          <ellipse cx={-8} cy={10} rx={14} ry={24} fill={light} />
          <ellipse cx={-4} cy={0} rx={10} ry={16} fill={fur} />
        </J>
        {fawnSpots ? [[-100, -240], [-60, -250], [-20, -240], [20, -252], [60, -242], [-80, -220], [-40, -226], [0, -222], [40, -228]].map(([x, y], i) => <circle key={i} cx={x} cy={y} r={6} fill={light} opacity={0.9} />) : null}
      </g>
      {/* neck */}
      <path d={smoothPath(ribbon([neckBase, [(neckBase[0] + headP[0]) / 2, (neckBase[1] + headP[1]) / 2], headP], (u) => 62 - u * 26), true, 0.8)} fill={fur} />
      {near}
      <J x={headP[0]} y={headP[1]} r={neckA + 62 + down * -10 + chew}>
        {stag ? <><g transform="translate(-10,0)" opacity={0.85}>{antler(-1)}</g>{antler(1)}</> : null}
        <J x={-24} y={-26} r={-30 - ear}>
          <ellipse cx={-20} cy={0} rx={30} ry={12} fill={fur} />
          <ellipse cx={-20} cy={0} rx={20} ry={6} fill={light} />
        </J>
        <ellipse cx={0} cy={0} rx={36} ry={30} fill={fur} />
        <path d={smoothPath([[10, -20], [70, 0], [78, 14], [60, 24], [10, 24]], true)} fill={fur} />
        <path d="M20,20 Q50,30 74,18" stroke={light} strokeWidth={6} fill="none" />
        <ellipse cx={76} cy={8} rx={8} ry={7} fill={dark} />
        <Eye x={16} y={-6} r={9} t={t} seed={seed} iris="#1a0f08" look={0.3} />
      </J>
    </g>
  );
};
