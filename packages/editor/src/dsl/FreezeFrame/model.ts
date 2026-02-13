import type { CanvasSink, WrappedCanvas } from "mediabunny";
import { type SkImage, Skia } from "react-skia-lite";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { AssetHandle } from "@/dsl/assets/AssetStore";
import { acquireVideoAsset, type VideoAsset } from "@/dsl/assets/videoAsset";
import { useTimelineStore } from "@/editor/contexts/TimelineContext";
import { framesToSeconds } from "@/utils/timecode";
import type {
	ComponentModel,
	ComponentModelStore,
	ValidationResult,
} from "../model/types";

export interface FreezeFrameProps {
	uri?: string;
	sourceElementId?: string;
	sourceFrame?: number;
	sourceTime?: number;
}

export interface FreezeFrameInternal {
	image: SkImage | null;
	isReady: boolean;
}

const DEFAULT_FPS = 30;

const normalizeFps = (fps: number): number => {
	if (!Number.isFinite(fps) || fps <= 0) return DEFAULT_FPS;
	return Math.round(fps);
};

const resolveSourceTime = (props: FreezeFrameProps, fps: number): number => {
	if (Number.isFinite(props.sourceTime)) {
		return Math.max(0, props.sourceTime as number);
	}
	if (Number.isFinite(props.sourceFrame)) {
		const frame = Math.max(0, Math.round(props.sourceFrame as number));
		return framesToSeconds(frame, fps);
	}
	return 0;
};

export const alignSourceTime = (sourceTime: number, fps: number): number => {
	const safeFps = normalizeFps(fps);
	const frameInterval = 1 / safeFps;
	const clamped = Math.max(0, sourceTime);
	return Math.round(clamped / frameInterval) * frameInterval;
};

const canvasToSkImage = async (
	canvas: HTMLCanvasElement | OffscreenCanvas,
): Promise<SkImage | null> => {
	try {
		const imageBitmap = await createImageBitmap(canvas);
		return Skia.Image.MakeImageFromNativeBuffer(imageBitmap);
	} catch (error) {
		console.warn("FreezeFrame canvas decode failed:", error);
		return null;
	}
};

export const decodeFrameAtTime = async (
	videoSink: Pick<CanvasSink, "canvases">,
	sourceTime: number,
): Promise<SkImage | null> => {
	let iterator: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
	try {
		iterator = videoSink.canvases(sourceTime);
		const first = (await iterator.next()).value ?? null;
		if (!first) return null;
		const canvas = first.canvas;
		if (
			!(
				canvas instanceof HTMLCanvasElement || canvas instanceof OffscreenCanvas
			)
		) {
			return null;
		}
		return await canvasToSkImage(canvas);
	} finally {
		await iterator?.return?.();
	}
};

export function createFreezeFrameModel(
	id: string,
	initialProps: FreezeFrameProps,
): ComponentModelStore<FreezeFrameProps, FreezeFrameInternal> {
	let initEpoch = 0;
	let assetHandle: AssetHandle<VideoAsset> | null = null;
	let pinnedFrame: SkImage | null = null;
	let pinnedFrameAsset: VideoAsset | null = null;

	const updatePinnedFrame = (
		nextFrame: SkImage | null,
		asset: VideoAsset | null,
	) => {
		if (pinnedFrame === nextFrame && pinnedFrameAsset === asset) return;
		if (pinnedFrame && pinnedFrameAsset) {
			pinnedFrameAsset.unpinFrame(pinnedFrame);
		}
		if (nextFrame && asset) {
			asset.pinFrame(nextFrame);
		}
		pinnedFrame = nextFrame;
		pinnedFrameAsset = nextFrame && asset ? asset : null;
	};

	const store = createStore<
		ComponentModel<FreezeFrameProps, FreezeFrameInternal>
	>()(
		subscribeWithSelector((set, get) => ({
			id,
			type: "FreezeFrame",
			props: initialProps,
			constraints: {
				isLoading: true,
				canTrimStart: true,
				canTrimEnd: true,
			},
			internal: {
				image: null,
				isReady: false,
			} satisfies FreezeFrameInternal,

			setProps: (partial) => {
				const result = get().validate(partial);
				if (result.valid) {
					set((state) => ({
						props: {
							...state.props,
							...partial,
						},
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

			init: async () => {
				const uri = get().props.uri;
				if (!uri) {
					set((state) => ({
						constraints: {
							...state.constraints,
							isLoading: false,
							hasError: true,
							errorMessage: "No URI provided",
						},
					}));
					return;
				}

				initEpoch += 1;
				const currentEpoch = initEpoch;
				let localHandle: AssetHandle<VideoAsset> | null = null;

				set((state) => ({
					constraints: {
						...state.constraints,
						isLoading: true,
						hasError: false,
						errorMessage: undefined,
					},
				}));

				try {
					localHandle = await acquireVideoAsset(uri);
					if (currentEpoch !== initEpoch) {
						localHandle.release();
						return;
					}

					assetHandle?.release();
					assetHandle = localHandle;

					const fps = normalizeFps(useTimelineStore.getState().fps);
					const sourceTime = resolveSourceTime(get().props, fps);
					const alignedSourceTime = alignSourceTime(sourceTime, fps);
					const cached = localHandle.asset.getCachedFrame(alignedSourceTime);
					const image =
						cached ??
						(await decodeFrameAtTime(localHandle.asset.videoSink, alignedSourceTime));

					if (currentEpoch !== initEpoch) return;
					if (!image) {
						throw new Error("Failed to decode freeze frame");
					}

					if (!cached) {
						localHandle.asset.storeFrame(alignedSourceTime, image);
					}
					updatePinnedFrame(image, localHandle.asset);

					set((state) => ({
						constraints: {
							...state.constraints,
							isLoading: false,
							hasError: false,
							errorMessage: undefined,
						},
						internal: {
							...state.internal,
							image,
							isReady: true,
						},
					}));
				} catch (error) {
					localHandle?.release();
					if (assetHandle === localHandle) {
						assetHandle = null;
					}
					if (currentEpoch !== initEpoch) return;
					updatePinnedFrame(null, null);
					set((state) => ({
						constraints: {
							...state.constraints,
							isLoading: false,
							hasError: true,
							errorMessage:
								error instanceof Error ? error.message : "Unknown error",
						},
						internal: {
							...state.internal,
							image: null,
							isReady: false,
						},
					}));
				}
			},

			dispose: () => {
				initEpoch += 1;
				updatePinnedFrame(null, null);
				assetHandle?.release();
				assetHandle = null;
				set((state) => ({
					internal: {
						...state.internal,
						image: null,
						isReady: false,
					},
				}));
			},

			waitForReady: () => {
				return new Promise<void>((resolve) => {
					if (store.getState().internal.isReady) {
						resolve();
						return;
					}
					const unsubscribe = store.subscribe(
						(state) => state.internal.isReady,
						(isReady) => {
							if (!isReady) return;
							unsubscribe();
							resolve();
						},
					);
				});
			},
		})),
	);

	return store;
}
