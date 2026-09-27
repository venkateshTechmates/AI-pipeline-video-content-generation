/**
 * Original caped superhero / heroine. Front view for hover / land / zap / idle,
 * profile for flight. Feet at (0,0) in the front view; body centre at (0,0) when flying.
 */
import React from "react";
import { darken, lighten } from "../lib/color";
import { blink, clamp, easeIn, easeOut, pick, prog, smoothPath, wobble, type Pt } from "../lib/math";
import { Glow, J, limbPath } from "../lib/svg";
import { Arc, EnergyBall, Sparks } from "../effects/energy";
import { landImpactTime } from "../camera";
import type { CharProps } from "./types";

const SUITS = [
  { suit: "#2a5bd7", accent: "#e23b3b", cape: "#d62d3a", emblem: "#ffd23f" },
  { suit: "#1f2433", accent: "#f5b301", cape: "#a8141f", emblem: "#f5b301" },
  { suit: "#0f7a70", accent: "#f59e0b", cape: "#6d3ad6", emblem: "#fde68a" },
  { suit: "#6b3fd4", accent: "#22c3e6", cape: "#10698a", emblem: "#a5f3fc" },
  { suit: "#b3202a", accent: "#fbbf24", cape: "#1e3a8a", emblem: "#fbbf24" },
  { suit: "#eef2f7", accent: "#2563eb", cape: "#1d4ed8", emblem: "#2563eb" },
  { suit: "#16a34a", accent: "#111827", cape: "#111827", emblem: "#bbf7d0" },
];
const SKINS = ["#f3cfb0", "#e7b48a", "#c98c5a", "#9a6038", "#6b4125", "#ffe0c2"];
const HAIRS = ["#1b1712", "#3b2414", "#6b3b1c", "#c9923e", "#8b2c14", "#e7d3a1"];
const ENERGY = ["#8fe3ff", "#ffd76a", "#b69cff", "#7dffb4"];

const COLOR_WORD: Record<string, number> = { blue: 0, black: 1, gold: 1, green: 6, teal: 2, purple: 3, violet: 3, red: 4, crimson: 4, white: 5, silver: 5 };

export const heroLook = (p: CharProps) => {
  const s = p.seed;
  const hint = p.ctx.spec.color;
  const suitIdx = hint && COLOR_WORD[hint] !== undefined ? COLOR_WORD[hint]! : Math.floor((((s * 2654435761) >>> 0) % 1000) / 1000 * SUITS.length);
  const kit = SUITS[suitIdx]!;
  return {
    ...kit,
    skin: pick(s, SKINS, "skin"),
    hair: pick(s, HAIRS, "hair"),
    energy: p.ctx.spec.effects.includes("sparks") ? "#8fe3ff" : pick(s, ENERGY, "energy"),
    mask: pick(s, [true, false, true], "mask"),
    female: p.ctx.spec.character === "heroine",
  };
};
type Look = ReturnType<typeof heroLook>;

/** Emblem: an original shield with a star-burst. */
const Emblem: React.FC<{ x: number; y: number; s: number; look: Look; lit: (c: string) => string; glow: number }> = ({ x, y, s, look, lit, glow }) => (
  <g transform={`translate(${x},${y}) scale(${s})`}>
    {glow > 0 ? <Glow cx={0} cy={0} r={60} color={look.energy} opacity={glow * 0.7} /> : null}
    <path d="M0,-26 L24,-14 L18,14 L0,26 L-18,14 L-24,-14Z" fill={lit(look.accent)} />
    <path d="M0,-18 L5,-5 L18,-4 L8,5 L11,18 L0,10 L-11,18 L-8,5 L-18,-4 L-5,-5Z" fill={glow > 0.3 ? "#ffffff" : lit(look.emblem)} />
  </g>
);

