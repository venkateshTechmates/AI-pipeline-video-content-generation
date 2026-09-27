import React from "react";
import { AbsoluteFill, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Captions } from "../components/Captions";
import { ClipTrack } from "../components/ClipTrack";
import { Logo } from "../components/Logo";
import { Soundtrack } from "../components/Soundtrack";
import { useCtaWindow } from "../components/useCta";
import { readableOn } from "../lib/color";
import { fontStack, useFonts } from "../lib/fonts";
import type { BrandOverlay, CompositionProps } from "../types";

/** Thin accent bar along the bottom edge showing playback progress. */
const ProgressBar: React.FC<{ color: string }> = ({ color }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const thickness = Math.min(width, height) * 0.012;
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        bottom: 0,
        height: thickness,
        width: `${(frame / Math.max(1, durationInFrames - 1)) * 100}%`,
        backgroundColor: color,
      }}
    />
  );
};

/** Full-frame accent wipe with oversized CTA text. */
const CtaSlam: React.FC<{ brand: BrandOverlay; text: string }> = ({ brand, text }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const short = Math.min(width, height);
  const wipe = spring({ frame, fps, config: { damping: 18, stiffness: 140 } });
  const pop = spring({ frame: frame - 5, fps, config: { damping: 10, stiffness: 160 } });

  return (
    <AbsoluteFill>
      <AbsoluteFill
        style={{
          backgroundColor: brand.accent_color,
          clipPath: `inset(${interpolate(wipe, [0, 1], [100, 0])}% 0 0 0)`,
        }}
      />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", padding: short * 0.08 }}>
        <div
          style={{
            transform: `scale(${interpolate(pop, [0, 1], [0.6, 1])}) rotate(-2deg)`,
            opacity: Math.min(1, pop * 1.5),
            maxWidth: width * 0.86,
            color: brand.primary_color,
            fontFamily: fontStack(brand.font),
            fontWeight: 900,
            fontSize: short * 0.1,
            lineHeight: 1.05,
            letterSpacing: "-0.01em",
            textTransform: "uppercase",
            textAlign: "center",
            textShadow: `${short * 0.006}px ${short * 0.006}px 0 ${readableOn(brand.primary_color) === "#FFFFFF" ? "rgba(255,255,255,0.25)" : "rgba(0,0,0,0.25)"}`,
          }}
        >
          {text}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const BoldTemplate: React.FC<CompositionProps> = ({ spec }) => {
  const { durationInFrames } = useVideoConfig();
  useFonts([spec.brand.font, spec.caption_style.font]);
  const cta = useCtaWindow(spec.brand.cta_text);
  const captionFrames = cta ? cta.from : durationInFrames;

  return (
    <AbsoluteFill style={{ backgroundColor: spec.brand.primary_color }}>
      {spec.clips.length > 0 ? <ClipTrack clips={spec.clips} ambientGainDb={spec.audio.ambient_gain_db} filmLook={spec.film_look} zoom={0.08} /> : null}
      <AbsoluteFill style={{ background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,0.55) 100%)" }} />
      {captionFrames > 0 ? (
        <Sequence durationInFrames={captionFrames} name="captions">
          <Captions words={spec.words} style={spec.caption_style} sizeMultiplier={1.15} highlight="box" language={spec.language} />
        </Sequence>
      ) : null}
      <Logo src={spec.brand.logo_path} corner="top-left" size={0.12} opacity={1} />
      <ProgressBar color={spec.brand.accent_color} />
      {cta ? (
        <Sequence from={cta.from} durationInFrames={cta.frames} name="cta">
          <CtaSlam brand={spec.brand} text={spec.brand.cta_text ?? ""} />
        </Sequence>
      ) : null}
      <Soundtrack audio={spec.audio} />
    </AbsoluteFill>
  );
};
