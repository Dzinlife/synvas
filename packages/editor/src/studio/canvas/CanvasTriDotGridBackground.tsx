import { useMemo } from "react";
import { Rect, Shader, Skia } from "react-skia-lite";

interface CanvasTriDotGridCamera {
	x: number;
	y: number;
	zoom: number;
}

interface CanvasTriDotGridBackgroundProps {
	width: number;
	height: number;
	camera: CanvasTriDotGridCamera;
}

const DOT_GRID_BASE_SPACING_WORLD = 40;
const DOT_GRID_DOT_RADIUS_PX = 0.9;
const DOT_GRID_DOT_SOFTNESS_PX = 0.85;
const DOT_GRID_BASE_ALPHA = 0.15;
const DOT_GRID_DETAIL_ALPHA = 0.2;
const DOT_GRID_DETAIL_MIN_RADIUS_RATIO = 0;
const DOT_GRID_DETAIL_SIZE_EASE_POWER = 0.72;
const DOT_GRID_DETAIL_MIN_OPACITY = 0;
const DOT_GRID_DETAIL_OPACITY_EASE_POWER = 1.0;
const DOT_GRID_FADE_START = 0;
const DOT_GRID_FADE_END = 1.0;
const DOT_GRID_CAMERA_PARALLAX_FACTOR = 0.9;
const ZOOM_EPSILON = 1e-6;

export const TRI_DOT_GRID_SHADER_CODE = `
uniform vec2 uResolution;
uniform vec2 uCamera;
uniform float uZoom;
uniform float uLevel;
uniform float uFade;
uniform float uBaseSpacingWorld;
uniform float uDotRadiusPx;
uniform float uSoftnessPx;
uniform float uBaseAlpha;
uniform float uDetailAlpha;
uniform float uDetailMinRadiusRatio;
uniform float uDetailSizeEasePower;
uniform float uDetailMinOpacity;
uniform float uDetailOpacityEasePower;
uniform float uCameraParallaxFactor;

const vec3 DOT_COLOR = vec3(1.0, 1.0, 1.0);
const float TRI_ROW_RATIO = 0.8660254037844386;

vec2 nearestTriLatticePoint(vec2 worldPos, float spacingWorld) {
  float rowHeight = spacingWorld * TRI_ROW_RATIO;
  float rowBase = floor(worldPos.y / rowHeight);

  float shift0 = mod(rowBase, 2.0) * 0.5;
  float col0 = floor(worldPos.x / spacingWorld - shift0 + 0.5);
  vec2 candidate0 = vec2((col0 + shift0) * spacingWorld, rowBase * rowHeight);

  float rowNext = rowBase + 1.0;
  float shift1 = mod(rowNext, 2.0) * 0.5;
  float col1 = floor(worldPos.x / spacingWorld - shift1 + 0.5);
  vec2 candidate1 = vec2((col1 + shift1) * spacingWorld, rowNext * rowHeight);

  float dist0 = distance(worldPos, candidate0);
  float dist1 = distance(worldPos, candidate1);
  return dist0 <= dist1 ? candidate0 : candidate1;
}

float triDotMask(
  vec2 worldPos,
  float spacingWorld,
  float zoomScale,
  float dotRadiusPx,
  float dotSoftnessPx
) {
  vec2 nearestDot = nearestTriLatticePoint(worldPos, spacingWorld);
  float distPx = distance(worldPos, nearestDot) * zoomScale;
  return 1.0 - smoothstep(dotRadiusPx, dotRadiusPx + dotSoftnessPx, distPx);
}

vec4 main(vec2 pos) {
  float safeZoom = max(uZoom, 0.000001);
  vec2 worldPos = pos / safeZoom - (uCamera * uCameraParallaxFactor);

  float spacing0 = uBaseSpacingWorld / exp2(uLevel);
  float spacing1 = spacing0 * 0.5;

  float fade = clamp(uFade, 0.0, 1.0);
  float detailSizeFade = pow(fade, max(uDetailSizeEasePower, 0.0001));
  float detailOpacityFade = pow(fade, max(uDetailOpacityEasePower, 0.0001));

  float baseMask = triDotMask(
    worldPos,
    spacing0,
    safeZoom,
    uDotRadiusPx,
    uSoftnessPx
  );

  float detailRadiusPx = mix(
    uDotRadiusPx * uDetailMinRadiusRatio,
    uDotRadiusPx,
    detailSizeFade
  );
  float detailSoftnessPx = mix(uSoftnessPx * 1.5, uSoftnessPx, detailSizeFade);
  float detailMask = triDotMask(
    worldPos,
    spacing1,
    safeZoom,
    detailRadiusPx,
    detailSoftnessPx
  );
  float detailOnly = max(0.0, detailMask - baseMask);
  float detailOpacity = mix(
    clamp(uDetailMinOpacity, 0.0, 1.0),
    1.0,
    detailOpacityFade
  );

  float alpha = clamp(
    baseMask * uBaseAlpha + detailOnly * uDetailAlpha * detailOpacity,
    0.0,
    1.0
  );
  return vec4(DOT_COLOR * alpha, alpha);
}
`;

