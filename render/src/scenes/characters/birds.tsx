/** Owl (perched: blink, head turn, wing flap), eagle (flight wing cycle), penguin (waddle). */
import React from "react";
import { darken, lighten } from "../lib/color";
import { blink, clamp, easeInOut, mod, pick, prog, rnd, smoothPath, wobble } from "../lib/math";
import { J } from "../lib/svg";
import { Eye } from "./quad";
import type { CharProps } from "./types";

/** Owl perched on a branch; feet at (0,0). The branch comes in from the left. */
export const Owl: React.FC<CharProps> = (p) => {
  const { ctx, t, seed, action } = p;
  const L = ctx.lit;
  const snowyOwl = ctx.spec.color === "white" || ctx.spec.color === "snowy";
  const body = L(snowyOwl ? "#f2f0ea" : "#8a5d3b"), belly = L(snowyOwl ? "#ffffff" : "#e9d4b0"), dark = L(snowyOwl ? "#9a9a9a" : "#5a3a22"), face = L(snowyOwl ? "#ffffff" : "#f3e3c6");
  const bark = L("#5b3b28"), barkLight = L("#7a5236");
  // head turn: look left / centre / right, snapping with ease
  const slot = Math.floor((t + rnd(seed, "ht") * 2) / 1.6);
  const target = [0, 1, 0, -1, 0.6, 0][slot % 6]! * (rnd(seed, "ht", slot) < 0.3 ? 0 : 1);
  const prev = [0, 1, 0, -1, 0.6, 0][(slot + 5) % 6]!;
  const u = easeInOut(prog(mod(t + rnd(seed, "ht") * 2, 1.6), 0, 0.35));
  const turn = prev + (target - prev) * u;
  const tilt = wobble(t * 0.7, seed, "tilt") * 6 + (Math.sin(t * 0.9) > 0.9 ? 14 : 0);
  // wing flap bursts
  const flapping = action === "flap" || action === "fly";
  const fcyc = mod(t, 3.2);
  const flapAmt = flapping ? 1 : fcyc > 2.2 && fcyc < 2.9 ? Math.sin(((fcyc - 2.2) / 0.7) * Math.PI) : 0;
  const flapA = flapAmt * (40 + Math.sin(t * 22) * 35);
  const o = Math.max(0.06, blink(t, seed, "owl"));
  const breathe = Math.sin(t * 2) * 3;
  const eyeX = 42, eyeY = -270;
  const leaves = [-420, -300, -160, 190].map((x, i) => (
    <g key={i} transform={`translate(${x},${-8}) rotate(${-30 + i * 25 + Math.sin(t * 1.5 + i) * 8})`}>
      <path d="M0,0 Q20,-24 50,-8 Q24,10 0,0Z" fill={L("#3e7a45")} />
      <path d="M0,0 Q24,-4 50,-8" stroke={L("#2c5a33")} strokeWidth={2} fill="none" />
    </g>
  ));
  const wing = (side: number) => (
    <J x={side * 92} y={-210} r={-side * flapA}>
      <path d={smoothPath([[0, -30], [side * 40, 20], [side * 36, 120], [side * 10, 170], [side * -14, 110], [side * -10, 10]], true)} fill={dark} />
      {[0, 1, 2].map((i) => <path key={i} d={`M${side * (8 + i * 8)},${60 + i * 30} q${side * 14},10 ${side * 20},30`} stroke={darken(dark, 0.3)} strokeWidth={4} fill="none" />)}
    </J>
  );
  return (
    <g>
      {/* branch */}
      <path d="M-900,-10 Q-300,-30 0,-4 Q140,6 260,-30 L262,-6 Q140,26 0,18 Q-300,10 -900,30Z" fill={bark} />
      <path d="M-900,-6 Q-300,-26 0,0" stroke={barkLight} strokeWidth={6} fill="none" opacity={0.7} />
      <path d="M120,0 Q170,-60 230,-90" stroke={bark} strokeWidth={12} fill="none" strokeLinecap="round" />
      {leaves}
      <g transform={`scale(1,${1 + breathe * 0.004})`}>
        {wing(-1)}
        {wing(1)}
        <path d={smoothPath([[0, -330], [100, -280], [112, -140], [80, -30], [0, -8], [-80, -30], [-112, -140], [-100, -280]], true)} fill={body} />
        <path d={smoothPath([[0, -220], [70, -170], [74, -80], [40, -24], [0, -14], [-40, -24], [-74, -80], [-70, -170]], true)} fill={belly} />
        {[[-30, -150], [10, -160], [45, -140], [-45, -110], [-10, -118], [28, -104], [-22, -72], [18, -66]].map(([x, y], i) => (
          <path key={i} d={`M${x! - 9},${y} l9,9 l9,-9`} stroke={dark} strokeWidth={4} fill="none" strokeLinecap="round" strokeLinejoin="round" />
        ))}
      </g>
      {/* feet */}
      {[-30, 30].map((x) => <path key={x} d={`M${x - 20},2 l6,-18 M${x},4 l0,-20 M${x + 20},2 l-6,-18`} stroke={L("#e0a030")} strokeWidth={8} strokeLinecap="round" />)}
      {/* head */}
      <J x={0} y={-10 + breathe * 0.6} r={tilt}>
        <g>
          <path d={`M${-86 + turn * 10},-330 L${-104 + turn * 10},-392 L${-50 + turn * 10},-346Z`} fill={dark} />
          <path d={`M${86 + turn * 10},-330 L${104 + turn * 10},-392 L${50 + turn * 10},-346Z`} fill={dark} />
          <ellipse cx={0} cy={-290} rx={104} ry={82} fill={body} />
          <g transform={`translate(${turn * 26},0)`}>
            <circle cx={-eyeX} cy={eyeY} r={52 * (1 - Math.max(0, turn) * 0.18)} fill={face} />
            <circle cx={eyeX} cy={eyeY} r={52 * (1 + Math.min(0, turn) * 0.18)} fill={face} />
            {[-1, 1].map((side) => (
              <g key={side} transform={`translate(${side * eyeX},${eyeY})`}>
                <circle r={34} fill={L("#ffb52e")} />
                <circle r={20} fill="#140d08" />
                <circle cx={-7} cy={-8} r={7} fill="#fff" />
                {/* eyelid */}
                <path d={`M-38,-38 L38,-38 L38,${-38 + 76 * (1 - o)} Q0,${-30 + 80 * (1 - o)} -38,${-38 + 76 * (1 - o)}Z`} fill={body} />
                <path d={`M-36,-4 Q0,${-40 + 44 * o} 36,-4`} stroke={dark} strokeWidth={4} fill="none" opacity={0.6} />
              </g>
            ))}
            <path d="M-12,-238 L12,-238 L0,-206Z" fill={L("#e6a02a")} />
            <path d="M-62,-316 Q-40,-332 -8,-300 M62,-316 Q40,-332 8,-300" stroke={dark} strokeWidth={6} fill="none" strokeLinecap="round" />
          </g>
        </g>
      </J>
    </g>
  );
};

