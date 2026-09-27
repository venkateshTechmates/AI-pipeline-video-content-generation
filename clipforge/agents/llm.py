"""LLM work via Pydantic AI agents (Claude primary, OpenAI fallback) with structured outputs.

`LLM` is the facade used by graph nodes. Every method returns `(output, tokens)`
so the node can charge the cost ledger. `FakeLLM` is deterministic and offline.
"""

from __future__ import annotations

import hashlib
import math
import re
from pathlib import Path
from typing import Protocol

import httpx
from pydantic import BaseModel, Field
from pydantic_ai import Agent, BinaryContent, ModelRetry, RunContext

from ..captions import joiner
from ..config import Settings
from ..languages import get_language, speech_seconds
from ..models import Beat, BrandKit, Hook, Ideas, Platform, Script, ScriptPackage, Shot, ShotList, Tier
from ..platforms import PLATFORM_LIMITS
from ..ratelimit import bucket

WORDS_PER_SECOND = 2.6


# --------------------------------------------------------------------------- outputs


class PlatformCopy(BaseModel):
    platform: Platform
    title: str
    description: str
    hashtags: list[str] = Field(default_factory=list)


class MetadataBundle(BaseModel):
    items: list[PlatformCopy]


class ModerationResult(BaseModel):
    safe: bool
    categories: list[str] = Field(default_factory=list)
    reason: str = ""


class ScriptDeps(BaseModel):
    min_s: int = 30
    max_s: int = 60
    max_clip_seconds: float = 10
    language: str = "en"


class Translation(BaseModel):
    lines: list[str]


class LLMBackend(Protocol):
    async def ideate(self, kit: BrandKit, brief: str | None, avoid: list[str], n: int = 5,
                     language: str = "en") -> tuple[Ideas, int]: ...
    async def script(self, kit: BrandKit, hook: Hook, brief: str | None, tier: Tier,
                     max_clip_seconds: float, language: str = "en") -> tuple[ScriptPackage, int]: ...
    async def metadata(self, kit: BrandKit, script: Script,
                       platforms: list[Platform], language: str = "en") -> tuple[MetadataBundle, int]: ...
    async def translate(self, lines: list[str], source: str, target: str) -> tuple[list[str], int]:
        """Translate subtitle cues line-for-line (same count, same order)."""
        ...
    async def moderate_text(self, text: str, banned: list[str]) -> tuple[ModerationResult, int]: ...
    async def moderate_frames(self, frames: list[Path], banned: list[str]) -> tuple[ModerationResult, int]: ...
    async def embed(self, texts: list[str]) -> list[list[float]]: ...


# --------------------------------------------------------------------------- prompts


def _lang_rule(code: str, what: str) -> str:
    lang = get_language(code)
    if lang.code == "en":
        return ""
    return (f"\nLANGUAGE: write {what} in {lang.name} ({lang.native}), natural and idiomatic for native "
            f"speakers, not a literal translation.")


def _kit_brief(kit: BrandKit) -> str:
    from ..regions import get_region

    region = get_region(kit.region)
    local = (f"Audience location: {region.name}. Make examples, names, places, food, festivals and everyday "
             f"situations locally relevant and culturally appropriate for this audience.\n") if region else ""
    return (
        f"Niche: {kit.niche}\nAudience: {kit.audience}\nTone: {kit.tone}\n{local}"
        f"Banned topics (never touch): {', '.join(kit.banned_topics) or 'none'}\n"
    )


IDEATE_SYS = """You are a short-form video strategist for faceless social content (YouTube Shorts, Reels, TikTok).
Produce scroll-stopping hooks: specific, curiosity-driven, deliverable in 30-60 seconds of narration with
stock-style/generative b-roll (no on-camera presenter, no real people's likeness, no trademarks).
Rank by expected retention; score in [0,1]. Never propose anything on the banned topic list or
anything close to the recent hooks you are given."""

