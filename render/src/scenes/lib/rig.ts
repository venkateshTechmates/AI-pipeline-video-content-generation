/** Tiny 2-D rigging helpers: two-bone IK, tapered capsules, gait foot trajectories. */
import { clamp, mod, type Pt } from "./math";

/**
 * Two-bone IK. Returns the joint position for a limb rooted at `h` reaching `f`.
 * `bend` = +1 puts the joint on the +x side of the h→f line (front-leg knee), -1 on the -x side.
 */
export const ik2 = (h: Pt, f: Pt, l1: number, l2: number, bend: 1 | -1): { knee: Pt; foot: Pt } => {
  let dx = f[0] - h[0], dy = f[1] - h[1];
  let d = Math.hypot(dx, dy);
  const maxD = (l1 + l2) * 0.999;
  if (d > maxD) {
    dx *= maxD / d;
    dy *= maxD / d;
    d = maxD;
  }
  d = Math.max(d, Math.abs(l1 - l2) + 1e-3);
  const a = Math.acos(clamp((l1 * l1 + d * d - l2 * l2) / (2 * l1 * d), -1, 1));
  const base = Math.atan2(dy, dx);
  // For a downward-pointing limb, "+x side" means rotating the base direction counter-clockwise in screen space.
  const ang = base - bend * a;
  const knee: Pt = [h[0] + Math.cos(ang) * l1, h[1] + Math.sin(ang) * l1];
  return { knee, foot: [h[0] + dx, h[1] + dy] };
};

/** Tapered capsule from a (width w0) to b (width w1). */
export const capsule = (a: Pt, b: Pt, w0: number, w1: number): string => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L, ny = dx / L;
  const r0 = w0 / 2, r1 = w1 / 2;
  const f = (v: number) => v.toFixed(1);
  return (
    `M${f(a[0] + nx * r0)},${f(a[1] + ny * r0)}` +
    `L${f(b[0] + nx * r1)},${f(b[1] + ny * r1)}` +
    `A${f(r1)},${f(r1)} 0 0 0 ${f(b[0] - nx * r1)},${f(b[1] - ny * r1)}` +
    `L${f(a[0] - nx * r0)},${f(a[1] - ny * r0)}` +
    `A${f(r0)},${f(r0)} 0 0 0 ${f(a[0] + nx * r0)},${f(a[1] + ny * r0)}Z`
  );
};

/**
 * Foot position relative to its neutral point for a gait with phase p (0..1).
 * Stance (p < duty): foot slides back along the ground; swing: lifts and moves forward.
 */
export const gaitFoot = (p: number, duty: number, stride: number, lift: number): Pt => {
  const q = mod(p, 1);
  if (q < duty) {
    const u = q / duty;
    return [stride / 2 - u * stride, 0];
  }
  const u = (q - duty) / (1 - duty);
  const e = u * u * (3 - 2 * u);
  return [-stride / 2 + e * stride, -lift * Math.sin(Math.PI * u)];
};

/** Point along a polyline of joints (for tails / trunks): each segment rotated a bit more. */
export const chain = (start: Pt, baseAngle: number, segs: number, segLen: number, bendAt: (i: number) => number): Pt[] => {
  const out: Pt[] = [start];
  let a = baseAngle;
  let p = start;
  for (let i = 0; i < segs; i++) {
    a += bendAt(i);
    p = [p[0] + Math.cos(a) * segLen, p[1] + Math.sin(a) * segLen];
    out.push(p);
  }
  return out;
};

/** Offset a centre-line into a tapered closed outline (width from w(u)). */
export const ribbon = (line: Pt[], w: (u: number) => number): Pt[] => {
  const left: Pt[] = [], right: Pt[] = [];
  const n = line.length;
  for (let i = 0; i < n; i++) {
    const a = line[Math.max(0, i - 1)]!, b = line[Math.min(n - 1, i + 1)]!;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    const r = w(i / (n - 1)) / 2;
    const p = line[i]!;
    left.push([p[0] + nx * r, p[1] + ny * r]);
    right.push([p[0] - nx * r, p[1] - ny * r]);
  }
  return [...left, ...right.reverse()];
};
