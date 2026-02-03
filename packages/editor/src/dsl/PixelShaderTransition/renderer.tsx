import React, { type ReactNode, useMemo } from "react";
import { Group, Mask, Rect, Shader, Skia } from "react-skia-lite";
import type { TimelineElement } from "@/dsl/types";
import {
	useRenderTime,
	useTimelineStore,
} from "@/editor/contexts/TimelineContext";
import type { TransitionProps } from "../Transition/model";

interface PixelShaderTransitionRendererProps extends TransitionProps {
	id: string;
	fromNode?: ReactNode;
	toNode?: ReactNode;
	progress?: number;
}

const PIXEL_SHADER_CODE = `
uniform vec2 iResolution;
uniform float progress;
uniform float pixelSize;
uniform float softness;

float rand(vec2 n) {
  return fract(sin(dot(n, vec2(12.9898, 78.233))) * 43758.5453123);
}

vec4 main(vec2 pos) {
  float size = max(2.0, pixelSize);
  vec2 grid = floor(pos / size);
  float r = rand(grid);
  float edge = 1.0 - smoothstep(progress - softness, progress + softness, r);
  return vec4(vec3(edge), 1.0);
}
`;

const clampProgress = (value: number): number => {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
};

const DEFAULT_TRANSITION_DURATION = 15;

const resolveTransitionDuration = (
	element: TimelineElement | undefined,
): number => {
	if (!element) return DEFAULT_TRANSITION_DURATION;
	const metaDuration = element.transition?.duration;

	const timelineDuration = element.timeline.end - element.timeline.start;
	const value =
		metaDuration ??
		(Number.isFinite(timelineDuration) && timelineDuration > 0
			? timelineDuration
			: DEFAULT_TRANSITION_DURATION);
	if (!Number.isFinite(value)) return DEFAULT_TRANSITION_DURATION;
	return Math.max(0, Math.round(value));
};

const PixelShaderTransitionRenderer: React.FC<
	PixelShaderTransitionRendererProps
> = ({ id, fromNode, toNode, progress }) => {
	if (!fromNode && !toNode) return null;

	const currentTimeFrames = useRenderTime();
	const transitionElement = useTimelineStore(
		(state) => state.getElementById(id)!,
	);
	const canvasSize = useTimelineStore((state) => state.canvasSize);

	const transitionDuration = resolveTransitionDuration(transitionElement);
	const start = transitionElement?.timeline.start ?? 0;
	const computedProgress =
		transitionDuration > 0
			? clampProgress((currentTimeFrames - start) / transitionDuration)
			: 0;
	const safeProgress =
		typeof progress === "number" && Number.isFinite(progress)
			? clampProgress(progress)
			: computedProgress;

	const shaderSource = useMemo(() => {
		try {
			return Skia.RuntimeEffect.Make(PIXEL_SHADER_CODE);
		} catch (error) {
			console.error("Failed to create pixel transition shader:", error);
			return null;
		}
	}, []);

	if (!shaderSource || !toNode) {
		return (
			<Group>
				{fromNode && <Group>{fromNode}</Group>}
				{toNode && (
					<Group opacity={safeProgress} blendMode="plus">
						{toNode}
					</Group>
				)}
			</Group>
		);
	}

	const pixelSize = Math.max(4, Math.round(18 - safeProgress * 6));
	const softness = 0.08;

	return (
		<Group>
			{fromNode && <Group>{fromNode}</Group>}
			<Mask
				mode="luminance"
				mask={
					<Rect x={0} y={0} width={canvasSize.width} height={canvasSize.height}>
						<Shader
							source={shaderSource}
							uniforms={{
								iResolution: [canvasSize.width, canvasSize.height],
								progress: safeProgress,
								pixelSize,
								softness,
							}}
						/>
					</Rect>
				}
			>
				<Group>{toNode}</Group>
			</Mask>
		</Group>
	);
};

export default PixelShaderTransitionRenderer;
