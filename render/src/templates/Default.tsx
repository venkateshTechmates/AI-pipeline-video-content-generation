import React from "react";
import { AbsoluteFill, interpolate, Sequence, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Captions } from "../components/Captions";
import { ClipTrack } from "../components/ClipTrack";
import { Logo } from "../components/Logo";
import { Soundtrack } from "../components/Soundtrack";
import { useCtaWindow } from "../components/useCta";
import { readableOn, withAlpha } from "../lib/color";
import { fontStack, useFonts } from "../lib/fonts";
import type { BrandOverlay, CompositionProps } from "../types";

/** Lower-third card that springs up from the bottom over a dimmed frame. */
const CtaCard: React.FC<{ brand: BrandOverlay; text: string }> = ({ brand, text }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const short = Math.min(width, height);
  const enter = spring({ frame, fps, config: { damping: 200 } });
  const textColor = readableOn(brand.primary_color);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: `rgba(0,0,0,${interpolate(enter, [0, 1], [0, 0.45])})`,
        justifyContent: "flex-end",
        alignItems: "center",
        paddingBottom: height * (height > width ? 0.2 : 0.12),
      }}
    >
      <div
        style={{
          transform: `translateY(${interpolate(enter, [0, 1], [height * 0.2, 0])}px)`,
          opacity: enter,
          maxWidth: width * 0.84,
          padding: `${short * 0.04}px ${short * 0.06}px`,
          borderRadius: short * 0.035,
          backgroundColor: brand.primary_color,
          borderBottom: `${short * 0.012}px solid ${brand.accent_color}`,
          boxShadow: `0 ${short * 0.02}px ${short * 0.06}px ${withAlpha("#000000", 0.4)}`,
          color: textColor,
          fontFamily: fontStack(brand.font),
          fontWeight: 800,
          fontSize: short * 0.068,
          lineHeight: 1.15,
          textAlign: "center",
        }}
      >
        {text}
      </div>
    </AbsoluteFill>
  );
};

export const DefaultTemplate: React.FC<CompositionProps> = ({ spec }) => {
  const { durationInFrames } = useVideoConfig();
  useFonts([spec.brand.font, spec.caption_style.font]);
  const cta = useCtaWindow(spec.brand.cta_text);
  const captionFrames = cta ? cta.from : durationInFrames;

  return (
    <AbsoluteFill style={{ backgroundColor: spec.brand.primary_color }}>
      {spec.clips.length > 0 ? <ClipTrack clips={spec.clips} /> : null}
      <AbsoluteFill
        style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 65%, rgba(0,0,0,0.35) 100%)" }}
      />
      {captionFrames > 0 ? (
        <Sequence durationInFrames={captionFrames} name="captions">
          <Captions words={spec.words} style={spec.caption_style} language={spec.language} />
        </Sequence>
      ) : null}
      <Logo src={spec.brand.logo_path} corner="top-right" />
      {cta ? (
        <Sequence from={cta.from} durationInFrames={cta.frames} name="cta">
          <CtaCard brand={spec.brand} text={spec.brand.cta_text ?? ""} />
        </Sequence>
      ) : null}
      <Soundtrack audio={spec.audio} />
    </AbsoluteFill>
  );
};
