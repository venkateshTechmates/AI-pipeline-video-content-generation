/**
 * Prompt → scene description. Pure keyword matching (case-insensitive, with
 * synonyms); anything the prompt doesn't pin down is filled from per-character
 * defaults and then from the seed, so every prompt yields a sensible scene.
 * Browser- and Node-safe (no React, no Remotion imports).
 */

export const CHARACTERS = [
  "hero", "heroine", "person", "lion", "fox", "owl", "eagle", "wolf", "cat", "dog", "rabbit",
  "bear", "elephant", "whale", "fish", "dolphin", "penguin", "butterfly", "deer",
] as const;
export type CharacterId = (typeof CHARACTERS)[number];

export const SETTINGS = [
  "city", "rooftops", "forest", "savanna", "meadow", "mountains", "ice", "ocean", "underwater",
  "sky", "space", "hospital", "lab", "power",
] as const;
export type SettingId = (typeof SETTINGS)[number];

export type TimeOfDay = "day" | "sunrise" | "sunset" | "night";
export type Weather = "clear" | "storm" | "rain" | "snow" | "fog";
export type Action =
  | "idle" | "walk" | "run" | "fly" | "hover" | "land" | "roar" | "howl" | "jump" | "swim"
  | "zap" | "gesture" | "graze" | "flap" | "spout";
export type Effect = "lightning" | "sparks" | "aura" | "rain" | "snow" | "fireflies" | "dust" | "flare" | "rays" | "bubbles";
export type CameraMove = "push" | "pan" | "drift" | "pull";
export type Role = "nurse" | "doctor" | "scientist" | "kid" | "worker" | "civilian";
export type Gender = "f" | "m";

export type SceneSpec = {
  character: CharacterId;
  role: Role;
  gender: Gender;
  count: number;
  setting: SettingId;
  time: TimeOfDay;
  weather: Weather;
  action: Action;
  effects: Effect[];
  camera: CameraMove;
  color: string | null;
  /** Which prompt words drove each choice (null = default / seed). */
  matched: Partial<Record<"character" | "setting" | "time" | "weather" | "action" | "count", string | null>>;
};

// ---------------------------------------------------------------------------
// Keyword tables. Each entry is a list of regex fragments matched on word
// boundaries against the lower-cased prompt.

const CHARACTER_WORDS: [CharacterId | Role, string[]][] = [
  ["heroine", ["super ?heroines?", "heroines?", "super ?woman", "super ?girl", "wonder ?woman", "female (?:super)?hero"]],
  ["hero", ["super ?heroe?s?", "heroe?s?", "caped", "cape", "vigilante", "crusader", "super ?man", "champion", "avenger"]],
  ["nurse", ["nurses?"]],
  ["doctor", ["doctors?", "physician", "surgeon", "medic"]],
  ["scientist", ["scientists?", "researcher", "chemist", "engineer", "inventor", "professor"]],
  ["kid", ["kids?", "child", "children", "boy", "girl", "toddler", "student"]],
  ["worker", ["workers?", "technician", "electrician", "mechanic", "builder"]],
  ["civilian", ["person", "people", "man", "woman", "guy", "lady", "someone", "character", "teacher", "mother", "father", "mom", "dad", "friend", "villager", "traveller", "traveler", "hiker"]],
  ["lion", ["lions?", "lioness", "king of the jungle"]],
  ["fox", ["fox(?:es)?", "vixen"]],
  ["owl", ["owls?", "owlet"]],
  ["eagle", ["eagles?", "hawks?", "falcons?", "birds?", "raptor", "condor", "seagulls?", "gulls?", "crows?", "ravens?", "dove"]],
  ["wolf", ["wol(?:f|ves)", "wolf ?pack", "coyotes?", "husky"]],
  ["cat", ["cats?", "kitten", "kitty", "tabby", "feline"]],
  ["dog", ["dogs?", "puppy", "puppies", "pup", "hound", "doggo", "retriever", "labrador", "corgi"]],
  ["rabbit", ["rabbits?", "bunn(?:y|ies)", "hares?"]],
  ["bear", ["bears?", "grizzly", "cub"]],
  ["elephant", ["elephants?", "calf", "mammoth"]],
  ["whale", ["whales?", "humpback", "orca"]],
  ["fish", ["fish(?:es)?", "school of", "shoal", "salmon", "tuna", "clownfish", "goldfish"]],
  ["dolphin", ["dolphins?", "porpoises?"]],
  ["penguin", ["penguins?"]],
  ["butterfly", ["butterfl(?:y|ies)", "moths?"]],
  ["deer", ["deer", "stag", "doe", "fawn", "elk", "reindeer", "antelope", "gazelle"]],
];

