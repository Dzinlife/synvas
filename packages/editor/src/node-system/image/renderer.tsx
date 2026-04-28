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

const IMAGE_NODE_LOADING_SHADER_CODE = `
uniform vec2 uResolution;
uniform float uTime;

const vec3 BG_COLOR = vec3(0.0196, 0.0196, 0.0196);
const vec3 ASCII_LIGHT = vec3(1.0, 1.0, 1.0);
const vec3 ASCII_MID = vec3(0.3176, 0.3373, 0.3529);
const vec3 ASCII_DARK = vec3(0.1020, 0.1098, 0.1137);

vec3 palette(float g) {
	float t = clamp(g, 0.0, 1.0) * 2.0;
	vec3 firstHalf = mix(ASCII_LIGHT, ASCII_MID, clamp(t, 0.0, 1.0));
	return mix(firstHalf, ASCII_DARK, clamp(t - 1.0, 0.0, 1.0));
}

float slashGlyph(vec2 cellUv) {
	float centerX = mix(0.66, 0.34, cellUv.y);
	float line = 1.0 - smoothstep(0.035, 0.085, abs(cellUv.x - centerX));
	float inset = 0.11;
	float bounds =
		smoothstep(0.0, inset, cellUv.x) *
		smoothstep(0.0, inset, 1.0 - cellUv.x) *
		smoothstep(0.05, 0.17, cellUv.y) *
		smoothstep(0.05, 0.17, 1.0 - cellUv.y);
	return line * bounds;
}

vec3 mod289(vec3 x) {
	return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
	return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
	return mod289(((x * 34.0) + 1.0) * x);
}

vec4 taylorInvSqrt(vec4 r) {
	return 1.79284291400159 - 0.85373472095314 * r;
}

float snoise(vec3 v) {
	const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
	const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
	vec3 i = floor(v + dot(v, C.yyy));
	vec3 x0 = v - i + dot(i, C.xxx);
	vec3 g = step(x0.yzx, x0.xyz);
	vec3 l = 1.0 - g;
	vec3 i1 = min(g.xyz, l.zxy);
	vec3 i2 = max(g.xyz, l.zxy);
	vec3 x1 = x0 - i1 + C.xxx;
	vec3 x2 = x0 - i2 + C.yyy;
	vec3 x3 = x0 - D.yyy;
	i = mod289(i);
	vec4 p = permute(permute(permute(
		i.z + vec4(0.0, i1.z, i2.z, 1.0))
		+ i.y + vec4(0.0, i1.y, i2.y, 1.0))
		+ i.x + vec4(0.0, i1.x, i2.x, 1.0));
	float n_ = 0.142857142857;
	vec3 ns = n_ * D.wyz - D.xzx;
	vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
	vec4 x_ = floor(j * ns.z);
	vec4 y_ = floor(j - 7.0 * x_);
	vec4 x = x_ * ns.x + ns.yyyy;
	vec4 y = y_ * ns.x + ns.yyyy;
	vec4 h = 1.0 - abs(x) - abs(y);
	vec4 b0 = vec4(x.xy, y.xy);
	vec4 b1 = vec4(x.zw, y.zw);
	vec4 s0 = floor(b0) * 2.0 + 1.0;
	vec4 s1 = floor(b1) * 2.0 + 1.0;
	vec4 sh = -step(h, vec4(0.0));
	vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
	vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
	vec3 p0 = vec3(a0.xy, h.x);
	vec3 p1 = vec3(a0.zw, h.y);
	vec3 p2 = vec3(a1.xy, h.z);
	vec3 p3 = vec3(a1.zw, h.w);
	vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
	p0 *= norm.x;
	p1 *= norm.y;
	p2 *= norm.z;
	p3 *= norm.w;
	vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
	m = m * m;
	return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

vec3 hsv2rgb(vec3 c) {
	vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
	vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
	return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

vec4 main(vec2 pos) {
	vec2 resolution = max(uResolution, vec2(1.0));
	float cellSize = 19.111111;
	float quantSize = cellSize * 2.0;
	vec2 quantizedPos = floor(pos / quantSize) * quantSize + quantSize * 0.5;
	vec2 uv = quantizedPos / resolution;
	float aspect = resolution.x / max(resolution.y, 1.0);
	vec2 noiseUv = (uv - 0.5) * vec2(aspect, 1.0) + 0.5;
	float hue = abs(snoise(vec3(noiseUv * 1.2, uTime * 0.3)));
	vec3 sourceColor = hsv2rgb(vec3(hue, 1.0, 1.0));
	float gray = dot(sourceColor, vec3(0.3, 0.59, 0.11));
	gray = pow(clamp(gray, 0.0001, 1.0), 2.5);
	vec3 asciiColor = palette(gray - 0.065);

	vec2 cellUv = fract(pos / cellSize);
	float charAlpha = slashGlyph(cellUv);
	vec3 color = mix(BG_COLOR, asciiColor, charAlpha);
	return vec4(color, 1.0);
}
`;

interface ImageLoadingUniforms {
	[name: string]: number | [number, number];
	uResolution: [number, number];
	uTime: number;
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
		<Rect x={0} y={0} width={width} height={height} color="#050505">
			<Shader source={loadingEffect} uniforms={uniforms} />
		</Rect>
	);
};
