import type {
	HdrTestCanvasNode,
	HdrTestColorPreset,
} from "@/studio/project/types";
import { Rect, Shader, Skia, type SkRuntimeEffect } from "react-skia-lite";
import type { CanvasNodeSkiaRenderProps } from "../types";

const HDR_TEST_SHADER = `
uniform float2 resolution;
uniform float preset;
uniform float brightness;

float3 selectedColor(float2 uv) {
	float safeBrightness = max(brightness, 0.0);
	if (preset < 0.5) {
		return float3(1.0) * safeBrightness;
	}
	if (preset < 1.5) {
		return float3(1.0, 0.0, 0.0) * safeBrightness;
	}
	if (preset < 2.5) {
		return float3(1.0) * safeBrightness;
	}
	if (preset < 3.5) {
		return float3(1.0, 0.08, 0.02) * safeBrightness;
	}
	float ramp = mix(0.0, 4.0, clamp(uv.x, 0.0, 1.0));
	return float3(ramp, ramp * 0.72, ramp * 0.42);
}

half4 main(float2 xy) {
	float2 safeResolution = max(resolution, float2(1.0));
	float2 uv = xy / safeResolution;
	float3 rgb;
	if (uv.x < 0.30) {
		rgb = float3(1.0);
	} else if (uv.x < 0.64) {
		rgb = selectedColor(uv);
	} else {
		float ramp = mix(0.0, 4.0, clamp((uv.x - 0.64) / 0.36, 0.0, 1.0));
		rgb = float3(ramp);
	}
	float divider = step(abs(uv.x - 0.30), 0.003) + step(abs(uv.x - 0.64), 0.003);
	if (divider > 0.0) {
		rgb = float3(0.08);
	}
	float border = step(uv.x, 0.006) + step(uv.y, 0.010) + step(0.994, uv.x) + step(0.990, uv.y);
	if (border > 0.0) {
		rgb = float3(0.12);
	}
	return half4(rgb, 1.0);
}
`;

const PRESET_INDEX_BY_KEY: Record<HdrTestColorPreset, number> = {
	"sdr-white": 0,
	"p3-red": 1,
	"hdr-white": 2,
	"hdr-red": 3,
	"hdr-gradient": 4,
};

let cachedHdrTestEffect: SkRuntimeEffect | null | undefined;

const getHdrTestEffect = (): SkRuntimeEffect | null => {
	if (cachedHdrTestEffect !== undefined) {
		return cachedHdrTestEffect;
	}
	cachedHdrTestEffect = Skia.RuntimeEffect.Make(HDR_TEST_SHADER);
	return cachedHdrTestEffect;
};

const clampBrightness = (value: number): number => {
	if (!Number.isFinite(value)) return 2;
	return Math.min(4, Math.max(0, value));
};

export const HdrTestNodeSkiaRenderer: React.FC<
	CanvasNodeSkiaRenderProps<HdrTestCanvasNode>
> = ({ node }) => {
	if (node.type !== "hdr-test") return null;
	const width = Math.max(1, Math.round(Math.abs(node.width)));
	const height = Math.max(1, Math.round(Math.abs(node.height)));
	const effect = getHdrTestEffect();
	if (!effect) {
		return <Rect x={0} y={0} width={width} height={height} color="#18181b" />;
	}
	return (
		<Rect x={0} y={0} width={width} height={height} color="#000">
			<Shader
				source={effect}
				uniforms={{
					resolution: [width, height],
					preset: PRESET_INDEX_BY_KEY[node.colorPreset] ?? 2,
					brightness: clampBrightness(node.brightness),
				}}
			/>
		</Rect>
	);
};