const SETTING_WORDS: [SettingId, string[]][] = [
  ["power", ["generators?", "power ?(?:station|plant|grid|lines?)", "substation", "turbines?", "reactor", "transformer", "electrical", "factory", "machine room"]],
  ["hospital", ["hospital", "ward", "clinic", "emergency room", "er", "icu", "medical", "patients?"]],
  ["lab", ["lab", "laboratory", "experiment", "research", "science"]],
  ["rooftops", ["roofs?", "rooftops?", "roof ?top"]],
  ["underwater", ["underwater", "under the sea", "under water", "reef", "coral", "deep sea", "deep ocean", "seabed", "ocean floor", "abyss", "deep blue"]],
  ["ocean", ["oceans?", "seas?", "waves?", "beach", "surf", "bay", "harbou?r", "coast", "shore", "water"]],
  ["space", ["space", "outer space", "galaxy", "galax(?:y|ies)", "nebula", "planets?", "orbit", "cosmos", "universe", "asteroids?", "moon ?base"]],
  ["ice", ["ice", "icy", "arctic", "antarctic(?:a)?", "glaciers?", "tundra", "iceberg", "polar", "frozen"]],
  ["mountains", ["mountains?", "peaks?", "cliffs?", "alps", "summit", "canyon", "valley", "ridge", "highlands?"]],
  ["savanna", ["savann?ah?", "grasslands?", "plains?", "prairie", "africa", "desert", "safari", "dunes?"]],
  ["meadow", ["meadows?", "fields?", "park", "garden", "hills?", "countryside", "farm", "flowers?", "backyard", "lawn"]],
  ["forest", ["forests?", "woods?", "woodland", "trees?", "jungle", "grove", "branch", "rainforest", "pines?", "clearing"]],
  ["city", ["city", "cities", "streets?", "downtown", "skyline", "town", "buildings?", "skyscrapers?", "metropolis", "urban", "traffic", "alley"]],
  ["sky", ["sky", "skies", "clouds?", "air", "heavens?", "above the clouds"]],
];

const TIME_WORDS: [TimeOfDay, string[]][] = [
  ["sunrise", ["sunrise", "dawn", "daybreak", "morning", "sun ?rise", "first light"]],
  ["sunset", ["sunset", "dusk", "evening", "twilight", "golden hour", "sundown", "sun ?set"]],
  ["night", ["night", "nighttime", "midnight", "moon", "moonlit", "moonlight", "dark", "darkness", "starry", "stars", "nocturnal"]],
  ["day", ["day", "daytime", "noon", "sunny", "afternoon", "daylight", "bright", "sunshine", "sun"]],
];

const WEATHER_WORDS: [Weather, string[]][] = [
  ["storm", ["thunder ?storms?", "storms?", "stormy", "thunder", "lightning", "tempest", "hurricane", "typhoon"]],
  ["snow", ["snow", "snowy", "snowing", "snowfall", "blizzard", "winter", "snowflakes?", "wintry"]],
  ["rain", ["rain", "rains", "raining", "rainy", "downpour", "drizzle", "showers?", "wet"]],
  ["fog", ["fog", "foggy", "mist", "misty", "haze", "hazy"]],
];

