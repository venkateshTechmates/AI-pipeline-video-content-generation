import { useMemo, useState } from "react";
import { useWidth } from "../hooks";

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

export interface ColumnSeries {
  key: string;
  label: string;
  color: string;
}

/**
 * Grouped column chart (one shared count axis). Hover a day for a tooltip;
 * `extra` adds non-plotted rows (e.g. cost) to the tooltip.
 */
export function ColumnChart<T extends Record<string, unknown>>({
  data,
  x,
  series,
  xLabel,
  extra,
  height = 220,
  ariaLabel,
}: {
  data: T[];
  x: (d: T) => string;
  series: ColumnSeries[];
  xLabel: (d: T) => string;
  extra?: (d: T) => { label: string; value: string }[];
  height?: number;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const padL = 34;
  const padR = 4;
  const padT = 10;
  const padB = 24;
  const W = Math.max(width, 200);
  const H = height;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const max = useMemo(() => niceMax(Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)))), [data, series]);
  const ticks = useMemo(() => {
    const n = max <= 4 ? max : 4;
    return Array.from({ length: n + 1 }, (_, i) => (max / n) * i);
  }, [max]);
  const band = data.length ? innerW / data.length : innerW;
  const groupW = Math.min(band * 0.72, 30 * series.length);
  const barW = Math.max(2, Math.min(24, (groupW - 2 * (series.length - 1)) / series.length));
  const y = (v: number) => padT + innerH - (v / max) * innerH;
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(innerW / 64))));

  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={W} height={H} role="img" aria-label={ariaLabel}>
          {ticks.map((t) => (
            <g key={t}>
              <line className={t === 0 ? "baseline" : "gridline"} x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />
              <text className="axis-label" x={padL - 8} y={y(t)} dy="0.32em" textAnchor="end">
                {Number.isInteger(t) ? t : t.toFixed(1)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = padL + band * i + band / 2;
            const gx = cx - (barW * series.length + 2 * (series.length - 1)) / 2;
            return (
              <g key={x(d)}>
                {hover === i && <rect className="hover-band" x={padL + band * i} y={padT} width={band} height={innerH} rx={4} />}
                {series.map((s, j) => {
                  const v = Number(d[s.key]) || 0;
                  if (v <= 0) return null;
                  const top = y(v);
                  const h = padT + innerH - top;
                  const bx = gx + j * (barW + 2);
                  const r = Math.min(4, barW / 2, h);
                  return (
                    <path
                      key={s.key}
                      d={`M${bx},${top + h} V${top + r} Q${bx},${top} ${bx + r},${top} H${bx + barW - r} Q${bx + barW},${top} ${bx + barW},${top + r} V${top + h} Z`}
                      fill={s.color}
                    />
                  );
                })}
                {i % labelEvery === 0 && (
                  <text className="axis-label" x={cx} y={H - 6} textAnchor="middle">
                    {xLabel(d)}
                  </text>
                )}
                <rect
                  x={padL + band * i}
                  y={padT}
                  width={band}
                  height={innerH + padB}
                  fill="transparent"
                  onMouseEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  tabIndex={-1}
                />
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && data[hover] && (
        <div
          className="chart-tip"
          style={{
            left: Math.min(Math.max(0, padL + band * hover + band / 2 - 80), W - 170),
            top: 0,
          }}
          role="status"
        >
          <div className="t">{xLabel(data[hover])}</div>
          {series.map((s) => (
            <div className="r" key={s.key}>
              <span className="swatch" style={{ ["--kc" as string]: s.color }} aria-hidden />
              {s.label}
              <span className="v">{Number(data[hover][s.key]) || 0}</span>
            </div>
          ))}
          {extra?.(data[hover]).map((e) => (
            <div className="r" key={e.label}>
              <span className="swatch" style={{ background: "transparent" }} aria-hidden />
              {e.label}
              <span className="v">{e.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Tiny single-series sparkline (area wash + 2px line + end dot). */
export function Sparkline({ values, width = 84, height = 28, color = "var(--seq-strong)" }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return null;
  const max = Math.max(...values, 0.0001);
  const step = width / (values.length - 1);
  const pts = values.map((v, i) => [i * step, height - 3 - (v / max) * (height - 6)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  const [lx, ly] = pts[pts.length - 1];
  return (
    <svg width={width} height={height} className="tile-spark" aria-hidden>
      <path d={area} fill={color} opacity={0.1} />
      <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lx} cy={ly} r={3.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
    </svg>
  );
}
