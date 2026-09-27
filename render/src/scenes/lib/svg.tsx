/** Shared SVG building blocks: parallax layers, tiling, joints, glows, rim-light filter. */
import React, { useId } from "react";

/** useId() made safe for use inside url(#...) references. */
export const useSid = (): string => "s" + useId().replace(/[^a-zA-Z0-9_-]/g, "_");
import type { Ctx } from "../ctx";

/** Horizontal offset of a layer at `depth` (0 = sky at infinity, 1 = subject plane, >1 = foreground). */
export const layerOffset = (ctx: Ctx, depth: number, scrollFactor = 1): { ox: number; oy: number; s: number } => {
  const { cam, scroll } = ctx;
  const dz = Math.min(depth, 1.6);
  return {
    ox: -scroll * depth * scrollFactor - cam.x * depth + cam.shakeX * dz,
    oy: -cam.y * depth + cam.shakeY * dz,
    s: 1 + (cam.zoom - 1) * dz,
  };
};

export const Layer: React.FC<{ ctx: Ctx; depth: number; scrollFactor?: number; children: React.ReactNode; opacity?: number }> = ({
  ctx, depth, scrollFactor = 1, children, opacity,
}) => {
  const { VW, VH, cam } = ctx;
  const { ox, oy, s } = layerOffset(ctx, depth, scrollFactor);
  const cx = VW / 2, cy = VH * 0.55;
  const rot = cam.rot * Math.min(depth, 1.5);
  return (
    <g
      opacity={opacity}
      transform={`translate(${cx.toFixed(2)} ${cy.toFixed(2)}) rotate(${rot.toFixed(3)}) scale(${s.toFixed(4)}) translate(${(-cx + ox).toFixed(2)} ${(-cy + oy).toFixed(2)})`}
    >
      {children}
    </g>
  );
};

/** Indices + world x of items spaced `spacing` apart that are visible on a layer. */
export const tiles = (ctx: Ctx, depth: number, spacing: number, pad = spacing, scrollFactor = 1): { i: number; x: number }[] => {
  const { ox } = layerOffset(ctx, depth, scrollFactor);
  const start = Math.floor((-ox - pad) / spacing);
  const end = Math.ceil((-ox + ctx.VW + pad) / spacing);
  const out: { i: number; x: number }[] = [];
  for (let i = start; i <= end; i++) out.push({ i, x: i * spacing });
  return out;
};
/** World-x range visible on a layer (for full-width shapes like ground bands). */
export const visibleX = (ctx: Ctx, depth: number, pad = 200, scrollFactor = 1): [number, number] => {
  const { ox } = layerOffset(ctx, depth, scrollFactor);
  return [-ox - pad, -ox + ctx.VW + pad];
};

/** Rotating joint: children are drawn relative to the pivot. */
export const J: React.FC<{ x?: number; y?: number; r?: number; s?: number; sx?: number; sy?: number; children: React.ReactNode; opacity?: number }> = ({
  x = 0, y = 0, r = 0, s, sx, sy, children, opacity,
}) => {
  const scale = sx !== undefined || sy !== undefined ? ` scale(${(sx ?? 1).toFixed(4)} ${(sy ?? 1).toFixed(4)})` : s !== undefined ? ` scale(${s.toFixed(4)})` : "";
  return (
    <g transform={`translate(${x.toFixed(2)} ${y.toFixed(2)}) rotate(${r.toFixed(2)})${scale}`} opacity={opacity}>
      {children}
    </g>
  );
};

/** Soft radial glow. */
export const Glow: React.FC<{ cx: number; cy: number; r: number; color: string; opacity?: number; ry?: number; core?: number }> = ({
  cx, cy, r, color, opacity = 1, ry, core = 0,
}) => {
  const id = useSid();
  return (
    <>
      <defs>
        <radialGradient id={id}>
          <stop offset="0" stopColor={color} stopOpacity={1} />
          <stop offset={Math.max(0.01, core)} stopColor={color} stopOpacity={core > 0 ? 0.9 : 0.75} />
          <stop offset="0.45" stopColor={color} stopOpacity={0.28} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </radialGradient>
      </defs>
      <ellipse cx={cx} cy={cy} rx={r} ry={ry ?? r} fill={`url(#${id})`} opacity={opacity} />
    </>
  );
};