const Head: React.FC<{ look: Look; lit: (c: string) => string; t: number; seed: number; tilt: number; mouth?: number }> = ({ look, lit, t, seed, tilt, mouth = 0 }) => {
  const skin = lit(look.skin);
  const hair = lit(look.hair);
  const eye = blink(t, seed);
  const hairSway = wobble(t * 1.4, seed, "hair") * 6;
  return (
    <J y={-470} r={tilt}>
      {/* long hair behind (heroine) */}
      {look.female ? (
        <path
          d={smoothPath([[-34, -60], [34, -60], [44 + hairSway * 0.4, 10], [50 + hairSway, 70], [20 + hairSway, 86], [0, 60], [-20 + hairSway, 86], [-50 + hairSway, 70], [-44 + hairSway * 0.4, 10]])}
          fill={darken(hair, 0.12)}
        />
      ) : null}
      <rect x={-13} y={-12} width={26} height={24} fill={darken(skin, 0.12)} />
      <ellipse cx={0} cy={-48} rx={33} ry={40} fill={skin} />
      <ellipse cx={-33} cy={-44} rx={6} ry={10} fill={darken(skin, 0.08)} />
      <ellipse cx={33} cy={-44} rx={6} ry={10} fill={darken(skin, 0.08)} />
      {/* jaw shading */}
      <path d="M-30,-40 Q-26,-8 0,-8 Q26,-8 30,-40 Q20,-18 0,-16 Q-20,-18 -30,-40Z" fill={darken(skin, 0.1)} opacity={0.6} />
      {look.mask ? <path d="M-34,-60 Q-18,-70 0,-62 Q18,-70 34,-60 L32,-44 Q18,-38 6,-46 L0,-44 L-6,-46 Q-18,-38 -32,-44Z" fill={lit(look.accent)} /> : null}
      {/* eyes */}
      <g transform={`translate(0,-53) scale(1,${Math.max(0.08, eye)})`}>
        <ellipse cx={-13} cy={0} rx={7.5} ry={5.5} fill="#ffffff" />
        <ellipse cx={13} cy={0} rx={7.5} ry={5.5} fill="#ffffff" />
        <circle cx={-12} cy={0.5} r={3.8} fill="#1b2230" />
        <circle cx={14} cy={0.5} r={3.8} fill="#1b2230" />
        <circle cx={-10.8} cy={-1} r={1.3} fill="#fff" />
        <circle cx={15.2} cy={-1} r={1.3} fill="#fff" />
      </g>
      <path d="M-22,-66 Q-13,-71 -4,-66" stroke={hair} strokeWidth={4} fill="none" strokeLinecap="round" />
      <path d="M22,-66 Q13,-71 4,-66" stroke={hair} strokeWidth={4} fill="none" strokeLinecap="round" />
      <path d="M0,-50 L-4,-36 L3,-35" stroke={darken(skin, 0.25)} strokeWidth={2.5} fill="none" strokeLinecap="round" />
      {mouth > 0.05 ? (
        <ellipse cx={0} cy={-24} rx={9} ry={3 + mouth * 7} fill="#5a1d1d" />
      ) : (
        <path d="M-9,-25 Q0,-19 9,-25" stroke="#7a2e2e" strokeWidth={3} fill="none" strokeLinecap="round" />
      )}
      {/* hair on top */}
      {look.female ? (
        <path d={`M-37,-44 Q-42,-96 0,-94 Q42,-96 37,-44 Q30,-72 10,-76 Q-8,-66 -22,-72 Q-32,-64 -37,-44Z`} fill={hair} />
      ) : (
        <path d={`M-35,-52 Q-40,-92 -6,-94 Q30,-98 38,-70 Q40,-58 35,-50 Q30,-70 16,-74 Q${2 + hairSway * 0.3},-66 -10,-76 Q-26,-70 -35,-52Z`} fill={hair} />
      )}
      <path d="M-20,-88 Q0,-96 18,-88" stroke={lighten(hair, 0.25)} strokeWidth={4} fill="none" opacity={0.6} strokeLinecap="round" />
    </J>
  );
};

type FrontPose = {
  armL: [number, number]; armR: [number, number]; legL: [number, number]; legR: [number, number];
  crouch: number; capeLift: number; tilt: number; handGlow: number; zap: number;
};

