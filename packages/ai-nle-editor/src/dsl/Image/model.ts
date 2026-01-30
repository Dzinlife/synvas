import type { SkImage } from "react-skia-lite";
import { Skia } from "react-skia-lite";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type {
	ComponentModel,
	ComponentModelStore,
	ValidationResult,
} from "../model/types";

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
): ComponentModelStore<ImageProps, ImageInternal> {
	const loadImage = async (uri: string): Promise<void> => {
		try {
			const data = await fetch(uri).then((res) => res.arrayBuffer());
			const imageData = Skia.Data.fromBytes(new Uint8Array(data));
			const image = Skia.Image.MakeImageFromEncoded(imageData);

			if (!image) {
				throw new Error("Failed to decode image");
			}

			store.setState((state) => ({
				...state,
				internal: {
					...state.internal,
					image,
					isReady: true,
				},
			}));
		} catch (err) {
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
				loadImage,
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

			validate: (newProps) => {
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
						constraints: { ...state.constraints, isLoading: true },
					}));

					await loadImage(uri);

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
				// SkImage 会被 Skia 自动管理，不需要手动释放
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