/** Eagle in flight, body centre (0,0), facing +x. Flap bursts then glides. */
export const Eagle: React.FC<CharProps> = (p) => {
  const { ctx, t, seed } = p;
  const L = ctx.lit;
  const bird = ctx.spec.color;
  const bodyC = L(bird === "white" ? "#ecebe6" : bird === "black" ? "#26262c" : "#4a3222"), head = L(bird === "black" ? "#26262c" : "#f6f3ec"), beak = L("#f2b233"), wingC = L(bird === "white" ? "#dcdad2" : bird === "black" ? "#1d1d22" : "#3d2a1c");
  const cyc = mod(t + rnd(seed, "fl") * 3, 3.6);
  const ph = t * Math.PI * 2 * 1.5;
  // blend between flapping and a raised-wing glide so there is no pop
  const glide = easeInOut(prog(cyc, 1.8, 2.3)) * (1 - easeInOut(prog(cyc, 3.2, 3.6)));
  const flapping = glide < 0.5;
  const flap = Math.sin(ph) * (1 - glide) + (0.62 + Math.sin(t * 2) * 0.05) * glide;
  const glideBank = flapping ? 0 : Math.sin((cyc - 2) * 1.5) * 4;
  const bodyBob = flapping ? -Math.sin(ph - 0.8) * 14 : Math.sin(t * 1.5) * 6;
  const wing = (near: boolean) => {
    const sy = near ? flap : flap * 0.8;
    const c = near ? wingC : darken(wingC, 0.25);
    // wing drawn pointing "up" (-y); scaled by flap to fake foreshortening
    const tip = [0, 1, 2, 3, 4].map((i) => {
      const x = -60 + i * 24;
      return `L${x - 16},${-300 - (i === 2 ? 20 : i * 4)} Q${x - 4},${-318} ${x + 6},${-296}`;
    }).join(" ");
    return (
      <g transform={`translate(${near ? 20 : 40},${near ? -10 : -26}) rotate(${(-glide * (near ? 58 : 48)).toFixed(2)}) scale(1,${(sy * (1 - glide) + glide * (near ? 0.95 : 0.8)).toFixed(3)}) skewX(${(-flap * 12 * (1 - glide)).toFixed(2)})`}>
        <path d={`M-60,0 Q-110,-110 -90,-250 ${tip} L60,-240 Q80,-120 60,0Z`} fill={c} />
        <path d="M-40,-20 Q-70,-110 -50,-180 L50,-170 Q64,-90 44,-20Z" fill={lighten(c, 0.12)} opacity={0.7} />
        {[0, 1, 2, 3].map((i) => <path key={i} d={`M${-70 + i * 30},-190 L${-60 + i * 30},-250`} stroke={darken(c, 0.35)} strokeWidth={4} strokeLinecap="round" opacity={0.7} />)}
      </g>
    );
  };
  return (
    <g transform={`translate(0,${bodyBob}) rotate(${glideBank + (flapping ? Math.sin(ph) * 2 : 0)})`}>
      {wing(false)}
      {/* tail fan */}
      <path d="M-120,-6 L-250,-40 Q-262,0 -250,34 L-120,14Z" fill={L(bird === "black" ? "#26262c" : "#f4f1ea")} />
      {[-24, -8, 8, 24].map((y) => <path key={y} d={`M-130,4 L-250,${y}`} stroke={L("#c8c2b4")} strokeWidth={2} opacity={0.6} />)}
      {/* body */}
      <path d={smoothPath([[-140, -10], [-60, -40], [60, -44], [130, -30], [150, 0], [110, 30], [0, 40], [-110, 20]], true)} fill={bodyC} />
      {/* legs tucked */}
      <path d="M-40,30 Q-80,52 -110,44" stroke={L("#f2b233")} strokeWidth={12} strokeLinecap="round" fill="none" />
      {/* head */}
      <g transform={`translate(140,-26) rotate(${wobble(t * 0.8, seed, "hd") * 6})`}>
        <path d={smoothPath([[-50, -10], [-10, -44], [40, -34], [62, -8], [40, 22], [-30, 34], [-60, 20]], true)} fill={head} />
        <path d="M50,-22 Q92,-22 100,4 Q96,18 84,14 Q86,2 70,0 L52,6Z" fill={beak} />
        <path d="M84,14 Q88,24 80,26" stroke={darken(beak, 0.4)} strokeWidth={3} fill="none" />
        <Eye x={30} y={-14} r={8} t={t} seed={seed} iris="#e0a020" look={0.4} />
        <path d="M16,-26 Q34,-32 48,-22" stroke={L("#8a8378")} strokeWidth={5} fill="none" strokeLinecap="round" />
      </g>
      {wing(true)}
    </g>
  );
};

