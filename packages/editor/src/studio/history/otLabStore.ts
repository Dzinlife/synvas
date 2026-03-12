import { create } from "zustand";

export type OtLabViewMode = "actor" | "global";

interface OtLabState {
	open: boolean;
	viewMode: OtLabViewMode;
	selectedOpId: string | null;
	toggleOpen: () => void;
	setOpen: (open: boolean) => void;
	setViewMode: (mode: OtLabViewMode) => void;
	setSelectedOpId: (opId: string | null) => void;
}

export const useOtLabStore = create<OtLabState>((set) => ({
	open: false,
	viewMode: "actor",
	selectedOpId: null,
	toggleOpen: () => {
		set((state) => ({
			open: !state.open,
		}));
	},
	setOpen: (open) => {
		set({ open });
	},
	setViewMode: (mode) => {
		set({ viewMode: mode });
	},
	setSelectedOpId: (opId) => {
		set({ selectedOpId: opId });
	},
}));
