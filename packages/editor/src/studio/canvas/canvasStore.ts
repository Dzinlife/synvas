import { create } from "zustand";

export interface CanvasAssetRef {
	assetId: string;
	addedAt: number;
	sourceElementId?: string;
}

interface CanvasStoreState {
	assets: CanvasAssetRef[];
	addAssetRef: (
		assetId: string,
		options?: {
			sourceElementId?: string;
			dedupe?: boolean;
		},
	) => void;
	addAssetRefs: (
		assetIds: string[],
		options?: {
			sourceElementId?: string;
			dedupe?: boolean;
		},
	) => void;
	removeAssetRef: (assetId: string) => void;
	clearAssetRefs: () => void;
}

export const useCanvasStore = create<CanvasStoreState>((set) => ({
	assets: [],
	addAssetRef: (assetId, options) => {
		const dedupe = options?.dedupe ?? true;
		set((state) => {
			if (!assetId) return state;
			if (dedupe && state.assets.some((item) => item.assetId === assetId)) {
				return state;
			}
			return {
				assets: [
					...state.assets,
					{
						assetId,
						addedAt: Date.now(),
						...(options?.sourceElementId
							? { sourceElementId: options.sourceElementId }
							: {}),
					},
				],
			};
		});
	},
	addAssetRefs: (assetIds, options) => {
		const dedupe = options?.dedupe ?? true;
		set((state) => {
			const existed = new Set(state.assets.map((item) => item.assetId));
			const next = [...state.assets];
			let didChange = false;
			for (const assetId of assetIds) {
				if (!assetId) continue;
				if (dedupe && existed.has(assetId)) continue;
				next.push({
					assetId,
					addedAt: Date.now(),
					...(options?.sourceElementId
						? { sourceElementId: options.sourceElementId }
						: {}),
				});
				existed.add(assetId);
				didChange = true;
			}
			return didChange ? { assets: next } : state;
		});
	},
	removeAssetRef: (assetId) => {
		set((state) => ({
			assets: state.assets.filter((item) => item.assetId !== assetId),
		}));
	},
	clearAssetRefs: () => {
		set({ assets: [] });
	},
}));