const ACTION_WORDS: [Action, string[]][] = [
  ["zap", ["sparks?", "sparking", "electric(?:ity|al)?", "electrified", "arcs?", "arcing", "volts?", "shock(?:ed|s)?", "zaps?", "zapping", "charged?", "press(?:es|ing)?", "touch(?:es|ing)?", "crawl"]],
  ["land", ["lands", "landing", "land on", "touch(?:es)? down", "descends?", "descending", "drops? down", "crash(?:es)? down"]],
  ["hover", ["hover(?:s|ing)?", "floats?", "floating", "levitat(?:e|es|ing)", "suspended", "stands? in the air"]],
  ["fly", ["fl(?:y|ies|ying|ew)", "flight", "soar(?:s|ing)?", "glid(?:e|es|ing)", "swoops?", "zooms?", "flutter(?:s|ing)?", "wings?"]],
  ["roar", ["roar(?:s|ing)?", "growl(?:s|ing)?", "snarl(?:s|ing)?", "bellow(?:s|ing)?"]],
  ["howl", ["howl(?:s|ing)?", "bay(?:s|ing)? at"]],
  ["spout", ["spout(?:s|ing)?", "blow(?:s|ing)? water", "surfac(?:e|es|ing)", "breath(?:es|ing)?"]],
  ["jump", ["jump(?:s|ing)?", "leap(?:s|ing|t)?", "hop(?:s|ping)?", "bounc(?:e|es|ing)", "breach(?:es|ing)?", "pounc(?:e|es|ing)", "spring(?:s|ing)?"]],
  ["swim", ["swim(?:s|ming)?", "swam", "dive(?:s)?", "diving", "drift(?:s|ing)?"]],
  ["graze", ["graz(?:e|es|ing)", "eat(?:s|ing)?", "feed(?:s|ing)?", "nibbl(?:e|es|ing)", "drink(?:s|ing)?"]],
  ["run", ["run(?:s|ning)?", "ran", "trot(?:s|ting)?", "gallop(?:s|ing)?", "sprint(?:s|ing)?", "dash(?:es|ing)?", "chas(?:e|es|ing)", "race(?:s)?", "racing", "charg(?:es|ing)"]],
  ["walk", ["walk(?:s|ing)?", "stroll(?:s|ing)?", "wander(?:s|ing)?", "strid(?:e|es|ing)", "waddl(?:e|es|ing)", "march(?:es|ing)?", "patrol(?:s|ling)?", "roam(?:s|ing)?", "prowl(?:s|ing)?", "stalk(?:s|ing)?", "through", "across"]],
  ["gesture", ["wav(?:e|es|ing)", "point(?:s|ing)?", "talk(?:s|ing)?", "explain(?:s|ing)?", "present(?:s|ing)?", "speak(?:s|ing)?", "greet(?:s|ing)?", "teach(?:es|ing)?", "calls?"]],
  ["flap", ["flap(?:s|ping)?", "spread(?:s|ing)? (?:its|her|his) wings"]],
  ["idle", ["sit(?:s|ting)?", "rest(?:s|ing)?", "perch(?:es|ed|ing)?", "blink(?:s|ing)?", "watch(?:es|ing)?", "look(?:s|ing)?", "stand(?:s|ing)?", "sleep(?:s|ing)?", "waits?", "stares?", "gaz(?:e|es|ing)"]],
];

const COUNT_WORDS: [number, string[]][] = [
  [3, ["three", "3", "several", "many", "a group of", "a pod of", "a school of", "a pack of", "a flock of", "a herd of", "family of", "pod", "herd", "flock", "pack", "crowd"]],
  [2, ["two", "2", "pair of", "couple of", "both", "twins?"]],
];

const COLOR_WORDS = ["red", "orange", "yellow", "gold(?:en)?", "green", "blue", "purple", "violet", "pink", "white", "black", "silver", "gr[ae]y", "brown", "crimson", "teal", "arctic", "snowy"];

const FEMALE = /\b(she|her|hers|herself|woman|women|girl|lady|female|heroine|mother|mom|queen|sister|wife|nurse(?!s? (?:he|his)))\b/;
const MALE = /\b(he|him|his|himself|man|men|boy|guy|male|father|dad|king|brother|husband)\b/;

// ---------------------------------------------------------------------------

type Match<T> = { value: T; word: string; index: number };

const compile = (frag: string): RegExp => new RegExp(`(?:^|[^a-z0-9])(${frag})(?=$|[^a-z0-9])`, "i");

const TABLE_CACHE = new Map<unknown, [unknown, RegExp[]][]>();
const compiled = <T,>(table: [T, string[]][]): [T, RegExp[]][] => {
  let c = TABLE_CACHE.get(table);
  if (!c) {
    c = table.map(([v, words]) => [v, words.map(compile)]);
    TABLE_CACHE.set(table, c);
  }
  return c as [T, RegExp[]][];
};

/** Every match of every entry, earliest first (ties: table order). */
const findAll = <T,>(text: string, table: [T, string[]][]): Match<T>[] => {
  const out: Match<T>[] = [];
  compiled(table).forEach(([value, res], order) => {
    for (const re of res) {
      const m = re.exec(text);
      if (m) {
        out.push({ value, word: m[1]!, index: m.index + (m[0].length - m[1]!.length) + order * 1e-4 });
        break;
      }
    }
  });
  return out.sort((a, b) => a.index - b.index);
};
const first = <T,>(text: string, table: [T, string[]][]): Match<T> | null => findAll(text, table)[0] ?? null;

