import { create } from "zustand";

export type MainViewMode = "preview" | "canvas";

interface StudioStoreState {
	activeMainView: MainViewMode;
	setActiveMainView: (mode: MainViewMode) => void;
}

export const useStudioStore = create<StudioStoreState>((set) => ({
	activeMainView: "preview",
	setActiveMainView: (mode) => {
		set({ activeMainView: mode });
	},
}));
