import { z } from "zod";

export const sceneSchema = z.object({
  prompt: z.string().default(""),
  seed: z.number().int().default(1),
  durationInSeconds: z.number().positive().max(120).default(5),
  width: z.number().int().min(16).max(4096).default(1080),
  height: z.number().int().min(16).max(4096).default(1920),
});
export type SceneProps = z.infer<typeof sceneSchema>;
export const SCENE_FPS = 30;