/** Penguin, feet at (0,0), waddling. */
export const Penguin: React.FC<CharProps> = (p) => {
  const { ctx, t, seed, action } = p;
  const L = ctx.lit;
  const black = L("#1f2430"), white = L("#f8f8f4"), orange = L("#f59a23"), yellow = L("#ffd35a");
  const moving = action === "walk" || action === "run";
  const hop = action === "jump";
  const f = moving ? 3.2 : 0;
  const waddle = moving ? Math.sin(t * f * Math.PI) * 9 : wobble(t * 0.8, seed, "w") * 3;
  const stepL = moving ? Math.max(0, Math.sin(t * f * Math.PI)) * 22 : 0;
  const stepR = moving ? Math.max(0, -Math.sin(t * f * Math.PI)) * 22 : 0;
  const jump = hop ? Math.max(0, Math.sin(mod(t, 1.1) / 1.1 * Math.PI * 2)) * 90 : 0;
  const flip = moving ? 22 + Math.sin(t * f * Math.PI * 2) * 14 : 12 + Math.sin(t * 2) * 5 + (hop ? jump * 0.4 : 0);
  const look = pick(seed, [0.3, 0.4], "look");
  return (
    <g transform={`translate(0,${-jump}) rotate(${waddle} 0 0)`}>
      <ellipse cx={-26} cy={-6 + stepL * -0.5} rx={30} ry={12} fill={orange} transform={`translate(0,${-stepL})`} />
      <ellipse cx={34} cy={-6} rx={30} ry={12} fill={orange} transform={`translate(0,${-stepR})`} />
      <J x={-70} y={-230} r={flip}>
        <path d="M0,0 Q-40,60 -24,150 Q-8,160 10,120 Q18,50 10,0Z" fill={darken(black, 0.2)} />
      </J>
      <path d={smoothPath([[10, -380], [90, -330], [100, -170], [80, -40], [10, -12], [-70, -40], [-94, -170], [-80, -320]], true)} fill={black} />
      <path d={smoothPath([[40, -300], [84, -220], [80, -80], [40, -24], [-20, -26], [-50, -80], [-40, -200], [10, -290]], true)} fill={white} />
      <path d="M40,-300 Q70,-290 80,-260 Q60,-270 44,-262Z" fill={yellow} opacity={0.9} />
      <g transform={`translate(0,${clamp(jump, 0, 1) * 0})`}>
        <path d="M60,-330 L128,-312 L62,-300Z" fill={orange} />
        <circle cx={42} cy={-338} r={14} fill={white} />
        <Eye x={44} y={-338} r={8} t={t} seed={seed} iris="#111" look={look} />
      </g>
      <J x={62} y={-220} r={-flip}>
        <path d="M0,0 Q40,60 26,150 Q8,160 -6,120 Q-14,50 -6,0Z" fill={black} />
      </J>
    </g>
  );
};
