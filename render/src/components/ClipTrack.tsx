import React from "react";
import { AbsoluteFill, interpolate, OffthreadVideo, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { RenderClip } from "../types";

const KenBurns: React.FC<{ src: string; frames: number; zoom: number }> = ({ src, frames, zoom }) => {
  const frame = useCurrentFrame();
  const scale = zoom > 0 ? interpolate(frame, [0, frames], [1, 1 + zoom], { extrapolateRight: "clamp" }) : 1;
  return (
    <AbsoluteFill style={{ transform: `scale(${scale})` }}>
      {/* object-fit: cover makes any source aspect fill the frame (centre crop). */}
      <OffthreadVideo src={src} muted style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </AbsoluteFill>
  );
};

/** Lays the generated shots out on the timeline. Clip audio is muted: VO + music carry the sound. */
export const ClipTrack: React.FC<{ clips: RenderClip[]; zoom?: number }> = ({ clips, zoom = 0 }) => {
  const { fps } = useVideoConfig();
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      {clips.map((clip, i) => {
        const from = Math.round(clip.start * fps);
        const frames = Math.max(1, Math.round(clip.duration * fps));
        return (
          <Sequence key={`${i}-${clip.path}`} from={from} durationInFrames={frames} name={`clip ${i + 1}`}>
            <KenBurns src={clip.path} frames={frames} zoom={zoom} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
