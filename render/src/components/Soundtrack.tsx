import React from "react";
import { Audio, interpolate, useVideoConfig } from "remotion";
import { dbToGain, type RenderAudio } from "../types";

const MUSIC_FADE_S = 1.0;

/** Voice-over plus (looped, faded) music bed. Gains come from the spec in dB. */
export const Soundtrack: React.FC<{ audio: RenderAudio }> = ({ audio }) => {
  const { fps, durationInFrames } = useVideoConfig();
  const voiceGain = dbToGain(audio.voice_gain_db);
  const musicGain = dbToGain(audio.music_gain_db);
  const fade = Math.max(1, Math.round(MUSIC_FADE_S * fps));

  return (
    <>
      {audio.voice_path ? <Audio src={audio.voice_path} volume={voiceGain} name="voice" /> : null}
      {audio.music_path ? (
        <Audio
          src={audio.music_path}
          name="music"
          loop
          volume={(f) =>
            musicGain *
            interpolate(f, [0, Math.round(fps * 0.3), durationInFrames - fade, durationInFrames], [0, 1, 1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })
          }
        />
      ) : null}
    </>
  );
};