/** Vertical linear gradient helper; returns [defs, url]. */
export const useVGrad = (stops: [number, string, number?][], horizontal = false): [React.ReactNode, string] => {
  const id = useSid();
  return [
    <linearGradient key={id} id={id} x1="0" y1="0" x2={horizontal ? "1" : "0"} y2={horizontal ? "0" : "1"}>
      {stops.map(([o, c, a], i) => (
        <stop key={i} offset={o} stopColor={c} stopOpacity={a ?? 1} />
      ))}
    </linearGradient>,
    `url(#${id})`,
  ];
};

/** Flat-illustration shading filter: crisp rim light on the light side + soft core shadow on the other. */
export const RimFilter: React.FC<{ id: string; ctx: Ctx; size?: number }> = ({ id, ctx, size = 7 }) => {
  const ls = ctx.pal.lightSide;
  const flash = ctx.flash;
  const rimA = Math.min(1, ctx.pal.rimAlpha + flash * 0.6);
  const rimC = flash > 0.2 ? "#e8f0ff" : ctx.pal.rim;
  return (
    <filter id={id} x="-15%" y="-15%" width="130%" height="130%" colorInterpolationFilters="sRGB">
      <feOffset in="SourceAlpha" dx={-ls * size} dy={size * 0.7} result="o1" />
      <feComposite in="SourceAlpha" in2="o1" operator="out" result="edge" />
      <feFlood floodColor={rimC} floodOpacity={rimA} />
      <feComposite in2="edge" operator="in" result="rim" />
      <feOffset in="SourceAlpha" dx={ls * size * 2.6} dy={-size * 1.8} result="o2" />
      <feComposite in="SourceAlpha" in2="o2" operator="out" result="edge2" />
      <feFlood floodColor={ctx.pal.shadow} floodOpacity={0.28} />
      <feComposite in2="edge2" operator="in" result="shade" />
      <feMerge>
        <feMergeNode in="SourceGraphic" />
        <feMergeNode in="shade" />
        <feMergeNode in="rim" />
      </feMerge>
    </filter>
  );
};

/** Wraps a character so it gets the rim-light filter. `flip` mirrors it horizontally. */
export const Lit: React.FC<{ ctx: Ctx; children: React.ReactNode; size?: number }> = ({ ctx, children, size }) => {
  const id = useSid();
  return (
    <>
      <defs>
        <RimFilter id={id} ctx={ctx} size={size} />
      </defs>
      <g filter={`url(#${id})`}>{children}</g>
    </>
  );
};

/** Soft contact shadow on the ground. */
export const GroundShadow: React.FC<{ cx: number; cy: number; rx: number; ry?: number; opacity?: number; color?: string }> = ({
  cx, cy, rx, ry, opacity = 0.35, color = "#000",
}) => {
  const id = useSid();
  return (
    <>
      <defs>
        <radialGradient id={id}>
          <stop offset="0" stopColor={color} stopOpacity={opacity} />
          <stop offset="0.6" stopColor={color} stopOpacity={opacity * 0.5} />
          <stop offset="1" stopColor={color} stopOpacity={0} />
        </radialGradient>
      </defs>
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry ?? rx * 0.14} fill={`url(#${id})`} />
    </>
  );
};

/** Tapered limb from (0,0) pointing down `len`, width w0 at the top to w1 at the end. */
export const limbPath = (len: number, w0: number, w1: number): string =>
  `M${-w0 / 2},0 C${-w0 / 2},${len * 0.5} ${-w1 / 2},${len * 0.8} ${-w1 / 2},${len} A${w1 / 2},${w1 / 2} 0 0 0 ${w1 / 2},${len} C${w1 / 2},${len * 0.8} ${w0 / 2},${len * 0.5} ${w0 / 2},0 A${w0 / 2},${w0 / 2} 0 0 0 ${-w0 / 2},0Z`;

/** Two-segment leg/arm: returns the end point too (for IK-free attachment of feet/hands). */
export const Limb2: React.FC<{
  a1: number; a2: number; l1: number; l2: number; w0: number; w1: number; w2: number; fill: string;
  end?: React.ReactNode; x?: number; y?: number;
}> = ({ a1, a2, l1, l2, w0, w1, w2, fill, end, x = 0, y = 0 }) => (
  <J x={x} y={y} r={a1}>
    <path d={limbPath(l1, w0, w1)} fill={fill} />
    <J y={l1 - w1 * 0.15} r={a2}>
      <path d={limbPath(l2, w1, w2)} fill={fill} />
      {end ? <J y={l2}>{end}</J> : null}
    </J>
  </J>
);
