import type { TimelineElement } from "core/element/types";
import type React from "react";
import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";
import type { SkImage, SkPicture } from "react-skia-lite";
import {
	Group,
	processUniforms,
	Rect,
	Skia,
} from "react-skia-lite";
import {
	useRenderTime,
	useTimelineStore,
} from "@/scene-editor/contexts/TimelineContext";
import { getTransitionBoundary } from "@/scene-editor/utils/transitions";
import type { TransitionProps } from "./model";
import {
	makeTransitionTextureShader,
	type TransitionTextureSource,
} from "./textureShader";

interface TransitionRendererProps extends TransitionProps {
	id: string;
	fromNode?: ReactNode;
	toNode?: ReactNode;
	fromImage?: SkImage | null;
	toImage?: SkImage | null;
	fromPicture?: SkPicture | null;
	toPicture?: SkPicture | null;
	progress?: number;
}

const FADE_SHADER_CODE = `
uniform shader preRoll;
uniform shader afterRoll;
uniform float progress;

half4 main(float2 xy) {
  half4 fromColor = preRoll.eval(xy);
  half4 toColor = afterRoll.eval(xy);
  return mix(fromColor, toColor, progress);
}
`;

const clampProgress = (value: number): number => {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
};

const DEFAULT_TRANSITION_DURATION = 15;

const resolveTransitionDuration = (element: TimelineElement | null): number => {
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

const TransitionRenderer: React.FC<TransitionRendererProps> = ({
	fromNode,
	toNode,
	fromImage,
	toImage,
	fromPicture,
	toPicture,
	progress,
	id,
}) => {
	const currentTimeFrames = useRenderTime();
	const transitionElement = useTimelineStore((state) =>
		state.getElementById(id),
	);

	const canvasSize = useTimelineStore((state) => state.canvasSize);
	const start = transitionElement?.timeline.start ?? 0;
	const transitionDuration = resolveTransitionDuration(transitionElement);
	const boundary = getTransitionBoundary(transitionElement!);

	const computedProgress =
		transitionDuration > 0
			? clampProgress((currentTimeFrames - start) / transitionDuration)
			: 0;
	const safeProgress =
		typeof progress === "number" && Number.isFinite(progress)
			? clampProgress(progress)
			: computedProgress;
	const boundaryProgress =
		transitionDuration > 0
			? clampProgress((boundary - start) / transitionDuration)
			: 0;

	const shaderSource = useMemo(() => {
		try {
			return Skia.RuntimeEffect.Make(FADE_SHADER_CODE);
		} catch (error) {
			console.error("Failed to create fade shader:", error);
			return null;
		}
	}, []);

	const width = canvasSize.width;
	const height = canvasSize.height;

	const preRollTexture: TransitionTextureSource | null =
		fromImage ?? fromPicture ?? null;
	const afterRollTexture: TransitionTextureSource | null =
		toImage ?? toPicture ?? null;

	const blendShader = useMemo(() => {
		if (
			!shaderSource ||
			!preRollTexture ||
			!afterRollTexture ||
			width <= 0 ||
			height <= 0
		)
			return null;
		const bounds = { x: 0, y: 0, width, height };
		const fromShader = makeTransitionTextureShader(preRollTexture, bounds);
		const toShader = makeTransitionTextureShader(afterRollTexture, bounds);
		const uniforms = processUniforms(shaderSource, { progress: safeProgress });
		const shader = shaderSource.makeShaderWithChildren(uniforms, [
			fromShader,
			toShader,
		]);
		return { shader, children: [fromShader, toShader] };
	}, [
		afterRollTexture,
		preRollTexture,
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
			paintBundle.children.forEach((child) => {
				child.dispose();
			});
			paintBundle.paint.dispose();
		};
	}, [paintBundle]);

	const renderHardCut = () => {
		return <Group>{safeProgress < boundaryProgress ? fromNode : toNode}</Group>;
	};

	if (paintBundle && preRollTexture && afterRollTexture) {
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

export default TransitionRenderer;
