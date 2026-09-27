/** City skyline (day/night, twinkling windows, traffic) and the rooftops variant. */
import React from "react";
import type { Ctx } from "../ctx";
import { darken, lighten, mix } from "../lib/color";
import { mod, rnd, rr, TAU } from "../lib/math";
import { Glow, Layer, tiles, useSid } from "../lib/svg";
import { Clouds, HorizonHaze, Orb, Sky, Stars } from "./common";

type BProps = { ctx: Ctx; x: number; w: number; h: number; base: number; body: string; side: string; k: string; detail: number };

/** One building with a window grid rendered as a handful of <path>s. */
const Building: React.FC<BProps> = ({ ctx, x, w, h, base, body, side, k, detail }) => {
  const { seed, t, pal } = ctx;
  const night = pal.night;
  const top = base - h;
  const ls = pal.lightSide;
  const cols = Math.max(2, Math.floor(w / (26 * detail)));
  const rows = Math.max(3, Math.floor(h / (34 * detail)));
  const padX = w * 0.12, padY = 30 * detail;
  const cw = (w - padX * 2) / cols, rh = (h - padY * 1.6) / rows;
  const ww = cw * 0.56, wh = rh * 0.55;
  const style = Math.floor(rnd(seed, k, "style") * 3); // 0 grid, 1 bands, 2 tall slits
  let dark = "", lit = "", warm = "";
  const litFrac = night ? rr(seed, 0.18, 0.45, k, "lf") : 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const wx = x - w / 2 + padX + c * cw + (cw - ww) / 2;
      const wy = top + padY + r * rh;
      const rect = style === 1 ? `M${wx - (cw - ww) / 2},${wy}h${cw}v${wh * 0.7}h${-cw}Z` : style === 2 ? `M${wx + ww * 0.25},${wy}h${ww * 0.5}v${rh * 0.85}h${-ww * 0.5}Z` : `M${wx},${wy}h${ww}v${wh}h${-ww}Z`;
      if (!night) {
        dark += rect;
        continue;
      }
      const id = r * 97 + c;
      const flick = rnd(seed, k, "fl", id) < 0.12;
      const slot = flick ? Math.floor(t * 0.9 + rnd(seed, k, "ph", id) * 7) : 0;
      const on = rnd(seed, k, "on", id, slot) < litFrac;
      if (on) (rnd(seed, k, "warm", id) < 0.7 ? (warm += rect) : (lit += rect));
      else dark += rect;
    }
  }
  const winDay = mix(lighten(body, 0.35), pal.skyMid, 0.5);
  const roofKind = rnd(seed, k, "roof");
  const antennaBlink = Math.sin(t * 4 + rnd(seed, k, "ab") * TAU) > 0.4;
  return (
    <g>
      <rect x={x - w / 2} y={top} width={w} height={h + 400} fill={body} />
      <rect x={ls < 0 ? x - w / 2 : x + w / 2 - w * 0.16} y={top} width={w * 0.16} height={h + 400} fill={side} opacity={0.85} />
      <rect x={x - w / 2 - 4} y={top - 8} width={w + 8} height={10} fill={darken(body, 0.2)} />
      {roofKind < 0.25 ? (
        <>
          <rect x={x - 2} y={top - h * 0.18} width={4} height={h * 0.18} fill={darken(body, 0.2)} />
          {night && antennaBlink ? <><circle cx={x} cy={top - h * 0.18} r={5} fill="#ff4d4d" /><Glow cx={x} cy={top - h * 0.18} r={30} color="#ff3b3b" opacity={0.8} /></> : null}
        </>
      ) : roofKind < 0.45 ? (
        <path d={`M${x - w / 2},${top} L${x},${top - w * 0.45} L${x + w / 2},${top}Z`} fill={darken(body, 0.1)} />
      ) : roofKind < 0.6 ? (
        <rect x={x - w * 0.3} y={top - 36} width={w * 0.6} height={36} fill={darken(body, 0.08)} />
      ) : null}
      <path d={dark} fill={night ? darken(body, 0.35) : winDay} opacity={night ? 1 : 0.9} />
      {night ? (
        <>
          <path d={warm} fill={pal.lamp} />
          <path d={lit} fill="#cfe6ff" />
        </>
      ) : null}
    </g>
  );
};

