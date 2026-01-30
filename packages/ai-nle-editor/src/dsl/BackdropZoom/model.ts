import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { ComponentModel, ComponentModelStore } from "../model/types";

export interface BackdropZoomProps {
	zoomFactor?: number;
}

export type BackdropZoomModelStore = ComponentModelStore<BackdropZoomProps>;

export function createBackdropZoomModel(
	id: string,
	initialProps: BackdropZoomProps,
): BackdropZoomModelStore {
	return createStore<ComponentModel<BackdropZoomProps>>()(
		subscribeWithSelector((set, get) => ({
			id,
			type: "Filter",
			props: {
				zoomFactor: 1.0,
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
