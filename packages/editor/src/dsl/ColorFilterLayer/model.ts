import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { ComponentModel, ComponentModelStore } from "../model/types";
export interface ColorFilterLayerProps {
	hue?: number;
	saturation?: number;
	brightness?: number;
	contrast?: number;
}

export type ColorFilterLayerModelStore =
	ComponentModelStore<ColorFilterLayerProps>;

export function createColorFilterLayerModel(
	id: string,
	initialProps: ColorFilterLayerProps,
): ColorFilterLayerModelStore {
	return createStore<ComponentModel<ColorFilterLayerProps>>()(
		subscribeWithSelector((set, get) => ({
			id,
			type: "Filter",
			props: {
				hue: 0,
				saturation: 0,
				brightness: 0,
				contrast: 0,
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