const clamp01 = (value: number): number => {
	return Math.max(0, Math.min(1, value));
};

const smoothstep = (edge0: number, edge1: number, x: number): number => {
	if (edge0 === edge1) return x < edge0 ? 0 : 1;
	const t = clamp01((x - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
};

export const resolveDotGridLod = (
	zoom: number,
): { level: number; fade: number } => {
	const safeZoom = Number.isFinite(zoom) ? Math.max(zoom, ZOOM_EPSILON) : 1;
	const zoomLevel = Math.log2(safeZoom);
	const level = Math.floor(zoomLevel);
	const fadeProgress = zoomLevel - level;
	return {
		level,
		fade: smoothstep(DOT_GRID_FADE_START, DOT_GRID_FADE_END, fadeProgress),
	};
};

export const CanvasTriDotGridBackground = ({
	width,
	height,
	camera,
}: CanvasTriDotGridBackgroundProps) => {
	const shaderSource = useMemo(() => {
		try {
			return Skia.RuntimeEffect.Make(TRI_DOT_GRID_SHADER_CODE);
		} catch (error) {
			console.error("Failed to create canvas tri dot grid shader:", error);
			return null;
		}
	}, []);

	const lod = useMemo(() => {
		return resolveDotGridLod(camera.zoom);
	}, [camera.zoom]);

	if (width <= 0 || height <= 0 || !shaderSource) return null;

	return (
		<Rect x={0} y={0} width={width} height={height}>
			<Shader
				source={shaderSource}
				uniforms={{
					uResolution: [width, height],
					uCamera: [camera.x, camera.y],
					uZoom: camera.zoom,
					uLevel: lod.level,
					uFade: lod.fade,
					uBaseSpacingWorld: DOT_GRID_BASE_SPACING_WORLD,
					uDotRadiusPx: DOT_GRID_DOT_RADIUS_PX,
					uSoftnessPx: DOT_GRID_DOT_SOFTNESS_PX,
					uBaseAlpha: DOT_GRID_BASE_ALPHA,
					uDetailAlpha: DOT_GRID_DETAIL_ALPHA,
					uDetailMinRadiusRatio: DOT_GRID_DETAIL_MIN_RADIUS_RATIO,
					uDetailSizeEasePower: DOT_GRID_DETAIL_SIZE_EASE_POWER,
					uDetailMinOpacity: DOT_GRID_DETAIL_MIN_OPACITY,
					uDetailOpacityEasePower: DOT_GRID_DETAIL_OPACITY_EASE_POWER,
					uCameraParallaxFactor: DOT_GRID_CAMERA_PARALLAX_FACTOR,
				}}
			/>
		</Rect>
	);
};
