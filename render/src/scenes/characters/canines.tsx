/** Fox (trot, tail swish), wolf (howl, trot) and dog (wag, trot). Ground at y = 0, facing +x. */
import React from "react";
import { darken, lighten } from "../lib/color";
import { easeInOut, pick, prog, smoothPath, wobble, type Pt } from "../lib/math";
import { capsule, chain, ribbon } from "../lib/rig";
import { J } from "../lib/svg";
import { Eye, GAITS, quadLegs, SoundRings, TROT_PHASE, WALK_PHASE, type LegDef } from "./quad";
import type { CharProps } from "./types";

type Kind = "fox" | "wolf" | "dog";
type Look = { fur: string; light: string; dark: string; sock?: string; saddle?: string; tailTip?: string; ears: "point" | "flop"; snout: number; tailW: number; collar?: string };

const LOOKS: Record<Kind, (seed: number, color: string | null) => Look> = {
  fox: (_s, c) => ({
    fur: c === "arctic" || c === "white" || c === "snowy" ? "#eef2f6" : c === "gray" || c === "silver" ? "#9aa0aa" : "#e36a26",
    light: "#fff4e6", dark: "#2a1a12", sock: "#33211a", tailTip: "#fffaf2", ears: "point", snout: 92, tailW: 58,
  }),
  wolf: (_s, c) => ({
    fur: c === "white" || c === "snowy" || c === "arctic" ? "#e4e8ee" : c === "black" ? "#34363d" : c === "brown" ? "#7a5a42" : "#7f8796",
    light: "#e1e5ea", dark: "#22252b", saddle: "#4c525e", ears: "point", snout: 100, tailW: 44,
  }),
  dog: (s, c) => {
    const base = c === "black" ? "#2e2c2c" : c === "white" ? "#f2eee8" : c === "brown" ? "#8a5634" : pick(s, ["#d9a441", "#b87333", "#e8d2b0", "#6b4a33"], "dog");
    return { fur: base, light: lighten(base, 0.45), dark: "#2a1d15", ears: "flop", snout: 74, tailW: 20, collar: pick(s, ["#e23b3b", "#2b7de9", "#22a35a"], "collar") };
  },
};

/** 0..1 howl envelope. */
const howlEnv = (t: number, dur: number) => {
  const s0 = Math.min(dur * 0.22, 1.0), s1 = Math.min(dur - 0.5, s0 + 2.6);
  return easeInOut(prog(t, s0, s0 + 0.5)) * (1 - easeInOut(prog(t, s1, s1 + 0.5)));
};

