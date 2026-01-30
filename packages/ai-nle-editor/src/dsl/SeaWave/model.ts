import type { SkRuntimeEffect } from "react-skia-lite";
import { Skia } from "react-skia-lite";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { ComponentModel, ComponentModelStore } from "../model/types";

export interface SeaWaveProps {
	speed?: number;
	amplitude?: number;
	frequency?: number;
	waveColor?: string;
	foamColor?: string;
	deepWaterColor?: string;
}

export interface SeaWaveInternal {
	shaderSource: SkRuntimeEffect | null;
	isReady: boolean;
}

export type SeaWaveModelStore = ComponentModelStore<
	SeaWaveProps,
	SeaWaveInternal
>;

const SEAWAVE_SHADER_CODE = `
uniform float iTime;
uniform vec2 iResolution;
uniform float amplitude;
uniform float frequency;
uniform vec3 waveColor;
uniform vec3 foamColor;
uniform vec3 deepWaterColor;

// 简单的哈希函数用于噪声
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// 2D 噪声函数
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i + vec2(0.0, 0.0)), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

// 分形布朗运动 (FBM) 用于模拟海浪的起伏
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  vec2 shift = vec2(100.0);
  mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
  for (int i = 0; i < 5; ++i) {
    v += a * noise(p);
    p = rot * p * 2.0 + shift;
    a *= 0.5;
  }
  return v;
}

// 单个波浪层
float wave(vec2 uv, float speed, float phase) {
  float time = iTime * speed + phase;
  float w = fbm(uv * frequency + vec2(time * 0.5, time * 0.2));
  // 使用 pow 使波浪顶部更尖锐，模拟波涛汹涌的效果
  return pow(w, 1.5) * amplitude;
}

vec4 main(vec2 pos) {
  vec2 uv = pos / iResolution;
  
  // 叠加多层不同频率和速度的波浪，营造层次感和不规则感
  float w1 = wave(uv * 1.5, 1.2, 0.0);
  float w2 = wave(uv * 2.5 + vec2(1.2, 3.4), 1.8, 1.5);
  float w3 = wave(uv * 4.0 + vec2(-2.1, 0.5), 2.5, 3.0);
  
  float combinedWave = (w1 + w2 * 0.6 + w3 * 0.3) / 1.9;
  
  // 根据波浪高度混合深水色和浅水色
  vec3 color = mix(deepWaterColor, waveColor, combinedWave);
  
  // 模拟浪尖处的泡沫效果
  float foamThreshold = 0.65;
  float foamNoise = noise(uv * 30.0 + iTime * 2.0) * 0.1;
  float foam = smoothstep(foamThreshold, foamThreshold + 0.15, combinedWave + foamNoise);
  color = mix(color, foamColor, foam);
  
  // 增加简单的光影高光
  float highlight = smoothstep(0.5, 0.9, combinedWave);
  color += highlight * 0.15;

  return vec4(color, 1.0);
}
`;

export function createSeaWaveModel(
	id: string,
	initialProps: SeaWaveProps,
): SeaWaveModelStore {
	const store = createStore<ComponentModel<SeaWaveProps, SeaWaveInternal>>()(
		subscribeWithSelector((set, get) => ({
			id,
			type: "Background",
			props: {
				speed: 1.0,
				amplitude: 1.0,
				frequency: 2.0,
				waveColor: "#1e3a8a", // 蓝色
				foamColor: "#ffffff", // 白色
				deepWaterColor: "#0f172a", // 深蓝色
				...initialProps,
			},
			constraints: {
				canTrimStart: true,
				canTrimEnd: true,
			},
			internal: {
				shaderSource: null,
				isReady: false,
			} satisfies SeaWaveInternal,

			setProps: (partial) => {
				set((state) => ({
					...state,
					props: { ...state.props, ...partial },
				}));
				return { valid: true, errors: [] };
			},

			setConstraints: (partial) => {
				set((state) => ({
					...state,
					constraints: { ...state.constraints, ...partial },
				}));
			},

			setInternal: (partial) => {
				set((state) => ({
					...state,
					internal: { ...state.internal, ...partial },
				}));
			},

			validate: () => ({ valid: true, errors: [] }),

			init: () => {
				try {
					const shaderSource = Skia.RuntimeEffect.Make(SEAWAVE_SHADER_CODE);
					set((state) => ({
						...state,
						internal: {
							shaderSource,
							isReady: true,
						} satisfies SeaWaveInternal,
					}));
				} catch (error) {
					console.error("Failed to create sea wave shader:", error);
					set((state) => ({
						...state,
						constraints: {
							...state.constraints,
							hasError: true,
							errorMessage:
								error instanceof Error ? error.message : String(error),
						},
					}));
				}
			},

			dispose: () => {
				set((state) => ({
					...state,
					internal: {
						shaderSource: null,
						isReady: false,
					} satisfies SeaWaveInternal,
				}));
			},
		})),
	);

	return store;
}