const skylineLayer = (ctx: Ctx, depth: number, k: string, base: number, hMin: number, hMax: number, wMin: number, wMax: number, color: string, detail: number, spacing: number) => (
  <Layer ctx={ctx} depth={depth} key={k}>
    {tiles(ctx, depth, spacing, wMax).map(({ i, x }) => {
      const w = rr(ctx.seed, wMin, wMax, k, "w", i);
      const h = rr(ctx.seed, hMin, hMax, k, "h", i) * (rnd(ctx.seed, k, "tall", i) < 0.15 ? 1.4 : 1);
      const body = mix(color, darken(color, 0.25), rnd(ctx.seed, k, "c", i));
      return <Building key={i} ctx={ctx} x={x + rr(ctx.seed, -0.2, 0.2, k, "j", i) * spacing} w={w} h={h} base={base} body={body} side={lighten(body, ctx.pal.night ? 0.08 : 0.18)} k={`${k}${i}`} detail={detail} />;
    })}
  </Layer>
);

const FarSkyline: React.FC<{ ctx: Ctx; base: number; color: string }> = ({ ctx, base, color }) => {
  const d = 0.1;
  const id = useSid();
  return (
    <Layer ctx={ctx} depth={d}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} />
          <stop offset="1" stopColor={ctx.pal.haze} />
        </linearGradient>
      </defs>
      {tiles(ctx, d, 70, 100).map(({ i, x }) => {
        const h = rr(ctx.seed, 120, 380, "far", i) * (rnd(ctx.seed, "farT", i) < 0.1 ? 1.5 : 1);
        const w = rr(ctx.seed, 50, 90, "farw", i);
        return <rect key={i} x={x - w / 2} y={base - h} width={w} height={h + 300} fill={`url(#${id})`} />;
      })}
    </Layer>
  );
};