SCRIPT_SYS = """You write narration scripts and shot lists for 9:16 faceless short videos.
Rules:
- Total length {min_s}-{max_s} s. Narration pace ~2.6 words/second, so vo_text has
  {min_w}-{max_w} words and the shot durations sum to (vo words / 2.6) +/- 10%.
- Beats: hook (first 2 s must grab), setup, value..., payoff, cta. vo_text is the beats joined.
- caption_text: the on-screen caption version of vo_text (same words, no stage directions).
- 3-6 shots. Each shot duration <= {max_clip}s unless unavoidable; prefer fewer, longer shots for consistency.
- Shot prompts are for a text/image-to-video model. Write each like a line of a film shot list, 1-2
  sentences: subject and what they do (expressions, small gestures), setting and time of day, camera
  (lens, angle, one movement: slow push-in, handheld follow, low-angle dolly, static close-up), lighting
  and mood; vertical 9:16 framing; the same characters, wardrobe and palette in every shot.
- No on-screen text, logos, watermarks, real people, celebrities or brands in shot prompts.
- mood: one or two words for music selection (e.g. "upbeat", "cinematic tension", "lofi calm")."""

METADATA_SYS = """You write platform-native post copy for short-form videos. Respect each platform's limits
exactly, lead with the hook, and include relevant hashtags (no '#' in the list items). Never make claims the
script does not make. Title is used for YouTube; for other platforms it is a short internal label."""

MODERATION_SYS = """You are a content safety reviewer for brand-safe social video. Flag: sexual content, violence/
gore, hate/harassment, self-harm, dangerous/illegal activity, medical/financial misinformation, real-person
likeness or deepfake risk, trademark/logo misuse, and anything matching the brand's banned topics.
Return safe=false with categories and a short reason if any apply."""


