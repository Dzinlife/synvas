import type { ImageCanvasNode } from "@/studio/project/types";
import { useEffect, useMemo, useState } from "react";
import {
	ImageShader,
	Rect,
	Shader,
	Skia,
	type SharedValue,
	type SkImage,
	type SkRuntimeEffect,
	useSharedValue,
} from "react-skia-lite";
import type { AssetHandle } from "@/assets/AssetStore";
import {
	acquireImageAsset,
	peekImageAsset,
	type ImageAsset,
} from "@/assets/imageAsset";
import { useNodeActiveAgentRun } from "@/agent-system";
import { resolveAssetPlayableUri } from "@/projects/assetLocator";
import { useProjectStore } from "@/projects/projectStore";
import type { CanvasNodeSkiaRenderProps } from "../types";

const IMAGE_LOADING_RUN_DURATION_MS = 10_000;

const IMAGE_NODE_LOADING_SHADER_CODE = `
uniform vec2 uResolution;
uniform float uTime;
uniform float uProgress;

float pulse(float value, float target, float width) {
	float dist = abs(value - target);
	return 1.0 - smoothstep(width * 0.35, width, dist);
}

float gridLine(float value, float cells, float width) {
	float cell = abs(fract(value * cells) - 0.5);
	return 1.0 - smoothstep(width * 0.5, width, cell);
}

vec4 main(vec2 pos) {
	vec2 resolution = max(uResolution, vec2(1.0));
	vec2 uv = pos / resolution;
	vec2 centered = (pos - resolution * 0.5) / min(resolution.x, resolution.y);
	float radius = length(centered);
	float angle = atan(centered.y, centered.x);

	vec3 color = mix(vec3(0.010, 0.020, 0.040), vec3(0.010, 0.085, 0.120), uv.y);
	float vignette = 1.0 - smoothstep(0.16, 0.95, radius);
	color *= mix(0.42, 1.0, vignette);

	float grid = max(
		gridLine(uv.x + uTime * 0.018, 18.0, 0.026),
		gridLine(uv.y - uTime * 0.014, 12.0, 0.026)
	);
	color += vec3(0.020, 0.210, 0.270) * grid * 0.34;

	float sweepPhase = fract((angle / 6.2831853) + uTime * 0.16);
	float sweep = pulse(sweepPhase, 0.0, 0.10) * smoothstep(0.08, 0.46, radius) * (1.0 - smoothstep(0.30, 0.80, radius));
	color += vec3(0.030, 0.720, 1.000) * sweep * 0.70;

	float ringBase = 0.20 + 0.15 * sin(uTime * 1.7);
	float ringA = pulse(radius, ringBase, 0.030);
	float ringB = pulse(radius, 0.42 + 0.04 * cos(uTime * 1.1), 0.020);
	color += vec3(0.070, 0.580, 1.000) * ringA * 0.70;
	color += vec3(0.400, 0.960, 1.000) * ringB * 0.38;

	float diagonal = pulse(fract(uv.x * 0.72 + uv.y * 0.95 - uTime * 0.30), 0.5, 0.085);
	color += vec3(0.060, 0.430, 0.860) * diagonal * 0.28;

	float scanline = 0.55 + 0.45 * sin((uv.y * resolution.y) * 0.18 + uTime * 8.0);
	color += vec3(0.000, 0.090, 0.130) * scanline * 0.20;

	float progress = clamp(uProgress, 0.0, 1.0);
	float barY = 0.88;
	float barMask = pulse(uv.y, barY, 0.014) * step(0.16, uv.x) * step(uv.x, 0.84);
	float barFill = barMask * step(uv.x, mix(0.16, 0.84, progress));
	color += vec3(0.050, 0.840, 1.000) * barMask * 0.20;
	color += vec3(0.140, 0.940, 1.000) * barFill * 0.90;

	float border = max(
		max(pulse(uv.x, 0.025, 0.014), pulse(uv.x, 0.975, 0.014)),
		max(pulse(uv.y, 0.025, 0.014), pulse(uv.y, 0.975, 0.014))
	);
	color += vec3(0.030, 0.560, 0.820) * border * 0.62;

	return vec4(color, 1.0);
}
`;

interface ImageLoadingUniforms {
	[name: string]: number | [number, number];
	uResolution: [number, number];
	uTime: number;
	uProgress: number;
}

let cachedImageLoadingEffect: SkRuntimeEffect | null | undefined;

const getImageLoadingEffect = (): SkRuntimeEffect | null => {
	if (cachedImageLoadingEffect !== undefined) {
		return cachedImageLoadingEffect;
	}
	try {
		cachedImageLoadingEffect = Skia.RuntimeEffect.Make(
			IMAGE_NODE_LOADING_SHADER_CODE,
		);
	} catch (error) {
		console.error("Failed to create image node loading shader:", error);
		cachedImageLoadingEffect = null;
	}
	return cachedImageLoadingEffect;
};