/** Deterministic 0..1 hash (FNV-1a), so the parser has no Remotion dependency. */
const hash01 = (s: string): number => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
};
const choose = <T,>(seed: number, key: string, arr: readonly T[]): T => arr[Math.floor(hash01(`${seed}:${key}`) * arr.length) % arr.length]!;

// ---------------------------------------------------------------------------
// Per-character knowledge.

type CharInfo = { actions: Action[]; settings: SettingId[]; times?: TimeOfDay[]; aquatic?: boolean; airborne?: boolean };
export const CHARACTER_INFO: Record<CharacterId, CharInfo> = {
  hero: { actions: ["hover", "fly", "land", "zap", "idle"], settings: ["city", "rooftops", "sky"] },
  heroine: { actions: ["hover", "fly", "land", "zap", "idle"], settings: ["city", "rooftops", "sky"] },
  person: { actions: ["walk", "gesture", "zap", "idle"], settings: ["city", "meadow"] },
  lion: { actions: ["roar", "walk", "idle"], settings: ["savanna"], times: ["sunset", "day", "sunrise"] },
  fox: { actions: ["run", "walk", "idle"], settings: ["forest", "meadow"] },
  owl: { actions: ["idle", "flap", "fly"], settings: ["forest"], times: ["night"] },
  eagle: { actions: ["fly"], settings: ["mountains", "sky"], airborne: true },
  wolf: { actions: ["howl", "run", "idle"], settings: ["mountains", "forest"], times: ["night"] },
  cat: { actions: ["idle", "walk"], settings: ["rooftops", "city"] },
  dog: { actions: ["run", "idle", "walk"], settings: ["meadow", "city"], times: ["day", "sunset"] },
  rabbit: { actions: ["jump", "idle"], settings: ["meadow", "forest"], times: ["day", "sunrise"] },
  bear: { actions: ["walk", "idle", "roar"], settings: ["forest", "mountains"] },
  elephant: { actions: ["walk", "idle"], settings: ["savanna"], times: ["day", "sunset"] },
  whale: { actions: ["swim", "spout"], settings: ["underwater", "ocean"], aquatic: true },
  fish: { actions: ["swim"], settings: ["underwater"], aquatic: true },
  dolphin: { actions: ["jump", "swim"], settings: ["ocean", "underwater"], aquatic: true },
  penguin: { actions: ["walk", "idle", "jump"], settings: ["ice"], times: ["day", "sunset"] },
  butterfly: { actions: ["fly"], settings: ["meadow", "forest"], times: ["day", "sunrise"], airborne: true },
  deer: { actions: ["graze", "jump", "walk", "idle"], settings: ["forest", "meadow"] },
};

/** When a character can't do the requested action, the closest one it can. */
const ACTION_FALLBACK: Partial<Record<Action, Action[]>> = {
  run: ["walk", "jump", "fly", "swim"],
  walk: ["run", "idle", "swim", "fly"],
  fly: ["jump", "hover", "run", "swim"],
  hover: ["fly", "idle"],
  land: ["hover", "jump"],
  jump: ["run", "fly", "swim"],
  swim: ["jump", "fly", "run"],
  roar: ["howl", "idle"],
  howl: ["roar", "idle"],
  zap: ["hover", "gesture"],
  gesture: ["idle"],
  graze: ["idle"],
  flap: ["fly", "idle"],
  spout: ["swim", "jump"],
};

/** Curated combinations used when a prompt names no subject at all. */
const PRESETS: [CharacterId, SettingId, TimeOfDay, Weather][] = [
  ["hero", "city", "night", "storm"],
  ["heroine", "rooftops", "sunrise", "clear"],
  ["lion", "savanna", "sunset", "clear"],
  ["fox", "forest", "day", "snow"],
  ["owl", "forest", "night", "clear"],
  ["whale", "underwater", "day", "clear"],
  ["eagle", "mountains", "sunrise", "clear"],
  ["dolphin", "ocean", "sunset", "clear"],
  ["deer", "meadow", "sunrise", "fog"],
  ["wolf", "mountains", "night", "snow"],
  ["butterfly", "meadow", "day", "clear"],
  ["elephant", "savanna", "day", "clear"],
  ["penguin", "ice", "day", "snow"],
  ["cat", "rooftops", "night", "clear"],
];

