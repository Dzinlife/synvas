import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { EditorRuntime } from "@/editor/runtime/types";
import type { ComponentModel, ComponentModelStore } from "../model/types";

export interface HalationFilterLayerProps {
	intensity?: number;
	threshold?: number;
	radius?: number;
	diffusion?: number;
	warmness?: number;
	chromaticShift?: number;
}

export const HALATION_FILTER_DEFAULT_PROPS: Required<HalationFilterLayerProps> =
	{
		intensity: 0.45,
		threshold: 0.78,
		radius: 8,
		diffusion: 0.55,
		warmness: 0.6,
		chromaticShift: 1.2,
	};

export type HalationFilterLayerModelStore =
	ComponentModelStore<HalationFilterLayerProps>;

export function createHalationFilterLayerModel(
	id: string,
	initialProps: HalationFilterLayerProps,
	_runtime: EditorRuntime,
): HalationFilterLayerModelStore {
	return createStore<ComponentModel<HalationFilterLayerProps>>()(
		subscribeWithSelector((set, _get) => ({
			id,
			type: "Filter",
			props: {
				...HALATION_FILTER_DEFAULT_PROPS,
				...initialProps,
			},
			constraints: {
				canTrimStart: true,
				canTrimEnd: true,
			},
			internal: {},

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

			init: () => {},

			dispose: () => {},
		})),
	);
}