/** Front view: hover / land / zap / idle. */
const HeroFront: React.FC<CharProps> = (p) => {
  const { ctx, t, seed, action } = p;
  const look = heroLook(p);
  const lit = (c: string) => ctx.lit(c);
  const suit = lit(look.suit), acc = lit(look.accent), cape = lit(look.cape), skin = lit(look.skin);
  const capeIn = darken(cape, 0.35);
  const breathe = Math.sin(t * 2.2) * 3;
  const glowing = ctx.spec.effects.includes("aura") || ctx.spec.effects.includes("sparks") || action === "zap";

  // ---- pose by action
  let pose: FrontPose = { armL: [14, 12], armR: [14, 12], legL: [5, -3], legR: [4, 10], crouch: 0, capeLift: 0, tilt: 0, handGlow: glowing ? 0.8 : 0, zap: 0 };
  const sw = wobble(t * 1.2, seed, "sw");
  if (action === "hover" || action === "idle" || action === "fly") {
    pose = { ...pose, armL: [18 + sw * 4, 14 + sw * 6], armR: [20 - sw * 4, 12 - sw * 5], legL: [4, -2], legR: [2 + sw, 16 + sw * 5], tilt: sw * 3 };
  } else if (action === "zap") {
    const up = easeOut(prog(t, 0.2, 1.1));
    pose = {
      ...pose,
      armL: [18 + 62 * up + sw * 3, 12 + 38 * up], armR: [18 + 62 * up - sw * 3, 12 + 38 * up],
      legL: [9, -3], legR: [9, 3], tilt: -3 * up, handGlow: 0.5 + up * 0.8, zap: up,
    };
  } else if (action === "land") {
    const ti = landImpactTime(ctx.dur);
    const imp = prog(t, ti, ti + 0.25), rec = prog(t, ti + 0.45, ti + 1.3);
    const cr = t < ti ? 0 : easeOut(imp) * (1 - easeOut(rec) * 0.85);
    const pre = t < ti ? 1 : 1 - easeOut(imp);
    pose = {
      ...pose,
      armL: [40 * pre + 30 * cr + 12, 20 * pre + 40 * cr + 8], armR: [44 * pre + 22 * cr + 12, 24 * pre + 30 * cr + 8],
      legL: [8 + 24 * cr, -6 - 50 * cr], legR: [8 + 20 * cr, 8 + 40 * cr + 10 * pre],
      crouch: cr, capeLift: pre * (t < ti ? 1 : 0), tilt: 0,
    };
  }
  const crouchY = pose.crouch * 70;

  // ---- cape (behind)
  const capeW = 150;
  const capeBottom = -40 - pose.capeLift * 260 + crouchY * 0.8;
  const capeWave = (i: number) => Math.sin(t * 3.2 + i * 1.3) * (14 + pose.capeLift * 30) + wobble(t, seed, `c${i}`) * 10;
  const capePts: Pt[] = [[-62, -455 + crouchY], [62, -455 + crouchY]];
  const N = 6;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const x = capeW + 20 * Math.sin(t * 1.3) - u * (capeW * 2 + 20 * Math.sin(t * 1.1 + 1));
    capePts.push([x + capeWave(i) * 0.5, capeBottom + capeWave(i + 3) + Math.sin(u * Math.PI) * 18]);
  }
  const capeD = smoothPath(capePts, true, 0.9);

  const leg = (side: -1 | 1, a: [number, number]) => (
    <J x={side * 24} y={-272 + crouchY} r={-side * a[0]}>
      <path d={limbPath(145, 56, 40)} fill={suit} />
      <J y={138} r={-side * a[1]}>
        <path d={limbPath(150 - pose.crouch * 20, 40, 30)} fill={suit} />
        <path d={`M-21,60 L21,60 L16,${150 - pose.crouch * 20} L-16,${150 - pose.crouch * 20}Z`} fill={acc} />
        <J y={150 - pose.crouch * 20}>
          <ellipse cx={0} cy={6} rx={17} ry={24} fill={darken(acc, 0.1)} />
        </J>
      </J>
    </J>
  );
  const arm = (side: -1 | 1, a: [number, number], front: boolean) => (
    <J x={side * 70} y={-440 + crouchY + breathe * 0.5} r={-side * a[0]}>
      <path d={limbPath(118, 40, 30)} fill={suit} />
      {front ? <path d="M-8,10 Q-2,50 -6,90" stroke={lighten(suit, 0.18)} strokeWidth={6} fill="none" strokeLinecap="round" opacity={0.6} /> : null}
      <J y={112} r={-side * a[1]}>
        <path d={limbPath(108, 30, 25)} fill={suit} />
        <path d="M-17,50 L17,50 L13,104 L-13,104Z" fill={acc} />
        <J y={112}>
          <ellipse cx={0} cy={2} rx={17} ry={19} fill={pose.zap > 0 ? skin : acc} />
          {pose.handGlow > 0 ? <EnergyBall x={0} y={6} r={16 * pose.handGlow} t={t} color={look.energy} k={side} /> : null}
        </J>
      </J>
    </J>
  );

  // hand positions (approx) for arcs in zap mode
  const handPos = (side: -1 | 1, a: [number, number]): Pt => {
    const r1 = (-side * a[0] * Math.PI) / 180, r2 = r1 + (-side * a[1] * Math.PI) / 180;
    const sx = side * 70, sy = -440 + crouchY;
    const ex = sx - Math.sin(r1) * 112, ey = sy + Math.cos(r1) * 112;
    return [ex - Math.sin(r2) * 114, ey + Math.cos(r2) * 114];
  };
  const hl = handPos(-1, pose.armL), hr = handPos(1, pose.armR);

  return (
    <g>
      <path d={capeD} fill={capeIn} />
      <path d={capeD} fill={cape} transform="translate(0,-6) scale(0.93,1)" />
      <path d="M-40,-440 Q-60,-300 -110,-120 M40,-440 Q60,-300 110,-120" stroke={darken(cape, 0.18)} strokeWidth={6} fill="none" opacity={0.5} />
      {leg(-1, pose.legL)}
      {leg(1, pose.legR)}
      {arm(-1, pose.armL, false)}
      {arm(1, pose.armR, false)}
      <g transform={`translate(0,${crouchY}) scale(1,${1 + breathe * 0.004})`}>
        {/* torso */}
        <path
          d={look.female
            ? "M-66,-450 Q-70,-472 -40,-474 L40,-474 Q70,-472 66,-450 L52,-380 Q38,-340 44,-300 L-44,-300 Q-38,-340 -52,-380Z"
            : "M-80,-446 Q-84,-474 -48,-476 L48,-476 Q84,-474 80,-446 L60,-362 Q46,-322 44,-298 L-44,-298 Q-46,-322 -60,-362Z"}
          fill={suit}
        />
        <path d="M-58,-446 Q-30,-420 0,-432 Q30,-420 58,-446 Q40,-400 0,-398 Q-40,-400 -58,-446Z" fill={lighten(suit, 0.12)} opacity={0.7} />
        <path d="M0,-398 L0,-320 M-22,-370 Q0,-362 22,-370 M-20,-340 Q0,-334 20,-340" stroke={darken(suit, 0.18)} strokeWidth={3} fill="none" opacity={0.6} />
        <path d="M-48,-306 L48,-306 L46,-286 L-46,-286Z" fill={acc} />
        <rect x={-12} y={-308} width={24} height={24} rx={4} fill={lit(look.emblem)} />
        <path d="M-47,-288 L47,-288 L42,-256 Q0,-236 -42,-256Z" fill={acc} />
        <Emblem x={0} y={-420} s={1} look={look} lit={lit} glow={glowing ? 0.6 + 0.4 * Math.sin(t * 6) : 0} />
        {/* cape clasps */}
        <circle cx={-56} cy={-456} r={10} fill={lit(look.emblem)} />
        <circle cx={56} cy={-456} r={10} fill={lit(look.emblem)} />
        <Head look={look} lit={lit} t={t} seed={seed} tilt={pose.tilt} mouth={pose.zap > 0.5 ? 0.4 + 0.3 * Math.sin(t * 5) : 0} />
      </g>
      {pose.zap > 0.2 ? (
        <>
          <Arc a={hl} b={hr} frame={ctx.frame} seed={seed} k="hands" color={look.energy} width={4} opacity={pose.zap} branches={3} />
          <Arc a={hl} b={[hl[0] - 60, hl[1] + 160]} frame={ctx.frame} seed={seed} k="hl" color={look.energy} width={3} opacity={pose.zap * 0.8} />
          <Arc a={hr} b={[hr[0] + 60, hr[1] + 160]} frame={ctx.frame} seed={seed} k="hr" color={look.energy} width={3} opacity={pose.zap * 0.8} />
          <Sparks x={hl[0]} y={hl[1]} t={t} seed={seed} k="sl" rate={24} color={look.energy} speed={380} />
          <Sparks x={hr[0]} y={hr[1]} t={t} seed={seed} k="sr" rate={24} color={look.energy} speed={380} />
        </>
      ) : null}
    </g>
  );
};

