import React from "react";
import { AbsoluteFill, Img, useVideoConfig } from "remotion";

type Corner = "top-left" | "top-right";

export const Logo: React.FC<{ src: string | null; corner: Corner; size?: number; opacity?: number }> = ({
  src,
  corner,
  size = 0.13,
  opacity = 0.92,
}) => {
  const { width, height } = useVideoConfig();
  if (!src) return null;
  const short = Math.min(width, height);
  const margin = short * 0.045;
  return (
    <AbsoluteFill style={{ pointerEvents: "none" }}>
      <Img
        src={src}
        style={{
          position: "absolute",
          top: margin,
          [corner === "top-left" ? "left" : "right"]: margin,
          maxWidth: short * size * 1.8,
          maxHeight: short * size,
          objectFit: "contain",
          opacity,
          filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.35))",
        }}
      />
    </AbsoluteFill>
  );
};