/** Street level: road, sidewalk, street lamps, a traffic light and passing cars. */
const Street: React.FC<{ ctx: Ctx; y: number }> = ({ ctx, y }) => {
  const { t, seed, pal, VW } = ctx;
  const night = pal.night;
  const road = ctx.lit("#3a3f4b");
  const walk = ctx.lit("#8a8f9c");
  const cars = [];
  for (let i = 0; i < 6; i++) {
    const dir = i % 2 === 0 ? 1 : -1;
    const speed = rr(seed, 260, 420, "car", i);
    const span = VW + 1400;
    const cx = mod(rnd(seed, "carx", i) * span + dir * t * speed, span) - 700 + (ctx.cam.x);
    const cy = y + (dir > 0 ? 70 : 38);
    const col = ctx.lit(["#e04f5f", "#3d7bd9", "#f2c14e", "#e8e8ee", "#2bb3a3", "#8d5bd6"][i % 6]!);
    cars.push(
      <g key={i} transform={`translate(${cx},${cy}) scale(${dir},1)`}>
        <path d="M-70,0 L-66,-22 Q-60,-30 -44,-31 L-30,-50 Q-24,-56 -12,-56 L26,-56 Q36,-56 44,-46 L56,-31 Q70,-29 72,-18 L72,0Z" fill={col} />
        <path d="M-24,-47 L-12,-51 L10,-51 L10,-33 L-32,-33Z M16,-51 L30,-51 Q36,-50 40,-44 L48,-33 L16,-33Z" fill={night ? "#1c2333" : "#a9d4ee"} opacity={0.9} />
        <circle cx={-44} cy={0} r={13} fill="#15171d" /><circle cx={44} cy={0} r={13} fill="#15171d" />
        <circle cx={-44} cy={0} r={5} fill="#777" /><circle cx={44} cy={0} r={5} fill="#777" />
        {night ? (
          <>
            <Glow cx={72} cy={-18} r={70} color="#fff3c4" opacity={0.8} />
            <path d="M72,-20 L260,-50 L260,20Z" fill="#fff3c4" opacity={0.12} />
            <Glow cx={-70} cy={-18} r={30} color="#ff3030" opacity={0.9} />
          </>
        ) : null}
      </g>,
    );
  }
  // traffic light phase
  const cycle = mod(t + rnd(seed, "tl") * 5, 5);
  const phase = cycle < 2.2 ? 2 : cycle < 2.9 ? 1 : 0; // 2 green, 1 amber, 0 red
  const lampXs = tiles(ctx, 1, 520, 300);
  return (
    <>
      <Layer ctx={ctx} depth={1}>
        <rect x={-6000} y={y - 26} width={20000} height={30} fill={walk} />
        <rect x={-6000} y={y + 4} width={20000} height={220} fill={road} />
        {tiles(ctx, 1, 160, 200).map(({ i, x }) => (
          <rect key={i} x={x} y={y + 52} width={80} height={6} fill={ctx.lit("#e8d27a")} opacity={0.8} />
        ))}
        {lampXs.map(({ i, x }) => (
          <g key={`l${i}`}>
            <rect x={x - 5} y={y - 330} width={10} height={310} fill={ctx.lit("#2b2f3a")} />
            <path d={`M${x},${y - 330} q0,-30 40,-30 h30`} stroke={ctx.lit("#2b2f3a")} strokeWidth={9} fill="none" />
            <rect x={x + 55} y={y - 366} width={40} height={12} rx={5} fill={night ? "#fff1c4" : ctx.lit("#555b66")} />
            {night ? <><Glow cx={x + 75} cy={y - 350} r={120} color={pal.lamp} opacity={0.75} /><path d={`M${x + 58},${y - 352} L${x + 5},${y} L${x + 150},${y}  L${x + 92},${y - 352}Z`} fill={pal.lamp} opacity={0.08} /></> : null}
            {i % 3 === 0 ? (
              <g transform={`translate(${x + 260},${y - 20})`}>
                <rect x={-5} y={-280} width={10} height={280} fill={ctx.lit("#2b2f3a")} />
                <rect x={-22} y={-392} width={44} height={116} rx={10} fill={ctx.lit("#1f232c")} />
                {[0, 1, 2].map((j) => {
                  const on = (j === 0 && phase === 0) || (j === 1 && phase === 1) || (j === 2 && phase === 2);
                  const c = j === 0 ? "#ff3b3b" : j === 1 ? "#ffb52e" : "#32e07a";
                  return (
                    <g key={j}>
                      <circle cx={0} cy={-370 + j * 36} r={12} fill={on ? c : darken(c, 0.7)} />
                      {on ? <Glow cx={0} cy={-370 + j * 36} r={night ? 90 : 45} color={c} opacity={0.85} /> : null}
                    </g>
                  );
                })}
              </g>
            ) : null}
          </g>
        ))}
      </Layer>
      <Layer ctx={ctx} depth={1} scrollFactor={0.4}>{cars}</Layer>
    </>
  );
};

