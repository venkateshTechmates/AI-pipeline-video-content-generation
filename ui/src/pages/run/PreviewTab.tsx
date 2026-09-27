import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Captions, Download, Film, Languages, Music, Mic } from "lucide-react";
import { languageLabel, useLanguages } from "../../components/LanguagePicker";
import { Card, EmptyState, PhoneFrame, Segmented, VideoBox, type VideoTrack } from "../../components/ui";
import { seconds } from "../../format";
import { UNSPACED_LANGUAGES, type AspectRatio, type Brand, type CaptionStyle, type RunDetail, type WordTiming } from "../../types";

export function PreviewTab({ d, brand }: { d: RunDetail; brand: Brand | null }) {
  const renders = d.state.renders ?? [];
  const available = (["9:16", "1:1", "16:9"] as AspectRatio[]).filter((a) => renders.some((r) => r.aspect === a));
  const [aspect, setAspect] = useState<AspectRatio>("9:16");
  const cur = renders.find((r) => r.aspect === aspect) ?? renders[0];
  const [t, setT] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const words = d.state.vo?.words ?? [];
  const voAsset = d.assets.find((a) => a.type === "voiceover");
  const music = d.state.music;
  const clips = [...(d.state.clips ?? [])].sort((a, b) => a.shot_index - b.shot_index);
  const shots = d.state.shot_list?.shots ?? [];
  const langs = useLanguages();
  const language = d.state.language ?? d.run.language ?? "en";
  const sep = UNSPACED_LANGUAGES.includes(language) ? "" : " ";
  const subtitles = d.state.subtitles ?? [];
  // the burned-in captions already show the narration language, so the player offers the translations
  const tracks: VideoTrack[] = subtitles
    .filter((s) => s.translated && s.vtt_url)
    .map((s) => ({ lang: s.language, label: languageLabel(langs, s.language), src: s.vtt_url as string }));
  // viewers see subtitles in their own language by default when the video's narration is in another one
  const viewerLang = (typeof navigator !== "undefined" ? navigator.language : "en").split("-")[0];

  if (!renders.length && !clips.length)
    return (
      <EmptyState
        icon={<Film size={28} />}
        title="No renders yet"
        body="Previews appear here once the render stage finishes."
      />
    );

  return (
    <div className="preview-layout">
      <div className="preview-main">
        {renders.length > 0 && (
          <Card
            title="Render"
            actions={
              <Segmented
                label="Aspect ratio"
                value={cur?.aspect ?? aspect}
                onChange={setAspect}
                options={available.map((a) => ({ id: a, label: a }))}
              />
            }
          >
            <div className={`player-stage ar-stage-${(cur?.aspect ?? "9:16").replace(":", "x")}`}>
              {cur?.aspect === "9:16" ? (
                <PhoneFrame src={cur.url} videoRef={videoRef} onTime={setT} label="9:16 render" tracks={tracks} defaultLang={viewerLang} />
              ) : (
                <VideoBox src={cur?.url} aspect={cur?.aspect ?? aspect} tracks={tracks} defaultLang={viewerLang} />
              )}
            </div>
            {cur && (
              <div className="render-meta muted small tabular">
                <span>
                  {cur.width}×{cur.height}
                </span>
                <span>{seconds(cur.duration)}</span>
                {cur.url && (
                  <a href={cur.url} target="_blank" rel="noreferrer" className="inline-icon">
                    <Download size={13} aria-hidden /> Download
                  </a>
                )}
              </div>
            )}
          </Card>
        )}
      </div>

      <div className="preview-side">
        {subtitles.length > 0 && (
          <Card
            title={
              <span className="inline-icon">
                <Languages size={15} aria-hidden /> Subtitles
              </span>
            }
            actions={<span className="muted small">voice: {languageLabel(langs, language)}</span>}
          >
            <ul className="subtitle-list">
              {subtitles.map((s) => (
                <li key={s.language}>
                  <span className="grow">
                    {languageLabel(langs, s.language)}
                    <span className="muted small"> · {s.translated ? "translated" : "narration"}</span>
                  </span>
                  {s.srt_url && (
                    <a className="btn btn-ghost btn-sm" href={s.srt_url} download>
                      <Download size={13} aria-hidden /> SRT
                    </a>
                  )}
                  {s.vtt_url && (
                    <a className="btn btn-ghost btn-sm" href={s.vtt_url} download>
                      <Download size={13} aria-hidden /> VTT
                    </a>
                  )}
                </li>
              ))}
            </ul>
            {tracks.length > 0 && <p className="muted small">Translations are also selectable in the player's CC menu.</p>}
          </Card>
        )}
        {words.length > 0 && (
          <Card
            title={
              <span className="inline-icon">
                <Captions size={15} aria-hidden /> Caption track
              </span>
            }
            actions={<span className="muted small">{cur?.aspect === "9:16" ? "synced to player" : "switch to 9:16 to sync"}</span>}
          >
            <CaptionPreview words={words} t={t} style={brand?.kit.caption_style} sep={sep} />
            <Transcript
              words={words}
              t={t}
              onSeek={(s) => {
                const v = videoRef.current;
                if (v) {
                  v.currentTime = s;
                  setT(s);
                }
              }}
            />
          </Card>
        )}
        <div className="grid-2 gap-sm">
          {d.state.vo && (
            <Card
              title={
                <span className="inline-icon">
                  <Mic size={15} aria-hidden /> Voice-over
                </span>
              }
            >
              <dl className="kv kv-tight">
                <dt>Duration</dt>
                <dd className="tabular">{seconds(d.state.vo.duration)}</dd>
                <dt>Loudness</dt>
                <dd className="tabular">{d.state.vo.lufs !== null ? `${d.state.vo.lufs.toFixed(1)} LUFS` : "—"}</dd>
                <dt>Words</dt>
                <dd className="tabular">{words.length}</dd>
              </dl>
              {voAsset?.url && <audio className="audio" controls preload="none" src={voAsset.url} aria-label="Voice-over" />}
            </Card>
          )}
          {music && (
            <Card
              title={
                <span className="inline-icon">
                  <Music size={15} aria-hidden /> Music
                </span>
              }
            >
              <div className="strong">{music.title}</div>
              <dl className="kv kv-tight">
                <dt>License</dt>
                <dd>
                  <code>{music.license_id}</code>
                </dd>
                <dt>Provider</dt>
                <dd>{music.provider}</dd>
                <dt>Ducking</dt>
                <dd className="tabular">{music.duck_db} dB under VO</dd>
              </dl>
            </Card>
          )}
        </div>
      </div>

      {clips.length > 0 && (
        <Card title={`Generated clips (${clips.length})`} className="span-all">
          <div className="clips">
            {clips.map((c) => {
              const shot = shots.find((s) => s.index === c.shot_index);
              return (
                <figure key={c.path} className="clip">
                  <div className="clip-video">
                    {c.url ? (
                      <video
                        src={`${c.url}#t=0.5`}
                        muted
                        playsInline
                        preload="metadata"
                        loop
                        onMouseEnter={(e) => void e.currentTarget.play().catch(() => undefined)}
                        onMouseLeave={(e) => e.currentTarget.pause()}
                        onFocus={(e) => void e.currentTarget.play().catch(() => undefined)}
                        onBlur={(e) => e.currentTarget.pause()}
                        controls
                        aria-label={`Shot ${c.shot_index + 1}`}
                      />
                    ) : (
                      <div className="video-empty">missing</div>
                    )}
                    <span className="clip-index">#{c.shot_index + 1}</span>
                  </div>
                  <figcaption>
                    <div className="row between small">
                      <span className="tabular">{seconds(c.duration)}</span>
                      <span className="muted" title={`${c.provider} ${c.model}`}>
                        {c.provider}
                      </span>
                    </div>
                    {shot && <p className="clip-prompt">{shot.prompt}</p>}
                  </figcaption>
                </figure>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

/** Groups word timings into caption lines of N words (brand caption_style.words_per_line). */
function chunk(words: WordTiming[], n: number): WordTiming[][] {
  const out: WordTiming[][] = [];
  for (let i = 0; i < words.length; i += n) out.push(words.slice(i, i + n));
  return out;
}

export function CaptionPreview({
  words,
  t,
  style,
  sep = " ",
}: {
  words: WordTiming[];
  t: number;
  style?: CaptionStyle;
  sep?: string;
}) {
  const n = Math.max(1, style?.words_per_line ?? 3);
  const lines = useMemo(() => chunk(words, n), [words, n]);
  const line =
    lines.find((l) => t >= l[0].start && t <= l[l.length - 1].end + 0.15) ??
    [...lines].reverse().find((l) => l[0].start <= t) ??
    lines[0];
  if (!line) return null;
  return (
    <div className="caption-stage" aria-hidden>
      <div
        className="caption-line"
        style={{
          color: style?.color ?? "#fff",
          textTransform: style?.uppercase === false ? "none" : "uppercase",
          fontFamily: `${style?.font ?? "Inter"}, Inter, system-ui, sans-serif`,
          WebkitTextStroke: `${Math.min(3, (style?.stroke_width ?? 6) / 3)}px ${style?.stroke_color ?? "#000"}`,
        }}
      >
        {line.map((w, i) => (
          <span
            key={i}
            style={t >= w.start && t <= w.end ? { color: style?.highlight_color ?? "#FFD400" } : undefined}
          >
            {w.word}
            {sep}
          </span>
        ))}
      </div>
    </div>
  );
}

function Transcript({ words, t, onSeek }: { words: WordTiming[]; t: number; onSeek: (s: number) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const active = words.findIndex((w) => t >= w.start && t < w.end + 0.05);
  useEffect(() => {
    if (active < 0) return;
    const el = box.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    const b = box.current;
    if (el && b) {
      const top = el.offsetTop - b.offsetTop;
      if (top < b.scrollTop || top > b.scrollTop + b.clientHeight - 24) b.scrollTop = top - b.clientHeight / 3;
    }
  }, [active]);
  return (
    <div className="transcript" ref={box}>
      {words.map((w, i) => (
        <Fragment key={i}>
        <button
          type="button"
          data-i={i}
          className={`tw ${i === active ? "on" : ""} ${w.end < t ? "past" : ""}`}
          onClick={() => onSeek(w.start)}
          title={`${w.start.toFixed(2)}s`}
          tabIndex={-1}
        >
          {w.word}
        </button>{" "}
        </Fragment>
      ))}
    </div>
  );
}