class LLM:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.model = self._model(settings.llm_model, settings.llm_fallback_model)
        self.vision_model = self._model(settings.vision_model, settings.llm_fallback_model)

    def _model(self, primary: str, fallback: str):
        from pydantic_ai.models.fallback import FallbackModel

        avail = [m for m in (self._build(primary), self._build(fallback)) if m is not None]
        if not avail:
            raise RuntimeError("no LLM configured (ANTHROPIC_API_KEY / OPENAI_API_KEY / OPENROUTER_API_KEY)")
        return avail[0] if len(avail) == 1 else FallbackModel(*avail)

    def _build(self, spec: str):
        """`provider:model` -> model instance using keys from Settings (so keys in .env work too)."""
        prov, _, name = spec.partition(":")
        s = self.settings
        if prov == "anthropic" and s.anthropic_api_key:
            from pydantic_ai.models.anthropic import AnthropicModel
            from pydantic_ai.providers.anthropic import AnthropicProvider

            return AnthropicModel(name, provider=AnthropicProvider(api_key=s.anthropic_api_key))
        if prov == "openai" and s.openai_api_key:
            from pydantic_ai.models.openai import OpenAIChatModel
            from pydantic_ai.providers.openai import OpenAIProvider

            return OpenAIChatModel(name, provider=OpenAIProvider(api_key=s.openai_api_key))
        if prov == "openrouter" and s.openrouter_api_key:
            from pydantic_ai.models.openrouter import OpenRouterModel
            from pydantic_ai.providers.openrouter import OpenRouterProvider

            return OpenRouterModel(name, provider=OpenRouterProvider(api_key=s.openrouter_api_key))
        return None

    @staticmethod
    def _tokens(result) -> int:
        u = result.usage()
        return int((u.input_tokens or 0) + (u.output_tokens or 0))

    async def ideate(self, kit, brief, avoid, n=5, language="en"):
        agent = Agent(self.model, output_type=Ideas, system_prompt=IDEATE_SYS, retries=2)
        await bucket("anthropic").acquire()
        prompt = (f"{_kit_brief(kit)}\nBrief: {brief or 'pick the best topic for this niche today'}\n"
                  f"Recent hooks to avoid (last 90 days):\n- " + "\n- ".join(avoid[-60:] or ["(none)"])
                  + f"\n\nReturn exactly {n} ranked hooks." + _lang_rule(language, "the hook texts"))
        r = await agent.run(prompt)
        return r.output, self._tokens(r)

    async def script(self, kit, hook, brief, tier, max_clip_seconds, language="en"):
        deps = ScriptDeps(max_clip_seconds=max_clip_seconds, language=language)
        sys = SCRIPT_SYS.format(min_s=deps.min_s, max_s=deps.max_s, min_w=int(deps.min_s * WORDS_PER_SECOND),
                                max_w=int(deps.max_s * WORDS_PER_SECOND), max_clip=max_clip_seconds)
        agent = Agent(self.model, output_type=ScriptPackage, system_prompt=sys, deps_type=ScriptDeps, retries=3)

        @agent.output_validator
        def _check(ctx: RunContext[ScriptDeps], out: ScriptPackage) -> ScriptPackage:
            problems = validate_script(out, ctx.deps)
            if problems:
                raise ModelRetry("; ".join(problems))
            return out

        await bucket("anthropic").acquire()
        avoid = ", ".join(kit.negative_prompts)
        prompt = (f"{_kit_brief(kit)}\nVisual style of every shot: {kit.visual_style}. Write shot prompts that "
                  f"fit that style (subjects, wardrobe, setting, lens, light); avoid {avoid}.\n"
                  f"Brief: {brief or '-'}\nHook: {hook.text}\nAngle: {hook.angle}\n"
                  f"Tier: {tier.value} ({'longer single shots allowed' if tier == Tier.premium else 'max 10 s shots'})"
                  + _lang_rule(language, "title, hook, beats, vo_text, caption_text and cta (keep the shot "
                                         "prompts in English for the video model)"))
        r = await agent.run(prompt, deps=deps)
        return r.output, self._tokens(r)

    async def metadata(self, kit, script, platforms, language="en"):
        agent = Agent(self.model, output_type=MetadataBundle, system_prompt=METADATA_SYS, retries=2)
        limits = "\n".join(
            f"- {p.value}: title <= {PLATFORM_LIMITS[p].title} chars, description <= "
            f"{PLATFORM_LIMITS[p].description} chars, <= {PLATFORM_LIMITS[p].hashtags} hashtags" for p in platforms)
        await bucket("anthropic").acquire()
        r = await agent.run(
            f"{_kit_brief(kit)}\nBrand hashtags: {', '.join(kit.hashtags) or '-'}\nTitle: {script.title}\n"
            f"Hook: {script.hook}\nNarration: {script.vo_text}\nCTA: {script.cta}\n\nPlatforms:\n{limits}"
            + _lang_rule(language, "titles, descriptions and hashtags"))
        return r.output, self._tokens(r)

    async def translate(self, lines, source, target):
        src, tgt = get_language(source), get_language(target)
        agent = Agent(self.model, output_type=Translation, retries=3, system_prompt=(
            "You translate short-video subtitle cues. Keep the meaning, tone and brevity of each cue; "
            "return exactly one translated cue per input cue, in the same order."))

        @agent.output_validator
        def _same_len(out: Translation) -> Translation:
            if len(out.lines) != len(lines):
                raise ModelRetry(f"return exactly {len(lines)} lines, got {len(out.lines)}")
            return out

        await bucket("anthropic").acquire()
        numbered = "\n".join(f"{i + 1}. {line}" for i, line in enumerate(lines))
        r = await agent.run(f"From {src.name} to {tgt.name} ({tgt.native}):\n{numbered}")
        return r.output.lines, self._tokens(r)

    async def moderate_text(self, text, banned):
        agent = Agent(self.model, output_type=ModerationResult, system_prompt=MODERATION_SYS, retries=2)
        await bucket("anthropic").acquire()
        r = await agent.run(f"Banned topics: {', '.join(banned) or 'none'}\n\nContent:\n{text}")
        return r.output, self._tokens(r)

    async def moderate_frames(self, frames, banned):
        agent = Agent(self.vision_model, output_type=ModerationResult, system_prompt=MODERATION_SYS, retries=2)
        parts: list = [f"Banned topics: {', '.join(banned) or 'none'}. Review these sampled video frames."]
        parts += [BinaryContent(data=f.read_bytes(), media_type="image/jpeg") for f in frames]
        await bucket("anthropic").acquire()
        r = await agent.run(parts)
        return r.output, self._tokens(r)

    async def embed(self, texts):
        if not self.settings.openai_api_key:
            return [hash_embed(t) for t in texts]
        await bucket("openai").acquire()
        async with httpx.AsyncClient(timeout=60) as c:
            r = await c.post("https://api.openai.com/v1/embeddings",
                             headers={"Authorization": f"Bearer {self.settings.openai_api_key}"},
                             json={"model": self.settings.embedding_model, "input": texts})
            r.raise_for_status()
            return [d["embedding"] for d in r.json()["data"]]


