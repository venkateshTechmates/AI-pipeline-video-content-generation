/** Registers the procedural `scene` composition. */
import React from "react";
import { Composition, type CalculateMetadataFunction } from "remotion";
import { SceneComposition } from "./Scene";
import { SCENE_FPS, sceneSchema, type SceneProps } from "./schema";

const calculateMetadata: CalculateMetadataFunction<SceneProps> = ({ props }) => {
  const p = sceneSchema.parse(props);
  // even dimensions keep yuv420p encoders happy
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  return {
    width: even(p.width),
    height: even(p.height),
    fps: SCENE_FPS,
    durationInFrames: Math.max(1, Math.round(p.durationInSeconds * SCENE_FPS)),
    props: p,
  };
};

export const SceneCompositions: React.FC = () => (
  <Composition
    id="scene"
    component={SceneComposition}
    schema={sceneSchema}
    defaultProps={{
      prompt: "A caped superhero flies over a city at night during a thunderstorm, lightning flashing",
      seed: 1,
      durationInSeconds: 5,
      width: 540,
      height: 960,
    } satisfies SceneProps}
    calculateMetadata={calculateMetadata}
    fps={SCENE_FPS}
    width={540}
    height={960}
    durationInFrames={150}
  />
);
