/**
 * Generic story person in profile (facing +x), feet at (0,0).
 * Roles: nurse, doctor, scientist, kid, worker, civilian. Actions: walk, gesture, zap (hands on
 * something while sparks crawl up the arms), idle.
 */
import React from "react";
import { travelSpeed } from "../camera";
import { darken } from "../lib/color";
import { blink, clamp, easeOut, lerp, pick, prog, rnd, wobble, type Pt } from "../lib/math";
import { capsule, gaitFoot, ik2 } from "../lib/rig";
import { J } from "../lib/svg";
import { Arc, EnergyBall, Sparks } from "../effects/energy";
import type { CharProps } from "./types";

const SKINS = ["#f3cfb0", "#e7b48a", "#c98c5a", "#9a6038", "#6b4125", "#ffe0c2"];
const HAIRS = ["#1b1712", "#3b2414", "#6b3b1c", "#c9923e", "#8b2c14", "#2a2a2a"];

type Outfit = { top: string; bottom: string; shoes: string; coat?: string; accent?: string; hat?: "nurse" | "hard" | null; goggles?: boolean; stetho?: boolean; vest?: boolean };

const outfitFor = (role: string, seed: number): Outfit => {
  switch (role) {
    case "nurse": {
      const c = pick(seed, ["#2bb3a3", "#3b82f6", "#7c5cd6", "#e76f9a"], "scrub");
      return { top: c, bottom: c, shoes: "#f4f6f8", hat: pick(seed, ["nurse", null] as const, "cap"), stetho: true };
    }
    case "doctor":
      return { top: pick(seed, ["#5b8def", "#3fa37a", "#8a6ad8"], "shirt"), bottom: "#2f3a4f", shoes: "#2a2320", coat: "#f7f9fb", stetho: true, accent: "#c0392b" };
    case "scientist":
      return { top: pick(seed, ["#7c5cd6", "#e0843a", "#2f8f83"], "shirt"), bottom: "#3a3f4f", shoes: "#2a2320", coat: "#f7f9fb", goggles: true };
    case "kid":
      return { top: pick(seed, ["#ff5f5f", "#ffc93c", "#3cc47c", "#4aa3ff"], "tee"), bottom: pick(seed, ["#2f5fa8", "#6a4a3a", "#3b3b4f"], "shorts"), shoes: pick(seed, ["#ff7a3c", "#ffffff", "#3cc4c4"], "kicks") };
    case "worker":
      return { top: "#3f6fb0", bottom: "#2f3f5f", shoes: "#4a3322", hat: "hard", vest: true };
    default:
      return { top: pick(seed, ["#e0843a", "#3f8fd0", "#c0506a", "#4a9a6a", "#6a5acd"], "jacket"), bottom: pick(seed, ["#2f4f7f", "#3a3a44", "#6a5a4a"], "jeans"), shoes: pick(seed, ["#2a2320", "#f4f4f4", "#8a4a2a"], "shoes") };
  }
};

/** Reach from the feet origin to the hands in the press pose (local units). */
export const PERSON_REACH = 232;

