import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type {
	ComponentModel,
	ComponentModelStore,
	ValidationResult,
} from "../model/types";

export interface TransitionProps {}

export type TransitionModelStore = ComponentModelStore<TransitionProps>;

export function createTransitionModel(
	id: string,
	initialProps: TransitionProps = {},
): TransitionModelStore {
	return createStore<ComponentModel<TransitionProps>>()(
		subscribeWithSelector((set, get) => ({
			id,
			type: "Transition",
			props: {
				...initialProps,
			},
			constraints: {
				canTrimStart: false,
				canTrimEnd: false,
			},
			internal: {},

			setProps: (partial) => {
				set((state) => ({
					...state,
					props: { ...get().props, ...partial },
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

			validate: (_newProps): ValidationResult => {
				return { valid: true, errors: [] };
			},

			init: () => {},

			dispose: () => {},
		})),
	);
}
