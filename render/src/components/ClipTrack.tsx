import React from "react";
import { AbsoluteFill, interpolate, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { dbToGain, type RenderClip } from "../types";

const KenBurns: React.FC<{ src: string; frames: number; zoom: number; volume: number | null; filter?: string }> = ({
  src,
  frames,
  zoom,
  volume,
  filter,
}) => {
  const frame = useCurrentFrame();
  const scale = zoom > 0 ? interpolate(frame, [0, frames], [1, 1 + zoom], { extrapolateRight: "clamp" }) : 1;
  return (
    <AbsoluteFill style={{ transform: `scale(${scale})` }}>
      {/* object-fit: cover makes any source aspect fill the frame (centre crop). */}
      <OffthreadVideo
        src={src}
        muted={volume === null}
        volume={volume ?? 0}
        style={{ width: "100%", height: "100%", objectFit: "cover", filter }}
      />
    </AbsoluteFill>
  );
};

type Props = {
  clips: RenderClip[];
  zoom?: number;
  /** Gain for the clips' own (ambient) audio in dB; null/undefined = muted (VO + music carry the sound). */
  ambientGainDb?: number | null;
  /** "cinematic": subtle contrast/saturation lift and a soft vignette on the footage. */
  filmLook?: "none" | "cinematic";
};

/** Lays the generated shots out on the timeline, with optional ambient audio and film grade. */
export const ClipTrack: React.FC<Props> = ({ clips, zoom = 0, ambientGainDb = null, filmLook = "none" }) => {
  const { fps } = useVideoConfig();
  const volume = ambientGainDb === null || ambientGainDb === undefined ? null : dbToGain(ambientGainDb);
  const filter = filmLook === "cinematic" ? "contrast(1.05) saturate(1.08)" : undefined;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {clips.map((clip, i) => {
        const from = Math.round(clip.start * fps);
        const frames = Math.max(1, Math.round(clip.duration * fps));
        return (
          <Sequence key={`${i}-${clip.path}`} from={from} durationInFrames={frames} name={`clip ${i + 1}`}>
            <KenBurns src={clip.path} frames={frames} zoom={zoom} volume={volume} filter={filter} />
          </Sequence>
        );
      })}
      {filmLook === "cinematic" ? (
        <AbsoluteFill
          style={{
            pointerEvents: "none",
            background: "radial-gradient(ellipse at center, rgba(0,0,0,0) 58%, rgba(0,0,0,0.32) 100%)",
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};