export const Person: React.FC<CharProps> = (p) => {
  const { ctx, t, seed, action } = p;
  const L = ctx.lit;
  const role = ctx.spec.role;
  const kid = role === "kid";
  const female = ctx.spec.gender === "f";
  const o = outfitFor(role, seed);
  const skin = L(pick(seed, SKINS, "skin")), hair = L(pick(seed, HAIRS, "hair"));
  const top = L(o.top), bottom = L(o.bottom), shoes = L(o.shoes), coat = o.coat ? L(o.coat) : null;
  const walking = action === "walk" || action === "run";
  const zap = action === "zap" ? easeOut(prog(t, 0.15, 0.6)) : 0;
  const gesturing = action === "gesture";

  // ---- legs (IK gait)
  const hipY = -250;
  const period = action === "run" ? 0.55 : 0.9;
  const speed = walking ? travelSpeed(ctx.spec) / Math.max(0.1, p.scale) : 0;
  const phase = walking ? t / period : 0;
  const stride = speed * 0.6 * period;
  const bob = walking ? -Math.abs(Math.sin(phase * Math.PI * 2)) * 8 : Math.sin(t * 2) * 1.5;
  const shake = zap > 0.3 ? (rnd(seed, "sh", ctx.frame) - 0.5) * 6 * zap : 0;
  const leg = (near: boolean) => {
    const off = walking ? gaitFoot(phase + (near ? 0 : 0.5), 0.6, stride, 50) : ([near ? 14 : -18, 0] as Pt);
    const hip: Pt = [0, hipY + bob];
    const foot: Pt = [off[0] + (zap ? (near ? -30 : 10) : 0), Math.min(0, off[1])];
    const { knee, foot: f } = ik2(hip, [foot[0], foot[1] - 18], 124, 118, 1);
    const c = near ? bottom : darken(bottom, 0.25);
    const sh = near ? shoes : darken(shoes, 0.25);
    const shinC = kid ? skin : c;
    return (
      <g key={String(near)}>
        <path d={capsule(hip, knee, 50, 40)} fill={c} />
        <path d={capsule(knee, f, 40, 32)} fill={kid ? (near ? shinC : darken(shinC, 0.2)) : c} />
        {kid ? <path d={capsule(hip, [lerp(hip[0], knee[0], 0.8), lerp(hip[1], knee[1], 0.8)], 54, 46)} fill={c} /> : null}
        <path d={`M${f[0] - 22},${f[1] - 4} Q${f[0] - 20},${f[1] - 22} ${f[0]},${f[1] - 22} L${f[0] + 18},${f[1] - 14} Q${f[0] + 46},${f[1] - 10} ${f[0] + 46},${f[1] + 6} L${f[0] - 22},${f[1] + 8}Z`} fill={sh} />
      </g>
    );
  };

  // ---- arms
  const sh: Pt = [8, -418 + bob];
  const swing = walking ? Math.sin(phase * Math.PI * 2) * 32 : 0;
  const talk = gesturing ? Math.sin(t * 2.2) : 0;
  const arm = (near: boolean) => {
    let a1: number, a2: number;
    if (zap > 0) {
      a1 = lerp(near ? 8 : -6, -86, zap);
      a2 = lerp(-10, -4, zap);
    } else if (gesturing && near) {
      a1 = -50 - 20 * (0.5 + 0.5 * talk);
      a2 = -70 + Math.sin(t * 7) * 18;
    } else if (gesturing) {
      a1 = -20 + talk * 6;
      a2 = -40;
    } else {
      a1 = (near ? swing : -swing) + wobble(t * 0.5, seed, `a${near}`) * 3;
      a2 = -14 - Math.abs(swing) * 0.4;
    }
    const sleeve = coat ?? top;
    const c = near ? sleeve : darken(sleeve, 0.25);
    const sk = near ? skin : darken(skin, 0.2);
    return (
      <J key={String(near)} x={sh[0] + (near ? 0 : -6)} y={sh[1] + (near ? 0 : -4)} r={a1}>
        <path d={capsule([0, 0], [0, 104], 40, 32)} fill={c} />
        <J y={100} r={a2}>
          <path d={capsule([0, 0], [0, 92], kid || role === "nurse" ? 26 : 32, 26)} fill={kid || role === "nurse" ? sk : c} />
          {role === "nurse" || kid ? <path d={capsule([0, -6], [0, 18], 34, 32)} fill={c} /> : null}
          <ellipse cx={zap ? 6 : 0} cy={104} rx={zap ? 12 : 15} ry={zap ? 20 : 16} fill={sk} />
          {near && zap > 0.2 ? <EnergyBall x={10} y={108} r={14} t={t} color="#9fe8ff" /> : null}
        </J>
      </J>
    );
  };

  // hand/elbow/shoulder positions for the sparks crawling up the arm (world-local)
  const armPts = (near: boolean): [Pt, Pt, Pt] => {
    const a1 = (lerp(near ? 8 : -6, -86, zap) * Math.PI) / 180;
    const a2 = a1 + (lerp(-10, -4, zap) * Math.PI) / 180;
    const s: Pt = [sh[0] + (near ? 0 : -6), sh[1] + (near ? 0 : -4)];
    const e: Pt = [s[0] - Math.sin(a1) * 100, s[1] + Math.cos(a1) * 100];
    const h: Pt = [e[0] - Math.sin(a2) * 104, e[1] + Math.cos(a2) * 104];
    return [h, e, s];
  };

  // ---- head
  const eye = zap > 0.5 ? 1 : blink(t, seed);
  const mouthOpen = zap > 0.5 ? 0.8 : gesturing ? Math.max(0, Math.sin(t * 11)) * 0.6 * (Math.sin(t * 1.3) > -0.5 ? 1 : 0) : 0;
  const nod = gesturing ? Math.sin(t * 2.2) * 4 : walking ? Math.sin(phase * Math.PI * 4) * 1.5 : wobble(t * 0.4, seed, "nod") * 3;
  const hairUp = zap > 0.5;
  const hs = kid ? 1.22 : 1;
  const head = (
    <J x={20} y={-468 + bob} r={nod} s={hs}>
      {/* back hair */}
      {female && !hairUp ? (
        role === "nurse" || role === "doctor" || role === "scientist" ? <circle cx={-40} cy={-22} r={20} fill={hair} /> : <path d="M-44,-30 Q-58,40 -30,70 Q-4,60 -6,20Z" fill={hair} />
      ) : null}
      <rect x={-12} y={10} width={26} height={30} fill={darken(skin, 0.12)} />
      <ellipse cx={4} cy={-10} rx={40} ry={46} fill={skin} />
      <path d="M40,-18 Q54,-4 44,4 L38,2Z" fill={skin} />
      <path d="M26,24 Q36,34 28,40 Q10,40 4,30Z" fill={darken(skin, 0.08)} />
      <ellipse cx={-10} cy={-4} rx={8} ry={12} fill={darken(skin, 0.1)} />
      <g transform={`translate(22,-14) scale(1,${Math.max(0.1, eye)})`}>
        <ellipse cx={0} cy={0} rx={zap > 0.5 ? 7 : 5} ry={zap > 0.5 ? 8 : 6} fill="#fff" />
        <circle cx={2} cy={0} r={4} fill="#1b2230" />
      </g>
      <path d={`M14,${-28 - zap * 6} Q24,${-32 - zap * 6} 34,-27`} stroke={hair} strokeWidth={4} fill="none" strokeLinecap="round" />
      {mouthOpen > 0.05 ? <ellipse cx={32} cy={20} rx={6} ry={2 + mouthOpen * 7} fill="#6a2020" /> : <path d="M26,18 Q32,22 38,17" stroke="#8a3a3a" strokeWidth={3} fill="none" strokeLinecap="round" />}
      {/* hair */}
      {hairUp ? (
        <path d={Array.from({ length: 9 }, (_, i) => {
          const x = -40 + i * 10, len = 40 + rnd(seed, "hu", i, Math.floor(ctx.frame / 2)) * 26;
          return `M${x - 8},-40 L${x + (rnd(seed, "hx", i, Math.floor(ctx.frame / 2)) - 0.5) * 20},${-50 - len} L${x + 8},-40Z`;
        }).join("")} fill={hair} />
      ) : null}
      <path d={female ? "M-44,-6 Q-50,-64 0,-62 Q40,-60 44,-30 Q20,-40 6,-36 Q-10,-30 -20,-40 Q-30,-20 -36,10Z" : "M-44,-4 Q-50,-60 -2,-60 Q36,-62 44,-34 Q24,-42 8,-40 Q-12,-38 -24,-44 Q-32,-24 -34,-4Z"} fill={hair} />
      {o.hat === "nurse" ? <g><path d="M-30,-58 L26,-62 L22,-82 L-26,-78Z" fill={L("#ffffff")} /><path d="M-4,-78 h6v5h5v6h-5v5h-6v-5h-5v-6h5Z" fill="#e2464f" /></g> : null}
      {o.hat === "hard" ? <g><path d="M-46,-40 Q-44,-86 2,-88 Q46,-86 48,-40Z" fill={L("#ffcc22")} /><rect x={-52} y={-44} width={112} height={10} rx={5} fill={L("#e6b400")} /></g> : null}
      {o.goggles ? <g><rect x={-40} y={-42} width={84} height={10} fill={L("#3a3a44")} /><rect x={14} y={-50} width={30} height={24} rx={8} fill={L("#9fd8ff")} stroke={L("#3a3a44")} strokeWidth={4} opacity={0.9} /></g> : null}
    </J>
  );

  // ---- torso
  const lean = walking ? 4 : zap ? 6 : 0;
  const torso = (
    <g transform={`rotate(${lean} 0 ${hipY})`}>
      <path d={`M-34,${hipY + 20} Q-40,${hipY - 80} -30,${-420 + bob} Q0,${-440 + bob} 36,${-420 + bob} Q${female ? 50 : 40},${-370 + bob} 34,${hipY - 40} Q36,${hipY} 32,${hipY + 20}Z`} fill={top} />
      {o.vest ? <><path d={`M-30,${-410 + bob} L34,${-410 + bob} L32,${hipY + 10} L-34,${hipY + 10}Z`} fill={L("#ff8a1f")} /><rect x={-34} y={-330 + bob} width={68} height={12} fill={L("#e8f0f0")} /><rect x={-34} y={-290 + bob} width={68} height={12} fill={L("#e8f0f0")} /></> : null}
      {coat ? <path d={`M-40,${hipY + 90} Q-46,${hipY - 60} -34,${-424 + bob} Q0,${-444 + bob} 40,${-424 + bob} L46,${-380 + bob} Q24,${-330 + bob} 30,${hipY + 88}Z`} fill={coat} /> : null}
      {coat ? <path d={`M30,${-420 + bob} L14,${-340 + bob} L34,${hipY + 88}`} stroke={darken(coat, 0.12)} strokeWidth={4} fill="none" /> : null}
      {coat && o.accent ? <path d={`M26,${-418 + bob} L20,${-360 + bob} L28,${-348 + bob} L32,${-360 + bob}Z`} fill={L(o.accent)} /> : null}
      {o.stetho ? <path d={`M-10,${-424 + bob} Q-6,${-370 + bob} 20,${-360 + bob} Q40,${-370 + bob} 34,${-420 + bob} M20,${-360 + bob} L22,${-330 + bob}`} stroke={L("#2a2f3a")} strokeWidth={5} fill="none" strokeLinecap="round" /> : null}
      {o.stetho ? <circle cx={22} cy={-326 + bob} r={9} fill={L("#c9d1dc")} /> : null}
      {kid ? null : <rect x={-34} y={hipY + 8} width={68} height={16} fill={darken(bottom, 0.2)} opacity={coat ? 0 : 1} />}
    </g>
  );

  const [hN, eN, sN] = armPts(true);
  const [hF, eF, sF] = armPts(false);
  const crawl = prog(t, 0.5, 1.8);
  const lerpP = (a: Pt, b: Pt, u: number): Pt => [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
  const path3 = (h: Pt, e: Pt, s: Pt, u: number): Pt => (u < 0.5 ? lerpP(h, e, u * 2) : lerpP(e, s, (u - 0.5) * 2));

  return (
    <g transform={`translate(${shake},0) scale(${kid ? 0.72 : 1})`}>
      {arm(false)}
      {leg(false)}
      {leg(true)}
      {torso}
      {head}
      {arm(true)}
      {zap > 0.2 ? (
        <g>
          <Arc a={hF} b={path3(hF, eF, sF, clamp(crawl * 0.9))} frame={ctx.frame} seed={seed} k="af" width={3.5} amp={22} segs={8} opacity={zap} />
          <Arc a={hN} b={path3(hN, eN, sN, clamp(crawl))} frame={ctx.frame} seed={seed} k="an" width={4} amp={24} segs={8} opacity={zap} />
          {crawl > 0.5 ? <Arc a={eN} b={[sN[0] + 10, sN[1] - 60]} frame={ctx.frame} seed={seed} k="as" width={3} amp={20} opacity={zap * (crawl - 0.5) * 2} /> : null}
          {crawl > 0.8 ? <Arc a={sN} b={[sN[0] - 40, sN[1] + 120]} frame={ctx.frame} seed={seed} k="at" width={3} amp={26} opacity={zap} /> : null}
          <Sparks x={hN[0] + 10} y={hN[1]} t={t} seed={seed} k="hs" rate={36} speed={420} color="#bff1ff" size={0.9} />
          <Sparks x={hN[0] + 10} y={hN[1]} t={t + 0.3} seed={seed} k="hs2" rate={20} speed={300} dir={Math.PI} spread={1.4} color="#ffe28a" size={0.8} />
        </g>
      ) : null}
    </g>
  );
};
