import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { EditorRuntime } from "@/editor/runtime/types";
import type {
	ComponentModel,
	ComponentModelStore,
	ValidationResult,
} from "../model/types";

export type TransitionAudioCurve = "equal-power" | "linear";

export interface TransitionProps {
	audioCurve?: TransitionAudioCurve;
}

const normalizeAudioCurve = (
	value: unknown,
): TransitionAudioCurve | undefined => {
	if (value === "equal-power" || value === "linear") {
		return value;
	}
	return undefined;
};

export type TransitionModelStore = ComponentModelStore<TransitionProps>;

export function createTransitionModel(
	id: string,
	initialProps: TransitionProps = {},
	_runtime: EditorRuntime,
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
				const result = get().validate(partial);
				if (!result.valid) {
					return result;
				}
				const nextAudioCurve = normalizeAudioCurve(partial.audioCurve);
				set((state) => ({
					...state,
					props: {
						...get().props,
						...partial,
						...(partial.audioCurve !== undefined
							? { audioCurve: nextAudioCurve }
							: {}),
					},
				}));
				return result;
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

			validate: (newProps): ValidationResult => {
				if (
					newProps.audioCurve !== undefined &&
					normalizeAudioCurve(newProps.audioCurve) === undefined
				) {
					return {
						valid: false,
						errors: ["audioCurve must be equal-power or linear"],
					};
				}
				return { valid: true, errors: [] };
			},

			init: () => {},

			dispose: () => {},
		})),
	);
}