def validate_script(out: ScriptPackage, deps: ScriptDeps) -> list[str]:
    problems = []
    spoken = speech_seconds(out.script.vo_text, deps.language)
    total = out.shot_list.total_duration
    if not deps.min_s <= spoken <= deps.max_s + 2:
        problems.append(f"vo_text reads in ~{spoken:.0f}s; need {deps.min_s}-{deps.max_s}s of narration")
    if abs(total - spoken) > max(4.0, 0.15 * spoken):
        problems.append(f"shot durations sum to {total:.1f}s but narration is ~{spoken:.1f}s")
    if not 3 <= len(out.shot_list.shots) <= 6:
        problems.append("need 3-6 shots")
    return problems


def hash_embed(text: str, dims: int = 256) -> list[float]:
    """Offline embedding: hashed word uni+bigrams, L2-normalised (good enough for near-duplicate hooks)."""
    toks = re.findall(r"[a-z0-9']+", text.lower())
    feats = toks + [f"{a}_{b}" for a, b in zip(toks, toks[1:], strict=False)]
    v = [0.0] * dims
    for f in feats:
        h = int(hashlib.md5(f.encode()).hexdigest(), 16)
        v[h % dims] += 1.0 if (h >> 8) & 1 else -1.0
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


# --------------------------------------------------------------------------- fake


# Canned offline scripts so non-English runs exercise real scripts (tokenising, fonts, speech length).
FAKE_SCRIPTS: dict[str, list[str]] = {
    "es": ["¡Tres hábitos que cambian tus mañanas!", "Casi todos empiezan sin un plan y se cansan rápido.",
           "Primero: empieza más pequeño de lo que crees, y hazlo cada día.",
           "Segundo: mide un solo número, no diez, para ver tu progreso.",
           "Tercero: une el nuevo hábito con algo que ya haces cada mañana.",
           "Hazlo durante dos semanas y dejará de costarte esfuerzo.",
           "Se vuelve parte de quien eres, no algo que te obligas a hacer.",
           "Sígueme para más consejos cortos y prácticos."],
    "hi": ["तीन आदतें जो आपकी सुबह बदल देंगी!", "ज़्यादातर लोग बिना योजना के शुरू करते हैं और जल्दी थक जाते हैं।",
           "पहला: जितना सोचते हैं उससे छोटा शुरू करें, और रोज़ करें।",
           "दूसरा: दस नहीं, सिर्फ़ एक चीज़ मापें, ताकि प्रगति साफ़ दिखे।",
           "तीसरा: नई आदत को किसी ऐसी चीज़ से जोड़ें जो आप हर सुबह करते हैं।",
           "दो हफ़्ते ऐसा करें, फिर यह मेहनत जैसा नहीं लगेगा।",
           "यह आपकी पहचान बन जाती है, कोई मजबूरी नहीं।",
           "ऐसे और आसान सुझावों के लिए फ़ॉलो करें।"],
    "ja": ["朝を変える三つの習慣を、今日から試してみませんか！",
           "多くの人は計画なしに始めて、三日目にはもう疲れてしまいます。",
           "一つ目、思っているよりずっと小さく始めて、それを毎日必ず続けること。",
           "二つ目、十個の目標ではなく一つの数字だけを記録して、進歩をはっきり見えるようにすること。",
           "三つ目、新しい習慣を、毎朝もうしていることと組み合わせること。",
           "これを二週間続ければ、もう努力だとは感じなくなります。",
           "それは無理にやることではなく、あなた自身の一部になっていきます。",
           "もっと短くて役立つコツが欲しい人は、フォローしてね。"],
}


