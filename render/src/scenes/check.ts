/** `npm run scene:check` — prints the parsed scene for sample prompts and sanity-checks a few. */
import { parsePrompt, type SceneSpec } from "./parse";

const SAMPLES: [string, Partial<SceneSpec>][] = [
  ["A caped superhero flies over a city at night during a thunderstorm, lightning flashing", { character: "hero", setting: "city", time: "night", weather: "storm", action: "fly" }],
  ["A nurse presses her hands on a generator and electric sparks crawl up her arms", { character: "person", role: "nurse", setting: "power", action: "zap" }],
  ["A glowing hero hovers above rooftops at sunrise", { character: "hero", setting: "rooftops", time: "sunrise", action: "hover" }],
  ["A lion roars on the savanna at sunset", { character: "lion", setting: "savanna", time: "sunset", action: "roar" }],
  ["A red fox trots through a snowy forest", { character: "fox", setting: "forest", weather: "snow", action: "run" }],
  ["An owl blinks on a branch under the moon with fireflies", { character: "owl", setting: "forest", time: "night", action: "idle" }],
  ["A whale swims through deep blue ocean with light rays", { character: "whale", setting: "underwater", action: "swim" }],
  ["An eagle soars over mountains", { character: "eagle", setting: "mountains", action: "fly" }],
  ["A penguin waddles on the ice", { character: "penguin", setting: "ice", action: "walk" }],
  ["Three dolphins jump out of the waves", { character: "dolphin", setting: "ocean", action: "jump", count: 3 }],
  ["A superheroine lands in the street, cape billowing", { character: "heroine", setting: "city", action: "land" }],
  ["A wolf howls at the full moon on a snowy mountain", { character: "wolf", setting: "mountains", time: "night", action: "howl" }],
  ["A doctor explains the results in a hospital corridor", { character: "person", role: "doctor", setting: "hospital", action: "gesture" }],
  ["A scientist in the lab watches monitors blink", { character: "person", role: "scientist", setting: "lab" }],
  ["A bunny hops across a flower meadow in the morning", { character: "rabbit", setting: "meadow", time: "sunrise", action: "jump" }],
  ["Butterflies flutter over the garden", { character: "butterfly", setting: "meadow", action: "fly" }],
  ["An elephant flaps its ears in the dusty plains", { character: "elephant", setting: "savanna" }],
  ["The quarterly revenue grew by 20 percent", {}],
  ["Why sleep matters for your brain", {}],
];

let failures = 0;
for (const [prompt, expect] of SAMPLES) {
  const spec = parsePrompt(prompt, 7);
  const bad = Object.entries(expect).filter(([k, v]) => (spec as Record<string, unknown>)[k] !== v);
  if (bad.length) failures++;
  const { matched, ...rest } = spec;
  console.log(`${bad.length ? "FAIL" : "ok  "} ${JSON.stringify(prompt)}`);
  console.log(`     ${JSON.stringify(rest)}`);
  console.log(`     matched ${JSON.stringify(matched)}${bad.length ? `  expected ${JSON.stringify(Object.fromEntries(bad))}` : ""}`);
}
// determinism
const a = JSON.stringify(parsePrompt("something vague", 42));
if (a !== JSON.stringify(parsePrompt("something vague", 42))) { console.log("FAIL determinism"); failures++; }
console.log(failures ? `\n${failures} failing sample(s)` : "\nall samples parsed as expected");
process.exit(failures ? 1 : 0);