/** Foreground rooftop: parapet, water tower, AC units, antenna. */
const Rooftop: React.FC<{ ctx: Ctx; y: number }> = ({ ctx, y }) => {
  const { t, pal, seed } = ctx;
  const id = useSid();
  const roof = ctx.lit("#4b4f5e");
  const wall = ctx.lit("#6e5a55");
  const blink = Math.sin(t * 3.5) > 0.3;
  const d = 1;
  return (
    <Layer ctx={ctx} depth={d}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={roof} />
          <stop offset="1" stopColor={darken(roof, 0.4)} />
        </linearGradient>
      </defs>
      {tiles(ctx, d, 1100, 600).map(({ i, x }) => {
        const gap = rnd(seed, "gap", i) < 0.35;
        const yy = y + rr(seed, -40, 40, "ry", i);
        const tower = rnd(seed, "tw", i) < 0.55;
        return (
          <g key={i}>
            <rect x={x - 550 + (gap ? 60 : 0)} y={yy} width={1100 - (gap ? 60 : 0)} height={900} fill={`url(#${id})`} />
            <rect x={x - 550 + (gap ? 60 : 0)} y={yy - 30} width={1100 - (gap ? 60 : 0)} height={34} fill={wall} />
            <rect x={x - 550 + (gap ? 60 : 0)} y={yy - 36} width={1100 - (gap ? 60 : 0)} height={8} fill={lighten(wall, 0.2)} />
            {tower ? (
              <g transform={`translate(${x + rr(seed, -300, 300, "twx", i)},${yy - 30})`}>
                {[-60, -20, 20, 60].map((lx) => <rect key={lx} x={lx - 4} y={-150} width={8} height={150} fill={ctx.lit("#3a2f2b")} />)}
                <path d="M-60,-40 L60,-110 M60,-40 L-60,-110" stroke={ctx.lit("#3a2f2b")} strokeWidth={5} />
                <rect x={-80} y={-330} width={160} height={180} rx={10} fill={ctx.lit("#8a5a3c")} />
                {[0, 1, 2, 3].map((b) => <rect key={b} x={-80} y={-310 + b * 44} width={160} height={6} fill={ctx.lit("#5c3a26")} />)}
                <rect x={pal.lightSide < 0 ? -80 : 50} y={-330} width={30} height={180} fill={lighten(ctx.lit("#8a5a3c"), 0.2)} />
                <path d="M-90,-330 L0,-400 L90,-330Z" fill={ctx.lit("#5c3a26")} />
              </g>
            ) : (
              <g transform={`translate(${x + rr(seed, -250, 250, "acx", i)},${yy - 30})`}>
                <rect x={-90} y={-90} width={180} height={90} rx={8} fill={ctx.lit("#9aa3ad")} />
                <circle cx={-40} cy={-45} r={30} fill={ctx.lit("#5f6770")} />
                <g transform={`translate(-40,-45) rotate(${(t * 720) % 360})`}>
                  <rect x={-26} y={-4} width={52} height={8} fill={ctx.lit("#3a3f46")} />
                  <rect x={-4} y={-26} width={8} height={52} fill={ctx.lit("#3a3f46")} />
                </g>
                <rect x={20} y={-70} width={50} height={50} fill={ctx.lit("#7d858f")} />
                <rect x={120} y={-260} width={8} height={260} fill={ctx.lit("#30343c")} />
                <circle cx={124} cy={-262} r={7} fill={blink ? "#ff4d4d" : "#6b2020"} />
                {blink ? <Glow cx={124} cy={-262} r={50} color="#ff3b3b" opacity={0.8} /> : null}
              </g>
            )}
          </g>
        );
      })}
    </Layer>
  );
};

export const CityBack: React.FC<{ ctx: Ctx; rooftops?: boolean }> = ({ ctx, rooftops }) => {
  const { VH, pal } = ctx;
  const night = pal.night;
  const base = rooftops ? VH * 0.9 : VH * 0.92;
  const near = night ? "#1b2340" : ctx.lit("#56657f");
  const mid = night ? "#141b33" : mix(ctx.lit("#6f7d98"), pal.haze, 0.35);
  const far = night ? "#1e2a52" : mix("#8595b5", pal.haze, 0.6);
  return (
    <>
      <Sky ctx={ctx} horizon={0.7} />
      <Stars ctx={ctx} maxY={0.5} />
      <Orb ctx={ctx} />
      <Clouds ctx={ctx} depth={0.05} y={VH * 0.22} size={520} density={pal.stars ? 0.35 : 0.6} opacity={night ? 0.7 : 0.9} k="c1" />
      <FarSkyline ctx={ctx} base={base - 120} color={far} />
      <HorizonHaze ctx={ctx} y={base - 150} h={300} opacity={night ? 0.5 : 0.55} />
      {skylineLayer(ctx, 0.25, "mid", base - 60, 380, 820, 110, 190, mid, 0.8, 170)}
      <HorizonHaze ctx={ctx} y={base} h={260} opacity={0.35} />
      {skylineLayer(ctx, 0.5, "near", base + 40, 300, 700, 180, 280, near, 1.05, 300)}
      {rooftops ? <Rooftop ctx={ctx} y={VH * 0.8} /> : <Street ctx={ctx} y={VH * 0.9} />}
    </>
  );
};
export const cityGround = (VH: number, rooftops?: boolean) => (rooftops ? VH * 0.8 - 30 : VH * 0.9 - 12);
