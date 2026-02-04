import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type {
	ComponentModel,
	ComponentModelStore,
	ValidationResult,
} from "../model/types";

export interface AudioClipProps {
	uri?: string;
}

export interface AudioClipInternal {
	isReady: boolean;
}

export function createAudioClipModel(
	id: string,
	initialProps: AudioClipProps,
): ComponentModelStore<AudioClipProps, AudioClipInternal> {
	const store = createStore<ComponentModel<AudioClipProps, AudioClipInternal>>()(
		subscribeWithSelector((set, get) => ({
			id,
			type: "AudioClip",
			props: initialProps,
			constraints: {
				canTrimStart: true,
				canTrimEnd: true,
			},
			internal: {
				isReady: true,
			} satisfies AudioClipInternal,

			setProps: (partial) => {
				const result = get().validate(partial);
				if (result.valid) {
					set((state) => ({
						...state,
						props: { ...state.props, ...partial },
					}));
				}
				return result;
			},

			setConstraints: (partial) => {
				set((state) => ({
					constraints: { ...state.constraints, ...partial },
				}));
			},

			setInternal: (partial) => {
				set((state) => ({
					internal: { ...state.internal, ...partial },
				}));
			},

			validate: (_newProps): ValidationResult => {
				return { valid: true, errors: [] };
			},

			init: () => {
				// 音频片段当前不需要异步初始化
			},

			dispose: () => {
				set((state) => ({
					...state,
					internal: { ...state.internal, isReady: false },
				}));
			},
		})),
	);

	return store;
}