const OUTDOOR_TIME_DEFAULT: Record<SettingId, TimeOfDay[]> = {
  city: ["night", "sunset", "day"],
  rooftops: ["sunrise", "night", "sunset"],
  forest: ["day", "sunset", "night"],
  savanna: ["sunset", "day"],
  meadow: ["day", "sunrise"],
  mountains: ["sunrise", "day", "sunset"],
  ice: ["day", "sunset"],
  ocean: ["day", "sunset", "sunrise"],
  underwater: ["day"],
  sky: ["sunrise", "day", "sunset"],
  space: ["night"],
  hospital: ["day"],
  lab: ["day"],
  power: ["night"],
};

export const INDOOR: SettingId[] = ["hospital", "lab", "power"];

export const parsePrompt = (promptRaw: string, seed: number): SceneSpec => {
  const text = ` ${promptRaw.toLowerCase().replace(/[’']/g, "'")} `;
  const matched: SceneSpec["matched"] = {};

  // ---- character
  const charMatch = first(text, CHARACTER_WORDS);
  let character: CharacterId;
  let role: Role = "civilian";
  const presetIdx = Math.floor(hash01(`${seed}:preset`) * PRESETS.length) % PRESETS.length;
  const preset = PRESETS[presetIdx]!;
  if (charMatch) {
    matched.character = charMatch.word;
    const v = charMatch.value;
    if (v === "nurse" || v === "doctor" || v === "scientist" || v === "kid" || v === "worker" || v === "civilian") {
      character = "person";
      role = v;
    } else character = v;
  } else {
    matched.character = null;
    character = preset[0];
    // No subject named: pick one that lives in the named setting, if any.
    const sm0 = first(text, SETTING_WORDS);
    if (sm0) {
      const fits = CHARACTERS.filter((c) => CHARACTER_INFO[c].settings.includes(sm0.value));
      if (fits.length) character = choose(seed, "fit", fits);
      else if (INDOOR.includes(sm0.value)) { character = "person"; role = sm0.value === "hospital" ? "nurse" : sm0.value === "lab" ? "scientist" : "worker"; }
    }
  }
  // "hero" + female pronouns → heroine
  const female = FEMALE.test(text);
  const male = MALE.test(text);
  if (character === "hero" && female && !male) character = "heroine";
  const gender: Gender =
    character === "heroine" ? "f" : character === "hero" ? "m" : female && !male ? "f" : male && !female ? "m" : role === "nurse" ? "f" : choose(seed, "gender", ["f", "m"] as const);

  const info = CHARACTER_INFO[character];

  // ---- setting
  const settingMatches = findAll(text, SETTING_WORDS);
  let setting: SettingId;
  // prefer an explicit setting the character can plausibly be in, else the first one
  const sm = settingMatches[0];
  if (sm) {
    setting = sm.value;
    matched.setting = sm.word;
    // "hero above rooftops over a city" → rooftops beats city if both
    if (settingMatches.some((m) => m.value === "rooftops")) setting = "rooftops";
    if (settingMatches.some((m) => m.value === "power") && (setting === "city" || setting === "hospital")) setting = "power";
  } else {
    matched.setting = null;
    setting = charMatch ? choose(seed, "setting", info.settings) : preset[1];
    if (character === "person") setting = role === "nurse" || role === "doctor" ? "hospital" : role === "scientist" ? "lab" : role === "worker" ? "power" : choose(seed, "psetting", ["city", "meadow"] as const);
  }
  // Aquatic animals live in water; land animals don't go underwater.
  if (info.aquatic && !["ocean", "underwater"].includes(setting)) setting = info.settings[0]!;
  if (!info.aquatic && setting === "underwater" && character !== "hero" && character !== "heroine") setting = "ocean";
  if ((character === "whale" || character === "fish") && setting === "ocean" && !/\b(surface|spouts?|breach|waves?|above)\b/.test(text)) setting = "underwater";
  if (character === "dolphin" && setting === "underwater" && /\b(jump|jumps|leap|leaps|waves?|out of)\b/.test(text)) setting = "ocean";

  // ---- weather
  const wm = first(text, WEATHER_WORDS);
  let weather: Weather = wm ? wm.value : "clear";
  matched.weather = wm ? wm.word : null;
  if (!wm && !charMatch) weather = preset[3];
  if (setting === "space" || setting === "underwater" || INDOOR.includes(setting)) weather = "clear";

  // ---- time
  const tm = findAll(text, TIME_WORDS).find((m) => !(setting === "space" && m.value === "night")) ?? null;
  let time: TimeOfDay;
  if (tm) {
    time = tm.value;
    matched.time = tm.word;
  } else {
    matched.time = null;
    const opts = info.times ?? OUTDOOR_TIME_DEFAULT[setting];
    time = !charMatch && !sm ? preset[2] : choose(seed, "time", opts.filter((t) => OUTDOOR_TIME_DEFAULT[setting].includes(t)).length ? opts.filter((t) => OUTDOOR_TIME_DEFAULT[setting].includes(t)) : opts);
    if (weather === "storm") time = "night";
  }
  if (setting === "space") time = "night";
  if (setting === "underwater" || INDOOR.includes(setting)) time = setting === "power" && time !== "day" ? "night" : "day";

  // ---- action
  const am = findAll(text, ACTION_WORDS).find((m) => !(m.value === "fly" && character === "person")) ?? null;
  let action: Action = info.actions[0]!;
  if (am) {
    matched.action = am.word;
    // A few specific verbs outrank generic movement words ("flies over", "walks through").
    const all = findAll(text, ACTION_WORDS).map((m) => m.value);
    let want = am.value;
    const priority: Action[] = ["zap", "land", "roar", "howl", "spout", "graze", "jump", "hover", "fly", "swim", "run", "walk", "gesture", "flap", "idle"];
    for (const p of priority) if (all.includes(p) && info.actions.includes(p)) { want = p; break; }
    if (info.actions.includes(want)) action = want;
    else action = (ACTION_FALLBACK[want] ?? []).find((a) => info.actions.includes(a)) ?? info.actions[0]!;
  } else matched.action = null;
  // Superheroes: "glowing" alone means hovering with an aura.
  if ((character === "hero" || character === "heroine") && !am) action = setting === "sky" ? "fly" : choose(seed, "heroact", ["hover", "fly"] as const);

  // ---- count
  const cm = first(text, COUNT_WORDS);
  let count = cm ? cm.value : 1;
  matched.count = cm ? cm.word : null;
  // Plural subject ("dolphins", "butterflies") → a small group.
  if (!cm && charMatch && /[^s]s$/.test(charMatch.word) && character !== "person") count = 3;
  if (character === "fish") count = 1; // one school of many fish
  if (["hero", "heroine", "person", "elephant", "whale", "bear"].includes(character)) count = Math.min(count, 2);

  // ---- colour hint
  let color: string | null = null;
  for (const c of COLOR_WORDS) {
    const m = compile(c).exec(text);
    if (m) {
      color = m[1]!.replace(/^gold(en)?$/, "gold").replace("grey", "gray");
      break;
    }
  }

  // ---- effects
  const effects = new Set<Effect>();
  const has = (re: RegExp) => re.test(text);
  if (weather === "storm") { effects.add("rain"); effects.add("lightning"); }
  if (weather === "rain") effects.add("rain");
  if (weather === "snow") effects.add("snow");
  if (has(/\blightning|thunder|bolts?\b/) && setting !== "underwater") effects.add("lightning");
  if (action === "zap" || has(/\b(spark\w*|electric\w*|arcs?|volts?|zap\w*|shock\w*)\b/)) effects.add("sparks");
  if (has(/\b(glow\w*|energy|aura|radiant|shin(?:e|es|ing)|powers?(?! ?(?:station|plant|grid|lines?))|power(?:ful|ed)|charged|blaz\w*|luminous)\b/)) effects.add("aura");
  if (has(/\bfireflies|firefly|fairy lights|glowing bugs\b/) || ((setting === "forest" || setting === "meadow") && time === "night" && weather !== "snow" && weather !== "rain" && weather !== "storm")) effects.add("fireflies");
  if (setting === "underwater") { effects.add("rays"); effects.add("bubbles"); }
  if (has(/\b(light ?rays?|rays|sun ?beams?|god ?rays|beams? of light|shafts? of light)\b/)) effects.add("rays");
  if (has(/\bbubbles?\b/)) effects.add("bubbles");
  if (!INDOOR.includes(setting) && setting !== "underwater" && setting !== "space" && time !== "night" && weather === "clear") effects.add("flare");
  if (setting === "savanna" || INDOOR.includes(setting) || action === "land" || (setting === "forest" && time !== "night" && weather === "clear")) effects.add("dust");

  // ---- camera
  const camOpts: CameraMove[] =
    action === "fly" || action === "run" || action === "walk" || action === "swim" ? ["drift", "pan", "push"] :
    action === "land" ? ["push", "pull"] :
    ["push", "push", "drift", "pan", "pull"];
  const camera = choose(seed, "camera", camOpts);

  return { character, role, gender, count, setting, time, weather, action, effects: [...effects], camera, color, matched };
};
