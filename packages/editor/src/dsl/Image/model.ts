import type { AssetHandle } from "@/assets/AssetStore";
import { acquireImageAsset, type ImageAsset } from "@/assets/imageAsset";
import type { SkImage } from "react-skia-lite";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { EditorRuntime } from "@/editor/runtime/types";
import type { ComponentModel, ComponentModelStore } from "../model/types";

// Image 组件的 props 类型
export interface ImageProps {
	uri?: string;
}

// Image 组件的内部状态
export interface ImageInternal {
	image: SkImage | null;
	isReady: boolean;
	loadImage: (uri: string) => Promise<void>;
}

/**
 * 创建 Image Model
 */
export function createImageModel(
	id: string,
	initialProps: ImageProps,
	_runtime: EditorRuntime,
): ComponentModelStore<ImageProps, ImageInternal> {
	let initEpoch = 0;
	let assetHandle: AssetHandle<ImageAsset> | null = null;

	const loadImage = async (uri: string): Promise<boolean> => {
		initEpoch += 1;
		const currentInitEpoch = initEpoch;
		let localHandle: AssetHandle<ImageAsset> | null = null;
		try {
			localHandle = await acquireImageAsset(uri);
			if (currentInitEpoch !== initEpoch) {
				localHandle.release();
				return false;
			}
			if (!localHandle) {
				return false;
			}
			const resolvedHandle = localHandle;

			assetHandle?.release();
			assetHandle = resolvedHandle;

			store.setState((state) => ({
				...state,
					internal: {
						...state.internal,
						image: resolvedHandle.asset.image,
						isReady: true,
					},
				}));
			return true;
		} catch (err) {
			localHandle?.release();
			if (assetHandle === localHandle) {
				assetHandle = null;
			}
			if (currentInitEpoch !== initEpoch) {
				return false;
			}
			throw new Error(`Failed to load image from ${uri}: ${err}`);
		}
	};

	const store = createStore<ComponentModel<ImageProps, ImageInternal>>()(
		subscribeWithSelector((set, get) => ({
			id,
			type: "Image",
			props: initialProps,
			constraints: {
				isLoading: false,
				canTrimStart: true,
				canTrimEnd: true,
			},
			internal: {
				image: null,
				isReady: false,
				loadImage: async (uri) => {
					await loadImage(uri);
				},
			} satisfies ImageInternal,

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

			validate: (_newProps) => {
				const errors: string[] = [];
				// Image 组件没有特殊的验证规则
				return { valid: errors.length === 0, errors };
			},

			init: async () => {
				const { uri } = get().props;
				if (!uri) {
					return;
				}

				try {
					set((state) => ({
						...state,
						constraints: {
							...state.constraints,
							isLoading: true,
							hasError: false,
							errorMessage: undefined,
						},
					}));

					const applied = await loadImage(uri);
					if (!applied) return;

					set((state) => ({
						...state,
						constraints: { ...state.constraints, isLoading: false },
					}));
				} catch (err) {
					console.error(`Failed to load image for ${id}:`, err);
					set((state) => ({
						...state,
						constraints: {
							...state.constraints,
							isLoading: false,
							hasError: true,
							errorMessage: err instanceof Error ? err.message : String(err),
						},
					}));
				}
			},

			dispose: () => {
				initEpoch += 1;
				assetHandle?.release();
				assetHandle = null;
				set((state) => ({
					...state,
					internal: {
						...state.internal,
						image: null,
						isReady: false,
					},
				}));
			},

			waitForReady: () => {
				return new Promise<void>((resolve) => {
					const { internal } = get();
					if (internal.isReady) {
						resolve();
						return;
					}
					// 订阅状态变化
					const unsubscribe = store.subscribe(
						(state) => state.internal.isReady,
						(isReady) => {
							if (isReady) {
								unsubscribe();
								resolve();
							}
						},
					);
				});
			},
		})),
	);

	return store;
}
