import type { CompositionProps } from "core/element/types";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { EditorRuntime } from "@/scene-editor/runtime/types";
import type {
	ComponentModel,
	ComponentModelStore,
	ValidationResult,
} from "../model/types";

const validateSceneId = (sceneId: unknown): ValidationResult => {
	if (typeof sceneId !== "string" || sceneId.trim().length === 0) {
		return {
			valid: false,
			errors: ["sceneId is required"],
		};
	}
	return { valid: true, errors: [] };
};

export type CompositionModelStore = ComponentModelStore<CompositionProps>;

export function createCompositionModel(
	id: string,
	initialProps: CompositionProps,
	_runtime: EditorRuntime,
): CompositionModelStore {
	const initialValidation = validateSceneId(initialProps.sceneId);
	const initialSceneId = initialValidation.valid
		? initialProps.sceneId.trim()
		: "";

	return createStore<ComponentModel<CompositionProps>>()(
		subscribeWithSelector((set, get) => ({
			id,
			type: "Composition",
			props: {
				sceneId: initialSceneId,
			},
			constraints: {
				canTrimStart: true,
				canTrimEnd: true,
			},
			internal: {},

			setProps: (partial) => {
				const nextSceneId =
					partial.sceneId ?? (get().props.sceneId as unknown as string);
				const result = validateSceneId(nextSceneId);
				if (!result.valid) return result;
				set((state) => ({
					...state,
					props: {
						...state.props,
						...partial,
						sceneId: String(nextSceneId).trim(),
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

			validate: (newProps) => validateSceneId(newProps.sceneId),

			init: () => {},

			dispose: () => {},
		})),
	);
}
