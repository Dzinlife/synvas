import type { VideoSampleSink } from "mediabunny";
import { type SkImage } from "react-skia-lite";
import { subscribeWithSelector } from "zustand/middleware";
import { createStore } from "zustand/vanilla";
import type { AssetHandle } from "@/assets/AssetStore";
import { acquireVideoAsset, type VideoAsset } from "@/assets/videoAsset";
import { getVideoSampleAfterTime, videoSampleToSkImage } from "@/lib/videoFrameUtils";
import type { EditorRuntime } from "@/scene-editor/runtime/types";
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
	videoRotation: 0 | 90 | 180 | 270;
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

export const decodeFrameAtTime = async (
	videoSampleSink: Pick<VideoSampleSink, "samples">,
	sourceTime: number,
): Promise<SkImage | null> => {
	const sample = await getVideoSampleAfterTime(videoSampleSink, sourceTime);
	if (!sample) return null;
	return videoSampleToSkImage(sample);
};

export function createFreezeFrameModel(
	id: string,
	initialProps: FreezeFrameProps,
	runtime: EditorRuntime,
): ComponentModelStore<FreezeFrameProps, FreezeFrameInternal> {
	const timelineStore = runtime.timelineStore;
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
				videoRotation: 0,
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
					const asset = localHandle.asset;

					const fps = normalizeFps(timelineStore.getState().fps);
					const sourceTime = resolveSourceTime(get().props, fps);
					const alignedSourceTime = alignSourceTime(sourceTime, fps);
					const cached = asset.getCachedFrame(alignedSourceTime);
					const image =
						cached ??
						(await decodeFrameAtTime(
							asset.videoSampleSink,
							alignedSourceTime,
						));

					if (currentEpoch !== initEpoch) return;
					if (!image) {
						throw new Error("Failed to decode freeze frame");
					}

					if (!cached) {
						asset.storeFrame(alignedSourceTime, image);
					}
					updatePinnedFrame(image, asset);

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
							videoRotation: asset.videoRotation,
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
							videoRotation: 0,
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
						videoRotation: 0,
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