class FakeLLM:
    """Deterministic, schema-valid outputs without network (tests / demos)."""

    def __init__(self, unsafe_words: tuple[str, ...] = ("gore", "nsfw")):
        self.unsafe_words = unsafe_words

    async def ideate(self, kit, brief, avoid, n=5, language="en"):
        topic = brief or kit.niche
        base = [
            f"3 {topic} mistakes everyone makes",
            f"The {topic} trick nobody talks about",
            f"Why your {topic} plan fails in week two",
            f"{topic.capitalize()} in 40 seconds: the only rule you need",
            f"I tried the viral {topic} hack so you don't have to",
            f"The science behind {topic}, explained simply",
        ]
        hooks = [Hook(text=t, angle="listicle", score=round(0.9 - i * 0.07, 2), rationale="fake")
                 for i, t in enumerate(base[: max(n, 1) + 1])]
        return Ideas(hooks=hooks), 0

    async def script(self, kit, hook, brief, tier, max_clip_seconds, language="en"):
        sentences = FAKE_SCRIPTS.get(language) or [
            hook.text + "!",
            "Most people jump in without a plan and burn out fast.",
            "Here is the first fix: start smaller than you think, and make it daily.",
            "Second: track one number, not ten, so progress is obvious.",
            "Third: pair the new habit with something you already do every morning.",
            "Do this for two weeks and it stops feeling like effort.",
            "It becomes who you are, not something you force yourself to do.",
            "Follow for more short, practical tips like this one.",
        ]
        vo = joiner(language).join(sentences)
        spoken = speech_seconds(vo, language)
        n = 4
        per = round(spoken / n, 2)
        shots = [Shot(index=i, prompt=f"Cinematic vertical b-roll {i + 1} about {hook.text}", duration=per)
                 for i in range(n)]
        script = Script(
            title=hook.text[:90], hook=hook.text,
            beats=[Beat(text=sentences[0], purpose="hook"), Beat(text=sentences[1], purpose="setup"),
                   *[Beat(text=s, purpose="value") for s in sentences[2:5]],
                   Beat(text=joiner(language).join(sentences[5:7]), purpose="payoff"),
                   Beat(text=sentences[7], purpose="cta")],
            vo_text=vo, caption_text=vo, cta=sentences[-1], mood=(kit.music_moods or ["upbeat"])[0],
            target_seconds=max(30, min(60, round(spoken))),
        )
        return ScriptPackage(script=script, shot_list=ShotList(shots=shots)), 0

    async def metadata(self, kit, script, platforms, language="en"):
        items = [PlatformCopy(platform=p, title=script.title,
                              description=f"{script.hook} {script.cta}",
                              hashtags=(kit.hashtags or []) + ["shorts", kit.niche.replace(" ", "")])
                 for p in platforms]
        return MetadataBundle(items=items), 0

    async def moderate_text(self, text, banned):
        hits = [w for w in (*self.unsafe_words, *banned) if w and w.lower() in text.lower()]
        return ModerationResult(safe=not hits, categories=hits, reason=", ".join(hits)), 0

    async def moderate_frames(self, frames, banned):
        return ModerationResult(safe=True), 0

    async def translate(self, lines, source, target):
        return [f"[{target}] {line}" for line in lines], 0

    async def embed(self, texts):
        return [hash_embed(t) for t in texts]


def build_llm(settings: Settings) -> LLMBackend:
    mode = settings.llm_mode or settings.provider_mode
    return FakeLLM() if mode == "fake" else LLM(settings)