const resolveLoadingUniforms = (
	width: number,
	height: number,
	startedAt: number,
): ImageLoadingUniforms => {
	const elapsedMs = Math.max(0, Date.now() - startedAt);
	return {
		uResolution: [width, height],
		uTime: elapsedMs / 1000,
		uProgress: Math.min(1, elapsedMs / IMAGE_LOADING_RUN_DURATION_MS),
	};
};

const useImageLoadingUniforms = (
	width: number,
	height: number,
	startedAt: number,
	isLoading: boolean,
): SharedValue<ImageLoadingUniforms> => {
	const uniforms = useSharedValue<ImageLoadingUniforms>(
		resolveLoadingUniforms(width, height, startedAt),
	);

	useEffect(() => {
		uniforms.value = resolveLoadingUniforms(width, height, startedAt);
		if (
			!isLoading ||
			typeof window === "undefined" ||
			typeof window.requestAnimationFrame !== "function"
		) {
			return;
		}

		let frameId: number | null = null;
		const tick = () => {
			uniforms.value = resolveLoadingUniforms(width, height, startedAt);
			frameId = window.requestAnimationFrame(tick);
		};
		frameId = window.requestAnimationFrame(tick);

		return () => {
			if (frameId !== null) {
				window.cancelAnimationFrame(frameId);
			}
		};
	}, [height, isLoading, startedAt, uniforms, width]);

	return uniforms;
};

export const renderImageNodeTilePictureContent = (
	node: ImageCanvasNode,
	image: SkImage | null,
) => {
	if (!image) return null;

	const width = Math.max(1, node.width);
	const height = Math.max(1, node.height);

	return (
		<Rect x={0} y={0} width={width} height={height}>
			<ImageShader
				image={image}
				fit="contain"
				x={0}
				y={0}
				width={width}
				height={height}
			/>
		</Rect>
	);
};

export const ImageNodeSkiaRenderer: React.FC<
	CanvasNodeSkiaRenderProps<ImageCanvasNode>
> = ({ node, asset }) => {
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const activeRun = useNodeActiveAgentRun(node.id);
	const [image, setImage] = useState<SkImage | null>(null);
	const assetUri = useMemo(() => {
		if (node.type !== "image") return null;
		if (!asset || asset.kind !== "image") return null;
		return (
			resolveAssetPlayableUri(asset, {
				projectId: currentProjectId,
			}) ?? null
		);
	}, [node.type, asset, currentProjectId]);

	useEffect(() => {
		if (!assetUri) {
			setImage(null);
			return;
		}

		let disposed = false;
		let localHandle: AssetHandle<ImageAsset> | null = null;
		setImage(null);
		void (async () => {
			try {
				localHandle = await acquireImageAsset(assetUri);
				if (disposed) {
					localHandle.release();
					return;
				}
				setImage(localHandle.asset.image);
			} catch (error) {
				if (disposed) return;
				console.warn("加载画布图片失败:", error);
				setImage(null);
			}
		})();

		return () => {
			disposed = true;
			localHandle?.release();
		};
	}, [assetUri]);

	const renderImage =
		image ?? (assetUri ? peekImageAsset(assetUri)?.image : null);
	if (node.type !== "image") return null;
	const width = Math.max(1, node.width);
	const height = Math.max(1, node.height);

	if (!renderImage) {
		const isLoading = Boolean(activeRun);
		if (isLoading) {
			return (
				<ImageNodeLoadingPlaceholder
					width={width}
					height={height}
					startedAt={activeRun?.createdAt ?? Date.now()}
				/>
			);
		}
		return (
			<>
				<Rect
					x={0}
					y={0}
					width={width}
					height={height}
					color={isLoading ? "#0f3f5f" : "#27272a"}
				/>
				<Rect
					x={Math.max(8, width * 0.08)}
					y={Math.max(8, height * 0.08)}
					width={Math.max(1, width * 0.84)}
					height={Math.max(1, height * 0.84)}
					color={isLoading ? "#38bdf8" : "#3f3f46"}
					opacity={isLoading ? 0.28 : 0.18}
				/>
			</>
		);
	}

	return (
		<Rect x={0} y={0} width={width} height={height}>
			<ImageShader
				image={renderImage}
				fit="contain"
				x={0}
				y={0}
				width={width}
				height={height}
			/>
		</Rect>
	);
};

const ImageNodeLoadingPlaceholder: React.FC<{
	width: number;
	height: number;
	startedAt: number;
}> = ({ width, height, startedAt }) => {
	const uniforms = useImageLoadingUniforms(width, height, startedAt, true);
	const loadingEffect = getImageLoadingEffect();

	if (!loadingEffect) {
		return (
			<>
				<Rect x={0} y={0} width={width} height={height} color="#082f49" />
				<Rect
					x={Math.max(8, width * 0.08)}
					y={Math.max(8, height * 0.08)}
					width={Math.max(1, width * 0.84)}
					height={Math.max(1, height * 0.84)}
					color="#38bdf8"
					opacity={0.28}
				/>
			</>
		);
	}

	return (
		<Rect x={0} y={0} width={width} height={height} color="#020617">
			<Shader source={loadingEffect} uniforms={uniforms} />
		</Rect>
	);
};
