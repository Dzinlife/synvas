import type { SkRuntimeEffect } from "react-skia-lite";
import { Skia } from "react-skia-lite";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { ComponentModel, ComponentModelStore } from "../model/types";
export interface CloudBackgroundProps {
	speed?: number;
	cloudDensity?: number;
	skyColor?: string;
	cloudColor?: string;
}

export interface CloudBackgroundInternal {
	shaderSource: SkRuntimeEffect | null;
	isReady: boolean;
}

export type CloudBackgroundModelStore =
	ComponentModelStore<CloudBackgroundProps, CloudBackgroundInternal>;

const CLOUD_SHADER_CODE = `
uniform float iTime;
uniform vec2 iResolution;
uniform float cloudDensity;
uniform vec3 skyColor;
uniform vec3 cloudColor;

float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

float noise(vec2 st) {
  vec2 i = floor(st);
  vec2 f = fract(st);
  float a = random(i);
  float b = random(i + vec2(1.0, 0.0));
  float c = random(i + vec2(0.0, 1.0));
  float d = random(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 st) {
  float value = 0.0;
  float amplitude = 0.5;
  float frequency = 0.0;

  for (int i = 0; i < 6; i++) {
    value += amplitude * noise(st);
    st *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

float cloudShape(vec2 uv, vec2 offset, float scale, float speed) {
  vec2 cloudUV = (uv + offset) * scale + vec2(iTime * speed, iTime * speed * 0.3);
  float cloud = fbm(cloudUV);
  cloud = smoothstep(0.3, 0.7, cloud);
  float verticalGradient = 1.0 - uv.y * 0.3;
  cloud *= verticalGradient;
  return cloud;
}

vec4 main(vec2 pos) {
  vec2 uv = pos / iResolution;
  float clouds = 0.0;

  float cloud1 = cloudShape(uv, vec2(0.0, 0.2), 0.8, 0.1);
  clouds = max(clouds, cloud1 * 0.8);

  float cloud2 = cloudShape(uv, vec2(0.3, 0.4), 1.2, 0.15);
  clouds = max(clouds, cloud2 * 0.7);

  float cloud3 = cloudShape(uv, vec2(0.6, 0.1), 1.8, 0.2);
  clouds = max(clouds, cloud3 * 0.6);

  float cloud4 = cloudShape(uv, vec2(-0.2, 0.5), 0.5, 0.05);
  clouds = max(clouds, cloud4 * 0.5);

  float cloud5 = cloudShape(uv, vec2(0.8, 0.3), 2.5, 0.25);
  clouds = max(clouds, cloud5 * 0.4);

  clouds *= cloudDensity;
  clouds = clamp(clouds, 0.0, 1.0);

  vec3 color = mix(skyColor, cloudColor, clouds);

  float atmosphere = 1.0 - uv.y * 0.2;
  color *= atmosphere;

  vec3 cloudTint = mix(cloudColor, vec3(0.95, 0.95, 1.0), 0.3);
  color = mix(color, cloudTint, clouds * 0.2);

  return vec4(color, 1.0);
}`;

export function createCloudBackgroundModel(
	id: string,
	initialProps: CloudBackgroundProps,
): CloudBackgroundModelStore {
	const store = createStore<
		ComponentModel<CloudBackgroundProps, CloudBackgroundInternal>
	>()(
		subscribeWithSelector((set, get) => ({
			id,
			type: "Background",
			props: {
				speed: 1.0,
				cloudDensity: 1.0,
				skyColor: "#87CEEB",
				cloudColor: "#FFFFFF",
				...initialProps,
			},
			constraints: {
				canTrimStart: true,
				canTrimEnd: true,
			},
			internal: {
				shaderSource: null,
				isReady: false,
			} satisfies CloudBackgroundInternal,

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
					const shaderSource = Skia.RuntimeEffect.Make(CLOUD_SHADER_CODE);
					set((state) => ({
						...state,
						internal: {
							shaderSource,
							isReady: true,
						} satisfies CloudBackgroundInternal,
					}));
				} catch (error) {
					console.error("Failed to create cloud shader:", error);
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
					} satisfies CloudBackgroundInternal,
				}));
			},
		})),
	);

	return store;
}