const Canine: React.FC<CharProps & { kind: Kind }> = (p) => {
  const { ctx, t, seed, action, kind } = p;
  const L = ctx.lit;
  const look = LOOKS[kind](seed, ctx.spec.color);
  const fur = L(look.fur), light = L(look.light), dark = L(look.dark);
  const run = action === "run";
  const moving = run || action === "walk";
  const gait = run ? GAITS.trot : GAITS.walk;
  const ph = run ? TROT_PHASE : WALK_PHASE;
  const howl = action === "howl" ? howlEnv(t, ctx.dur) : 0;
  const legs: LegDef[] = [
    { x: -104, y: -176, l1: 94, l2: 90, w: [50, 28, 22], bend: -1, phase: ph.lh, near: false },
    { x: 128, y: -176, l1: 90, l2: 90, w: [38, 26, 22], bend: 1, phase: ph.lf, near: false, footDx: 4 },
    { x: -126, y: -178, l1: 96, l2: 90, w: [54, 30, 24], bend: -1, phase: ph.rh, near: true },
    { x: 106, y: -178, l1: 92, l2: 90, w: [40, 28, 24], bend: 1, phase: ph.rf, near: true, footDx: 4 },
  ];
  const sockC = look.sock ? L(look.sock) : null;
  const { far, near, bob } = quadLegs(p, legs, gait, moving, fur, (f, k, n) => (
    <g>
      {sockC ? <path d={capsule([k[0] + (f[0] - k[0]) * 0.35, k[1] + (f[1] - k[1]) * 0.35], f, 22, 21)} fill={n ? sockC : darken(sockC, 0.3)} /> : null}
      <ellipse cx={f[0] + 9} cy={f[1] - 9} rx={20} ry={10} fill={sockC ? (n ? sockC : darken(sockC, 0.3)) : n ? light : darken(light, 0.3)} />
    </g>
  ));
  // tail
  const wag = kind === "dog" ? Math.sin(t * (moving ? 14 : 18)) * 0.35 : Math.sin(t * (run ? 7 : 2.2)) * 0.12;
  const tailBase: Pt = [-150, -198 + bob];
  const tailAng = kind === "dog" ? -Math.PI * 0.7 + wag : kind === "wolf" ? Math.PI * 0.62 - howl * 0.1 : Math.PI * (run ? 0.93 : 0.8);
  const tail = chain(tailBase, tailAng, 10, kind === "dog" ? 13 : 20, (i) => (kind === "dog" ? 0.07 : kind === "wolf" ? 0.02 : -0.05) + Math.sin(t * 3 - i * 0.5) * (kind === "dog" ? 0.05 : 0.07) + (kind === "dog" ? wag * 0.12 : 0));
  const tailOutline = ribbon(tail, (u) => (kind === "dog" ? 18 - u * 10 : 16 + Math.sin(Math.PI * Math.min(1, u * 1.1)) * look.tailW - u * 6));
  const tipIdx = Math.floor(tail.length * 0.7);
  // head pose
  const nod = moving ? Math.sin((t * Math.PI * 4) / gait.period) * 3 : wobble(t * 0.5, seed, "nod") * 5;
  const headRot = nod - howl * 58;
  const hx = 172 + howl * 6, hy = -226 + bob - howl * 24;
  const jaw = howl * (16 + Math.sin(t * 5) * 3) + (kind === "dog" && run ? 10 : 0);
  const S = look.snout;
  const bodyTilt = -howl * 7;
  return (
    <g transform={`rotate(${bodyTilt} -120 -20)`}>
      {far}
      <path d={smoothPath(tailOutline, true, 0.7)} fill={fur} />
      {look.tailTip ? <path d={smoothPath(ribbon(tail.slice(tipIdx), (u) => 30 + Math.sin(Math.PI * (0.7 + u * 0.3)) * 60 * (1 - u)), true, 0.7)} fill={L(look.tailTip)} /> : null}
      {look.saddle ? <path d={smoothPath(ribbon(tail.slice(0, 5), () => 20), true, 0.7)} fill={L(look.saddle)} opacity={0.6} /> : null}
      <g transform={`translate(0,${bob})`}>
        <path d={smoothPath([[-160, -196], [-110, -236], [10, -226], [120, -246], [175, -220], [182, -160], [120, -130], [10, -128], [-100, -128], [-162, -150]], true)} fill={fur} />
        <path d={smoothPath([[180, -190], [150, -140], [100, -128], [0, -132], [-90, -134], [0, -150], [120, -160]], true)} fill={light} opacity={0.9} />
        {look.saddle ? <path d={smoothPath([[-140, -222], [-60, -238], [60, -236], [120, -244], [60, -212], [-60, -208]], true)} fill={L(look.saddle)} opacity={0.85} /> : null}
        <path d="M-150,-214 Q-80,-246 20,-232 Q80,-228 130,-248" stroke={lighten(fur, 0.25)} strokeWidth={7} fill="none" strokeLinecap="round" opacity={0.5} />
        {look.collar ? <path d="M120,-236 Q150,-200 170,-160" stroke={L(look.collar)} strokeWidth={16} fill="none" strokeLinecap="round" /> : null}
      </g>
      {near}
      <J x={hx} y={hy} r={headRot}>
        {look.ears === "point" ? (
          <>
            <path d={`M-30,-30 L-30,-${96 + howl * 0} L6,-40Z`} fill={darken(fur, 0.2)} />
            <path d={`M-6,-34 L6,-${104 - howl * 10} L34,-34Z`} fill={fur} />
            <path d="M2,-40 L8,-88 L24,-40Z" fill={dark} opacity={0.75} />
          </>
        ) : null}
        <ellipse cx={0} cy={0} rx={52} ry={46} fill={fur} />
        <path d={smoothPath([[10, -30], [S * 0.6, -18], [S, -6], [S + 8, 8], [S - 6, 20], [S * 0.5, 26], [10, 30]], true, 0.8)} fill={fur} />
        <path d={smoothPath([[-10, 12], [S * 0.5, 18], [S - 8, 20], [S * 0.5, 34], [0, 40]], true, 0.8)} fill={light} />
        {kind === "fox" ? <path d="M-40,6 Q-10,40 30,34 Q10,20 -40,6Z" fill={light} /> : null}
        <J x={S * 0.3} y={24} r={jaw}>
          <path d={`M-10,0 Q${S * 0.4},-4 ${S * 0.72},0 Q${S * 0.5},16 0,14Z`} fill={light} />
          {kind === "dog" && run ? <path d={`M${S * 0.3},2 Q${S * 0.36},34 ${S * 0.52},30 Q${S * 0.6},10 ${S * 0.55},2Z`} fill="#e86a7a" /> : null}
        </J>
        {jaw > 3 ? <path d={`M${S * 0.3},24 L${S * 0.95},${22 - jaw * 0.2} L${S * 0.9},${26 + jaw * 0.7}Z`} fill="#4a1414" /> : null}
        <ellipse cx={S + 4} cy={4} rx={12} ry={10} fill={dark} />
        <path d={`M-4,-${22 + howl * 4} Q14,-${32 + howl * 4} 30,-24`} stroke={darken(fur, 0.45)} strokeWidth={4} fill="none" strokeLinecap="round" />
        <Eye x={18} y={-10} r={howl > 0.5 ? 7 : 10} t={howl > 0.5 ? 0.08 : t} seed={seed} iris={kind === "wolf" ? "#e0b030" : "#3a2210"} look={0.35} />
        {look.ears === "flop" ? (
          <J x={-20} y={-28} r={20 + Math.sin(t * (moving ? 10 : 2)) * (moving ? 14 : 4)}>
            <path d="M-10,0 Q-26,24 -18,62 Q-4,72 8,56 Q12,24 10,0Z" fill={darken(fur, 0.3)} />
          </J>
        ) : null}
      </J>
      <SoundRings x={hx + 60} y={hy - 90} ang={-1.25} t={t} on={howl} color="#e8f0ff" size={1} />
    </g>
  );
};

export const Fox: React.FC<CharProps> = (p) => <Canine {...p} kind="fox" />;
export const Wolf: React.FC<CharProps> = (p) => <Canine {...p} kind="wolf" />;
export const Dog: React.FC<CharProps> = (p) => <Canine {...p} kind="dog" />;
