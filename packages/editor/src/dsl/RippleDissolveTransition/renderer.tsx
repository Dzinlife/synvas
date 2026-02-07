import type React from "react";
import type { ReactNode } from "react";
import { useEffect, useMemo } from "react";
import type { SkPicture } from "react-skia-lite";
import {
	FilterMode,
	Group,
	processUniforms,
	Rect,
	Skia,
	TileMode,
} from "react-skia-lite";
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
uniform float glow;
uniform float aberration;
uniform float grain;
uniform float vignette;
uniform float envelopeInEnd;
uniform float envelopeOutStart;
uniform float cinematicPower;
uniform float flowSkew;
uniform float flowMix;
uniform float fromDisplace;
uniform float toDisplace;
uniform float edgeNoiseScale;
uniform float flutterScale;
uniform float featherScale;
uniform float featherBias;
uniform float edgeBandScale;
uniform float chromaScale;
uniform float chromaMix;
uniform float glowBase;
uniform float glowPulseWeight;
uniform float grainBase;
uniform float grainEdge;
uniform float vignetteInner;
uniform float vignetteOuter;
uniform float vignetteStrength;
uniform float flickerStrength;

float hash21(float2 p) {
  p = fract(p * float2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise21(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float a = hash21(i);
  float b = hash21(i + float2(1.0, 0.0));
  float c = hash21(i + float2(0.0, 1.0));
  float d = hash21(i + float2(1.0, 1.0));
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(float2 p) {
  float value = 0.0;
  value += 0.55 * noise21(p);
  p = p * 2.1 + float2(37.1, 17.6);
  value += 0.30 * noise21(p);
  p = p * 2.0 + float2(11.4, 41.8);
  value += 0.15 * noise21(p);
  return value;
}

half4 main(float2 xy) {
  float2 uv = xy / iResolution;
  float2 centered = uv - 0.5;
  float aspect = iResolution.x / max(iResolution.y, 1.0);
  centered.x *= aspect;
  float radius = length(centered);
  float2 dir = centered / max(radius, 0.0001);
  float minDim = min(iResolution.x, iResolution.y);
  float2 bounds = max(iResolution - 1.0, float2(0.0));

  float t = clamp(progress, 0.0, 1.0);
  float easedT = t * t * (3.0 - 2.0 * t);
  float edgeIn = smoothstep(0.0, envelopeInEnd, t);
  float edgeOut = 1.0 - smoothstep(envelopeOutStart, 1.0, t);
  float transitionEnvelope = edgeIn * edgeOut;
  float cinematicEnvelope = max(sin(t * 3.1415926), 0.0);
  cinematicEnvelope = pow(cinematicEnvelope, cinematicPower);

  float phase = radius * frequency * 6.2831853 - easedT * speed * 7.5398224;
  float ripple = sin(phase) * 0.5 + 0.5;
  float microRipple = sin(
    radius * frequency * 14.4513262 - easedT * speed * 10.681415 +
      fbm(uv * 6.0 + float2(easedT * 0.6, -easedT * 0.4)) * 3.1415926
  ) * 0.5 + 0.5;

  float dynamicStrength = strength * transitionEnvelope * (0.75 + 0.25 * (sin(easedT * 3.1415926) * 0.5 + 0.5));
  float flowNoise = (fbm(uv * 4.5 + float2(easedT * 1.2, -easedT * 1.0)) - 0.5) * softness * transitionEnvelope;
  float2 displacement = dir * (ripple * 2.0 - 1.0) * dynamicStrength;
  displacement += float2(flowNoise, -flowNoise * flowSkew) * flowMix;

  float2 fromUv = uv + displacement * (1.0 - easedT) * fromDisplace;
  float2 toUv = uv - displacement * easedT * toDisplace;
  float2 fromSample = clamp(fromUv * iResolution, float2(0.0), bounds);
  float2 toSample = clamp(toUv * iResolution, float2(0.0), bounds);

  half4 fromBase = preRoll.eval(fromSample);
  half4 toBase = afterRoll.eval(toSample);

  float edgeNoise = (fbm(uv * 8.0 + float2(0.0, easedT * 1.7)) - 0.5) * softness * edgeNoiseScale * transitionEnvelope;
  float waveBend = (ripple * 2.0 - 1.0) * dynamicStrength * (1.2 - min(radius, 1.2));
  float flutter = (microRipple * 2.0 - 1.0) * softness * flutterScale * transitionEnvelope;
  float frontier = easedT + waveBend + flutter + edgeNoise;
  float feather = softness * featherScale + featherBias;
  float rawMask = smoothstep(radius - feather, radius + feather, frontier);
  float baseMask = smoothstep(envelopeInEnd, envelopeOutStart, t);
  float maskBlend = transitionEnvelope * transitionEnvelope;
  float mask = clamp(mix(baseMask, rawMask, maskBlend), 0.0, 1.0);

  float edgeDistance = abs(frontier - radius);
  float edgeBand = (1.0 - smoothstep(0.0, feather * edgeBandScale, edgeDistance)) * transitionEnvelope;

  float chromaAmount = aberration * edgeBand * (1.0 - min(radius, 1.0)) * minDim * chromaScale;
  float2 caOffset = dir * chromaAmount;
  float2 caSampleR = clamp(fromSample + caOffset, float2(0.0), bounds);
  float2 caSampleB = clamp(fromSample - caOffset, float2(0.0), bounds);
  half fromR = preRoll.eval(caSampleR).r;
  half fromB = preRoll.eval(caSampleB).b;
  half3 fromRgb = mix(fromBase.rgb, half3(fromR, fromBase.g, fromB), half(edgeBand * chromaMix));

  half4 fromColor = half4(fromRgb, fromBase.a);
  half4 mixed = mix(fromColor, toBase, mask);

  float glowPulseValue = sin(easedT * 3.1415926);
  float glowStrength = glow * edgeBand * (glowBase + glowPulseWeight * glowPulseValue);
  float3 finalRgb = float3(mixed.rgb);
  finalRgb += float3(1.0, 0.78, 0.62) * glowStrength;

  float grainValue = hash21(xy + float2(easedT * 173.0, easedT * 41.0)) - 0.5;
  finalRgb += grainValue * grain * (grainBase + edgeBand * grainEdge) * cinematicEnvelope;

  float vignetteMask = 1.0 - smoothstep(vignetteInner, vignetteOuter, radius);
  finalRgb *= 1.0 - vignette * (1.0 - vignetteMask) * vignetteStrength * cinematicEnvelope;

  float flicker = 1.0 + (hash21(float2(easedT * 97.0, easedT * 33.0)) - 0.5) * grain * flickerStrength * cinematicEnvelope;
  finalRgb *= flicker;

  float alpha = mix(float(fromBase.a), float(toBase.a), mask);
  return half4(half3(clamp(finalRgb, 0.0, 1.0)), half(clamp(alpha, 0.0, 1.0)));
}
`;

const DEFAULT_TRANSITION_DURATION = 15;
const RIPPLE_FREQUENCY = 10;
const RIPPLE_STRENGTH = 0.11;
const RIPPLE_SOFTNESS = 0.05;
const RIPPLE_SPEED = 1.35;
const RIPPLE_GLOW = 0.42;
const RIPPLE_ABERRATION = 0.85;
const RIPPLE_GRAIN = 0.035;
const RIPPLE_VIGNETTE = 0.4;
// 调参入口：直接改这些常量即可快速预览不同风格
const RIPPLE_ENVELOPE_IN_END = 0.4;
const RIPPLE_ENVELOPE_OUT_START = 0.6;
const RIPPLE_CINEMATIC_POWER = 1.35;
const RIPPLE_FLOW_SKEW = 0.7;
const RIPPLE_FLOW_MIX = 0.45;
const RIPPLE_FROM_DISPLACE = 0.75;
const RIPPLE_TO_DISPLACE = 0.5;
const RIPPLE_EDGE_NOISE_SCALE = 1.6;
const RIPPLE_FLUTTER_SCALE = 0.75;
const RIPPLE_FEATHER_SCALE = 1.9;
const RIPPLE_FEATHER_BIAS = 0.012;
const RIPPLE_EDGE_BAND_SCALE = 2.4;
const RIPPLE_CHROMA_SCALE = 0.003;
const RIPPLE_CHROMA_MIX = 0.7;
const RIPPLE_GLOW_BASE = 0.4;
const RIPPLE_GLOW_PULSE_WEIGHT = 0.6;
const RIPPLE_GRAIN_BASE = 0.35;
const RIPPLE_GRAIN_EDGE = 0.65;
const RIPPLE_VIGNETTE_INNER = 0.28;
const RIPPLE_VIGNETTE_OUTER = 1.1;
const RIPPLE_VIGNETTE_STRENGTH = 0.32;
const RIPPLE_FLICKER_STRENGTH = 0.22;

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
	const transitionElement = useTimelineStore((state) =>
		state.getElementById(id),
	);
	const canvasSize = useTimelineStore((state) => state.canvasSize);
	const start = transitionElement?.timeline.start ?? 0;
	const transitionDuration = resolveTransitionDuration(
		transitionElement ?? undefined,
	);
	const boundary = transitionElement
		? getTransitionBoundary(transitionElement)
		: start + transitionDuration * 0.5;

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
			glow: RIPPLE_GLOW,
			aberration: RIPPLE_ABERRATION,
			grain: RIPPLE_GRAIN,
			vignette: RIPPLE_VIGNETTE,
			envelopeInEnd: RIPPLE_ENVELOPE_IN_END,
			envelopeOutStart: RIPPLE_ENVELOPE_OUT_START,
			cinematicPower: RIPPLE_CINEMATIC_POWER,
			flowSkew: RIPPLE_FLOW_SKEW,
			flowMix: RIPPLE_FLOW_MIX,
			fromDisplace: RIPPLE_FROM_DISPLACE,
			toDisplace: RIPPLE_TO_DISPLACE,
			edgeNoiseScale: RIPPLE_EDGE_NOISE_SCALE,
			flutterScale: RIPPLE_FLUTTER_SCALE,
			featherScale: RIPPLE_FEATHER_SCALE,
			featherBias: RIPPLE_FEATHER_BIAS,
			edgeBandScale: RIPPLE_EDGE_BAND_SCALE,
			chromaScale: RIPPLE_CHROMA_SCALE,
			chromaMix: RIPPLE_CHROMA_MIX,
			glowBase: RIPPLE_GLOW_BASE,
			glowPulseWeight: RIPPLE_GLOW_PULSE_WEIGHT,
			grainBase: RIPPLE_GRAIN_BASE,
			grainEdge: RIPPLE_GRAIN_EDGE,
			vignetteInner: RIPPLE_VIGNETTE_INNER,
			vignetteOuter: RIPPLE_VIGNETTE_OUTER,
			vignetteStrength: RIPPLE_VIGNETTE_STRENGTH,
			flickerStrength: RIPPLE_FLICKER_STRENGTH,
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
			paintBundle.children.forEach((child) => {
				child.dispose();
			});
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
