import type React from "react";
import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";
import {
	FilterMode,
	Group,
	processUniforms,
	Rect,
	Skia,
	TileMode,
} from "react-skia-lite";
import type { SkPicture } from "react-skia-lite";
import type { TimelineElement } from "@/dsl/types";
import {
	useRenderTime,
	useTimelineStore,
} from "@/editor/contexts/TimelineContext";
import { getTransitionBoundary } from "@/editor/utils/transitions";
import type { TransitionProps } from "../Transition/model";

interface RippleDissolveTransitionRendererProps extends TransitionProps {
	id: string;
	fromNode?: ReactNode;
	toNode?: ReactNode;
	fromPicture?: SkPicture | null;
	toPicture?: SkPicture | null;
	progress?: number;
}

const RIPPLE_DISSOLVE_SHADER_CODE = `
uniform shader preRoll;
uniform shader afterRoll;
uniform float2 iResolution;
uniform float progress;
uniform float frequency;
uniform float strength;
uniform float softness;
uniform float speed;

half4 main(float2 xy) {
  float2 center = iResolution * 0.5;
  float2 delta = xy - center;
  float dist = length(delta) / max(iResolution.x, iResolution.y);
  float phase = dist * frequency * 6.2831853 - progress * speed * 6.2831853;
  float ripple = sin(phase) * 0.5 + 0.5;
  float offset = softness + strength * 0.5;
  float threshold = progress + (ripple - 0.5) * strength - offset;
  float edge = 1.0 - smoothstep(threshold - softness, threshold + softness, dist);
  half4 fromColor = preRoll.eval(xy);
  half4 toColor = afterRoll.eval(xy);
  return mix(fromColor, toColor, edge);
}
`;

const DEFAULT_TRANSITION_DURATION = 15;
const RIPPLE_FREQUENCY = 12;
const RIPPLE_STRENGTH = 0.08;
const RIPPLE_SOFTNESS = 0.04;
const RIPPLE_SPEED = 1.2;

const clampProgress = (value: number): number => {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
};

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

const RippleDissolveTransitionRenderer: React.FC<
	RippleDissolveTransitionRendererProps
> = ({ fromNode, toNode, fromPicture, toPicture, progress, id }) => {
	const currentTimeFrames = useRenderTime();
	const transitionElement = useTimelineStore(
		(state) => state.getElementById(id)!,
	);
	const canvasSize = useTimelineStore((state) => state.canvasSize);
	const start = transitionElement?.timeline.start ?? 0;
	const transitionDuration = resolveTransitionDuration(transitionElement);
	const boundary = getTransitionBoundary(transitionElement);

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
			return Skia.RuntimeEffect.Make(RIPPLE_DISSOLVE_SHADER_CODE);
		} catch (error) {
			console.error("Failed to create ripple dissolve shader:", error);
			return null;
		}
	}, []);

	const width = canvasSize.width;
	const height = canvasSize.height;

	const preRollPicture = fromPicture ?? null;
	const afterRollPicture = toPicture ?? null;

	const blendShader = useMemo(() => {
		if (
			!shaderSource ||
			!preRollPicture ||
			!afterRollPicture ||
			width <= 0 ||
			height <= 0
		)
			return null;
		const bounds = { x: 0, y: 0, width, height };
		const fromShader = preRollPicture.makeShader(
			TileMode.Clamp,
			TileMode.Clamp,
			FilterMode.Linear,
			undefined,
			bounds,
		);
		const toShader = afterRollPicture.makeShader(
			TileMode.Clamp,
			TileMode.Clamp,
			FilterMode.Linear,
			undefined,
			bounds,
		);
		const uniforms = processUniforms(shaderSource, {
			progress: safeProgress,
			iResolution: [width, height],
			frequency: RIPPLE_FREQUENCY,
			strength: RIPPLE_STRENGTH,
			softness: RIPPLE_SOFTNESS,
			speed: RIPPLE_SPEED,
		});
		const shader = shaderSource.makeShaderWithChildren(uniforms, [
			fromShader,
			toShader,
		]);
		return { shader, children: [fromShader, toShader] };
	}, [
		afterRollPicture,
		preRollPicture,
		safeProgress,
		shaderSource,
		width,
		height,
	]);

	const paintBundle = useMemo(() => {
		if (!blendShader) return null;
		const paint = Skia.Paint();
		paint.setShader(blendShader.shader);
		return {
			paint,
			shader: blendShader.shader,
			children: blendShader.children,
		};
	}, [blendShader]);

	useEffect(() => {
		return () => {
			if (!paintBundle) return;
			paintBundle.shader.dispose();
			paintBundle.children.forEach((child) => child.dispose());
			paintBundle.paint.dispose();
		};
	}, [paintBundle]);

	const renderHardCut = () => {
		return <Group>{currentTimeFrames < boundary ? fromNode : toNode}</Group>;
	};

	if (paintBundle && preRollPicture && afterRollPicture) {
		return (
			<Group>
				<Rect
					x={0}
					y={0}
					width={width}
					height={height}
					paint={paintBundle.paint}
				/>
			</Group>
		);
	}

	return renderHardCut();
};

export default RippleDissolveTransitionRenderer;