/** Profile flight: horizontal body, fist forward, cape streaming behind. Centre at (0,0), facing +x. */
const HeroFly: React.FC<CharProps> = (p) => {
  const { ctx, t, seed } = p;
  const look = heroLook(p);
  const lit = (c: string) => ctx.lit(c);
  const suit = lit(look.suit), acc = lit(look.accent), cape = lit(look.cape), skin = lit(look.skin), hair = lit(look.hair);
  const glowing = ctx.spec.effects.includes("aura") || ctx.spec.effects.includes("sparks");
  const kick = Math.sin(t * 5.5);
  // cape ribbon with a travelling wave
  const L = 470, n = 12;
  const top: Pt[] = [], bot: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = 120 - u * L;
    const w = Math.sin(u * 5.5 - t * 13) * (8 + u * 46) + wobble(t * 2 + u * 3, seed, "cf") * u * 16;
    const spread = 18 + u * 70;
    top.push([x, -58 + w - spread * 0.55 + u * 20]);
    bot.push([x - u * 16, -58 + w + spread * 0.55 + u * 44]);
  }
  const capeD = smoothPath([...top, ...bot.reverse()], true, 0.8);
  const eye = blink(t, seed);
  const hairWave = Math.sin(t * 14) * 5;
  const fistGlow = glowing ? 1 : 0.0;
  return (
    <g transform={`rotate(${-8 + Math.sin(t * 1.4) * 3})`}>
      {/* back arm (along the body) */}
      <J x={110} y={-38} r={80}>
        <path d={limbPath(110, 34, 28)} fill={darken(suit, 0.15)} />
        <J y={104} r={-8}><path d={limbPath(96, 28, 24)} fill={darken(acc, 0.12)} /><circle cx={0} cy={100} r={16} fill={darken(acc, 0.12)} /></J>
      </J>
      <path d={capeD} fill={darken(cape, 0.3)} />
      <path d={capeD} fill={cape} transform="translate(4,-8) scale(0.97,0.9)" />
      {/* back leg */}
      <J x={-80} y={-6} r={84 + kick * 4}>
        <path d={limbPath(150, 50, 38)} fill={darken(suit, 0.15)} />
        <J y={142} r={20 - kick * 8}>
          <path d={limbPath(150, 38, 28)} fill={darken(suit, 0.15)} />
          <path d="M-19,70 L19,70 L14,150 L-14,150Z" fill={darken(acc, 0.15)} />
          <ellipse cx={-3} cy={156} rx={15} ry={24} fill={darken(acc, 0.2)} />
        </J>
      </J>
      {/* torso (horizontal) */}
      <path d="M-100,-40 Q-110,10 -80,26 L60,34 Q120,34 140,4 Q156,-30 140,-62 Q120,-86 70,-80 L-60,-66 Q-96,-62 -100,-40Z" fill={suit} />
      <path d="M60,-74 Q110,-80 132,-52 Q118,-36 80,-40 Q60,-50 60,-74Z" fill={lighten(suit, 0.14)} opacity={0.7} />
      <path d="M-82,-58 L-60,-64 L-50,24 L-76,22Z" fill={acc} />
      <path d="M-104,-40 Q-110,8 -80,26 L-60,28 L-66,-64Z" fill={acc} />
      <g transform="translate(100,-18) rotate(90) scale(0.8)">
        <path d="M0,-26 L24,-14 L18,14 L0,26 L-18,14 L-24,-14Z" fill={acc} />
        <path d="M0,-18 L5,-5 L18,-4 L8,5 L11,18 L0,10 L-11,18 L-8,5 L-18,-4 L-5,-5Z" fill={glowing ? "#ffffff" : lit(look.emblem)} />
      </g>
      {/* front leg */}
      <J x={-86} y={10} r={96 - kick * 4}>
        <path d={limbPath(150, 52, 40)} fill={suit} />
        <J y={142} r={4 + kick * 6}>
          <path d={limbPath(150, 40, 30)} fill={suit} />
          <path d="M-20,70 L20,70 L15,150 L-15,150Z" fill={acc} />
          <ellipse cx={-3} cy={156} rx={16} ry={25} fill={darken(acc, 0.08)} />
        </J>
      </J>
      {/* head */}
      <g transform="translate(176,-62) rotate(-14)">
        {look.female ? <path d={smoothPath([[-20, -40], [-80, -30 + hairWave], [-150, -10 - hairWave], [-110, 10 + hairWave], [-40, 10], [-10, 0]])} fill={darken(hair, 0.1)} /> : null}
        <rect x={-18} y={-8} width={30} height={30} fill={darken(skin, 0.12)} transform="rotate(-20)" />
        <ellipse cx={12} cy={-30} rx={36} ry={33} fill={skin} />
        <path d="M44,-30 L52,-18 L42,-14" fill={skin} />
        <path d="M0,-6 Q30,4 42,-8" stroke={darken(skin, 0.2)} strokeWidth={3} fill="none" />
        {look.mask ? <path d="M-6,-44 Q20,-50 48,-40 L46,-30 Q30,-28 16,-34 L-6,-32Z" fill={acc} /> : null}
        <g transform={`translate(30,-37) scale(1,${Math.max(0.1, eye)})`}>
          <ellipse cx={0} cy={0} rx={7} ry={5.5} fill="#fff" />
          <circle cx={3} cy={0.5} r={3.6} fill="#1b2230" />
        </g>
        <path d="M18,-50 Q30,-54 42,-49" stroke={hair} strokeWidth={4} fill="none" strokeLinecap="round" />
        <path d={`M-24,-30 Q-26,-66 12,-66 Q44,-66 46,-48 Q30,-58 14,-54 Q-6,-50 -12,-26 Q-18,-${24 + hairWave} -24,-30Z`} fill={hair} />
        <path d={`M-20,-40 Q-44,${-40 + hairWave} -58,${-30 - hairWave}`} stroke={hair} strokeWidth={9} fill="none" strokeLinecap="round" />
        <ellipse cx={-6} cy={-26} rx={6} ry={9} fill={darken(skin, 0.08)} />
      </g>
      {/* front arm reaching forward with fist */}
      <J x={126} y={-26} r={-100}>
        <path d={limbPath(116, 38, 30)} fill={suit} />
        <J y={110} r={4}>
          <path d={limbPath(104, 30, 26)} fill={suit} />
          <path d="M-17,48 L17,48 L14,104 L-14,104Z" fill={acc} />
          <J y={112}>
            <ellipse cx={0} cy={2} rx={20} ry={18} fill={acc} />
            <path d="M-14,-8 L14,-8" stroke={darken(acc, 0.25)} strokeWidth={2} />
            {fistGlow ? <EnergyBall x={0} y={8} r={16} t={t} color={look.energy} /> : null}
          </J>
        </J>
      </J>
      {/* cape clasp */}
      <circle cx={128} cy={-64} r={10} fill={lit(look.emblem)} />
    </g>
  );
};

export const Hero: React.FC<CharProps> = (p) => (p.action === "fly" ? <HeroFly {...p} /> : <HeroFront {...p} />);

/** Vertical offset for hovering / landing (applied by the scene). */
export const heroLift = (p: { action: string; t: number; dur: number }): number => {
  if (p.action === "land") {
    const ti = landImpactTime(p.dur);
    if (p.t >= ti) return 0;
    return -900 * easeIn(clamp(1 - p.t / ti));
  }
  if (p.action === "fly") return Math.sin(p.t * 1.7) * 18;
  return -140 + Math.sin(p.t * 1.6) * 16 + Math.sin(p.t * 0.7) * 8;
};
