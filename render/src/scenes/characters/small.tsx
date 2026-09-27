/** Rabbit (hop cycle, nose twitch) and butterfly (flutter along a wandering path). */
import React from "react";
import { darken, lighten } from "../lib/color";
import { mod, pick, rnd, smoothPath, wobble } from "../lib/math";
import { J } from "../lib/svg";
import { Eye } from "./quad";
import type { CharProps } from "./types";

/** Rabbit, feet at (0,0), facing +x. */
export const Rabbit: React.FC<CharProps> = (p) => {
  const { ctx, t, seed, action } = p;
  const L = ctx.lit;
  const c = ctx.spec.color;
  const base = c === "white" || c === "snowy" ? "#f4f2ee" : c === "brown" ? "#8d6445" : c === "black" ? "#34302e" : pick(seed, ["#b59a80", "#9c8b7c", "#c8ae8e"], "rab");
  const fur = L(base), light = L(lighten(base, 0.5)), pink = L("#f2a3a8"), dark = L("#2a1c14");
  const hopping = action === "jump" || action === "run" || action === "walk";
  const P = 0.62;
  const u = hopping ? mod(t / P, 1) : 0;
  // 0-0.2 crouch, 0.2-0.75 air, 0.75-1 land/squash
  const air = u > 0.2 && u < 0.75 ? Math.sin(((u - 0.2) / 0.55) * Math.PI) : 0;
  const crouch = hopping ? (u < 0.2 ? Math.sin((u / 0.2) * Math.PI * 0.5) : u > 0.75 ? Math.sin(((1 - u) / 0.25) * Math.PI * 0.5) : 0) : 0;
  const y = -air * 120;
  const stretch = 1 + air * 0.18 - crouch * 0.12;
  const pitch = hopping ? (u > 0.2 && u < 0.75 ? (0.47 - u) * -50 : 0) : 0;
  const legExt = air; // hind legs extend back in air
  const twitch = Math.sin(t * 18) * (Math.sin(t * 1.3) > 0.3 ? 1 : 0);
  const earSw = hopping ? -air * 30 + crouch * 15 : wobble(t * 0.8, seed, "ear") * 8;
  return (
    <g transform={`translate(0,${y}) rotate(${pitch} 0 -60)`}>
      {/* hind leg */}
      <J x={-50} y={-50} r={-legExt * 60}>
        <ellipse cx={0} cy={0} rx={56} ry={46} fill={fur} />
        <path d={`M-30,36 Q10,${50 - legExt * 10} ${60 + legExt * -80},${46 + legExt * 20}`} stroke={fur} strokeWidth={24} strokeLinecap="round" fill="none" />
      </J>
      <g transform={`translate(0,-60) scale(${stretch},${2 - stretch}) translate(0,60)`}>
        <path d={smoothPath([[-110, -80], [-60, -150], [30, -160], [90, -120], [100, -60], [50, -20], [-40, -14], [-100, -40]], true)} fill={fur} />
        <path d={smoothPath([[80, -70], [40, -30], [-30, -26], [0, -60]], true)} fill={light} opacity={0.8} />
        <circle cx={-110} cy={-90} r={24} fill={light} />
      </g>
      {/* front paws */}
      <path d={`M60,-40 L${70 + air * 30},${-4 - air * 10}`} stroke={fur} strokeWidth={18} strokeLinecap="round" />
      <J x={100} y={-140 - crouch * -10}>
        <J x={-18} y={-40} r={-20 + earSw + twitch * 2}>
          <path d="M0,0 Q-24,-90 -6,-150 Q16,-160 22,-100 Q20,-40 14,0Z" fill={darken(fur, 0.12)} />
        </J>
        <J x={4} y={-42} r={-6 + earSw * 0.8}>
          <path d="M0,0 Q-20,-96 0,-160 Q24,-166 28,-100 Q24,-40 18,0Z" fill={fur} />
          <path d="M6,-14 Q-6,-90 6,-140 Q18,-140 20,-96 Q18,-40 14,-14Z" fill={pink} />
        </J>
        <ellipse cx={0} cy={0} rx={52} ry={46} fill={fur} />
        <ellipse cx={40} cy={16} rx={18} ry={14} fill={light} />
        <ellipse cx={50} cy={6 + twitch} rx={7} ry={5} fill={pink} />
        <path d="M50,12 L50,20 Q44,26 38,24 M50,20 Q56,26 62,24" stroke={dark} strokeWidth={2.5} fill="none" strokeLinecap="round" />
        <Eye x={20} y={-12} r={10} t={t} seed={seed} iris="#2a1a10" look={0.35} />
      </J>
    </g>
  );
};

const WING_STYLES = [
  { a: "#ff8a1f", b: "#1d1712", spot: "#ffffff" }, // monarch
  { a: "#2f7dff", b: "#0d1f4a", spot: "#9fe7ff" }, // morpho
  { a: "#ffd23f", b: "#2b2118", spot: "#ff6b3d" }, // swallowtail
  { a: "#ff5fa2", b: "#4a1034", spot: "#ffe0ef" },
];

/** Butterfly centred at (0,0), flutters and wanders around its anchor. */
export const Butterfly: React.FC<CharProps> = (p) => {
  const { ctx, t, seed } = p;
  const L = ctx.lit;
  const st = WING_STYLES[Math.floor(rnd(seed, "wing") * WING_STYLES.length)]!;
  const flap = Math.abs(Math.cos(t * Math.PI * 7 + rnd(seed, "ph") * 6)); // 1 open, 0 closed
  const sx = 0.15 + flap * 0.85;
  const wx = wobble(t * 0.7, seed, "wx") * 170;
  const wy = wobble(t * 0.9, seed, "wy") * 110 - Math.abs(Math.sin(t * 7)) * 12;
  const tilt = wobble(t * 0.6, seed, "tl") * 18 + 10;
  const wingUp = (side: number) => (
    <g transform={`scale(${side * sx},1)`}>
      <path d={smoothPath([[4, -6], [60, -90], [130, -110], [150, -60], [110, -10], [20, 6]], true)} fill={L(st.b)} />
      <path d={smoothPath([[10, -12], [60, -80], [118, -96], [134, -60], [100, -20], [24, -2]], true)} fill={L(st.a)} />
      <circle cx={120} cy={-80} r={8} fill={L(st.spot)} />
      <circle cx={100} cy={-94} r={5} fill={L(st.spot)} />
      <path d={smoothPath([[4, 4], [80, 10], [110, 60], [70, 110], [24, 70]], true)} fill={L(st.b)} />
      <path d={smoothPath([[12, 10], [74, 18], [96, 58], [64, 96], [26, 62]], true)} fill={lighten(L(st.a), 0.1)} />
      <circle cx={70} cy={80} r={6} fill={L(st.spot)} />
    </g>
  );
  return (
    <g transform={`translate(${wx},${wy}) rotate(${tilt})`}>
      {wingUp(-1)}
      {wingUp(1)}
      <ellipse cx={0} cy={10} rx={10} ry={52} fill={L("#1c1510")} />
      <circle cx={0} cy={-48} r={12} fill={L("#1c1510")} />
      <path d={`M-4,-56 Q-24,-100 -30,-110 M4,-56 Q24,-100 30,-110`} stroke={L("#1c1510")} strokeWidth={3} fill="none" />
      <circle cx={-30} cy={-110} r={5} fill={L("#1c1510")} />
      <circle cx={30} cy={-110} r={5} fill={L("#1c1510")} />
    </g>
  );
};
