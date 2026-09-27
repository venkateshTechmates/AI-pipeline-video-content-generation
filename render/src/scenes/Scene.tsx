/** The `scene` composition: prompt → parsed scene → layered, animated SVG. */
import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import { cameraAt, flashAt, strikeTimes, travelSpeed } from "./camera";
import { CHARACTER_DEFS } from "./characters";
import type { Placement } from "./characters/types";
import type { Ctx } from "./ctx";
import { Aura, Bubbles, Dust, Fireflies, LensFlare, LightRays, Rain, Snow, SpeedLines } from "./effects/atmos";
import { mix } from "./lib/color";
import { rnd } from "./lib/math";
import { GroundShadow, Layer, Lit, useSid } from "./lib/svg";
import { litBy, makePalette } from "./palette";
import { INDOOR, parsePrompt } from "./parse";
import type { SceneProps } from "./schema";
import { SETTING_DEFS } from "./settings";

export const VH = 1600;

const Grade: React.FC<{ ctx: Ctx }> = ({ ctx }) => {
  const id = useSid();
  const { VW, VH: H, flash, pal } = ctx;
  return (
    <>
      <defs>
        <radialGradient id={id} cx="50%" cy="46%" r="75%">
          <stop offset="0.55" stopColor="#000" stopOpacity={0} />
          <stop offset="1" stopColor={pal.night ? "#000010" : "#1a0d20"} stopOpacity={pal.night ? 0.6 : 0.38} />
        </radialGradient>
      </defs>
      <rect x={0} y={0} width={VW} height={H} fill={`url(#${id})`} />
      {flash > 0.01 ? <rect x={0} y={0} width={VW} height={H} fill="#dfe8ff" opacity={flash * 0.28} /> : null}
    </>
  );
};

export const SceneComposition: React.FC<SceneProps> = ({ prompt, seed, width, height }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const spec = useMemo(() => parsePrompt(prompt, seed), [prompt, seed]);
  const pal = useMemo(() => {
    const p = makePalette(spec.time, spec.weather, spec.setting);
    const maxY = SETTING_DEFS[spec.setting].orbMaxY;
    if (p.orb && maxY !== undefined) p.orb.y = Math.min(p.orb.y, maxY);
    return p;
  }, [spec]);
  const uid = useSid();

  const VW = (VH * width) / height;
  const t = frame / fps;
  const dur = durationInFrames / fps;
  const setting = SETTING_DEFS[spec.setting];
  const strikes = spec.effects.includes("lightning") ? strikeTimes(seed, dur) : [];
  const flash = strikes.length ? flashAt(t, strikes) : 0;
  const litBase = litBy(pal);
  const ctx: Ctx = {
    frame, fps, t, dur, VW, VH, seed, spec, pal, flash, uid,
    lit: (c: string) => litBase(c, flash * 0.8),
    groundY: setting.ground(VH),
    scroll: travelSpeed(spec) * t,
    cam: cameraAt(spec, seed, t, dur),
  };

  const def = CHARACTER_DEFS[spec.character];
  const n = Math.max(1, spec.count);
  const placements: (Placement & { idx: number })[] = [];
  for (let i = 0; i < n; i++) placements.push({ ...def.place(ctx, i, n), idx: i });
  placements.sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

  const fx = spec.effects;
  const energy = spec.character === "hero" || spec.character === "heroine" ? "#9fe8ff" : "#ffe7a0";
  const flying = spec.action === "fly" && (spec.character === "hero" || spec.character === "heroine");
  const orb = pal.orb;

  return (
    <AbsoluteFill style={{ backgroundColor: pal.skyTop }}>
      <svg viewBox={`0 0 ${VW} ${VH}`} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ display: "block" }}>
        <setting.Back ctx={ctx} />
        {fx.includes("rays") && spec.setting !== "underwater" ? <LightRays ctx={ctx} x={orb ? orb.x * VW : VW * 0.3} y={orb ? orb.y * VH : -100} color={mix(pal.skyLow, "#ffffff", 0.5)} opacity={0.18} /> : null}
        {fx.includes("rain") ? <Rain ctx={ctx} /> : null}
        {fx.includes("snow") ? <Snow ctx={ctx} /> : null}
        {fx.includes("fireflies") ? <Fireflies ctx={ctx} /> : null}
        {flying ? <SpeedLines ctx={ctx} color={pal.night ? "#9fb6e8" : "#ffffff"} /> : null}

        <Layer ctx={ctx} depth={1} scrollFactor={0}>
          {placements.map((p) => {
            const tt = t + (p.t ?? 0);
            const Char = def.C;
            const shadow = def.kind === "ground";
            const lift = def.lift ? def.lift({ action: spec.action, t: tt, dur, idx: p.idx }) : 0;
            const auraOn = fx.includes("aura") && p.idx === 0;
            const auraY = def.auraY ?? -300;
            return (
              <g key={p.idx} opacity={p.opacity}>
                {shadow ? <GroundShadow cx={p.x} cy={p.y + 6} rx={def.shadowW * p.s * (1 - Math.min(0.7, -lift / 900))} opacity={pal.night ? 0.35 : 0.3} /> : null}
                <g transform={`translate(${p.x.toFixed(1)},${(p.y + lift * p.s).toFixed(1)}) scale(${(p.flip ? -p.s : p.s).toFixed(4)},${p.s.toFixed(4)})`}>
                  {auraOn ? <Aura ctx={ctx} x={0} y={auraY} r={def.auraR ?? 300} ry={(def.auraR ?? 300) * 1.25} color={energy} /> : null}
                  <Lit ctx={ctx} size={def.rim ?? 6}>
                    <Char ctx={ctx} action={spec.action} seed={seed * 31 + p.idx * 7} idx={p.idx} t={tt} scale={p.s} />
                  </Lit>
                </g>
              </g>
            );
          })}
        </Layer>

        {setting.Front ? <setting.Front ctx={ctx} /> : null}
        {fx.includes("rays") && spec.setting === "underwater" ? <LightRays ctx={ctx} opacity={0.2} n={8} /> : null}
        {fx.includes("bubbles") ? <Bubbles ctx={ctx} n={26} /> : null}
        {fx.includes("rain") ? <Rain ctx={ctx} front heavy={spec.weather === "storm" ? 1.3 : 1} /> : null}
        {fx.includes("snow") ? <Snow ctx={ctx} front /> : null}
        {fx.includes("fireflies") ? <Fireflies ctx={ctx} n={8} front /> : null}
        {fx.includes("dust") ? <Dust ctx={ctx} color={pal.night ? "#cfd8ff" : "#fff3d6"} n={INDOOR.includes(spec.setting) ? 45 : 30} /> : null}
        {fx.includes("flare") && orb && !orb.moon && rnd(seed, "flare") < 0.8 ? <LensFlare ctx={ctx} sx={orb.x * VW - ctx.cam.x * 0.03} sy={orb.y * VH} strength={spec.time === "day" ? 0.6 : 0.9} /> : null}
        <Grade ctx={ctx} />
      </svg>
    </AbsoluteFill>
  );
};
