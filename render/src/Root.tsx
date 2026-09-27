import React from "react";
import { Composition, type CalculateMetadataFunction } from "remotion";
import { sampleSpec } from "./sample";
import { BoldTemplate } from "./templates/Bold";
import { DefaultTemplate } from "./templates/Default";
import { ASPECTS, ASPECT_SIZE, compositionId, type CompositionProps, type TemplateId } from "./types";

const TEMPLATE_COMPONENTS: Record<TemplateId, React.FC<CompositionProps>> = {
  default: DefaultTemplate,
  bold: BoldTemplate,
};

/** Size, fps and length come from the input props, not from the registration. */
const calculateMetadata: CalculateMetadataFunction<CompositionProps> = ({ props }) => {
  const { width, height } = ASPECT_SIZE[props.aspect];
  const fps = props.spec.fps;
  return { width, height, fps, durationInFrames: Math.max(1, Math.round(props.spec.duration * fps)) };
};

export const RemotionRoot: React.FC = () => (
  <>
    {(Object.keys(TEMPLATE_COMPONENTS) as TemplateId[]).flatMap((template) =>
      ASPECTS.map((aspect) => (
        <Composition
          key={compositionId(template, aspect)}
          id={compositionId(template, aspect)}
          component={TEMPLATE_COMPONENTS[template]}
          defaultProps={{ spec: { ...sampleSpec, template }, aspect } satisfies CompositionProps}
          calculateMetadata={calculateMetadata}
          fps={30}
          width={ASPECT_SIZE[aspect].width}
          height={ASPECT_SIZE[aspect].height}
          durationInFrames={300}
        />
      )),
    )}
  </>
);
