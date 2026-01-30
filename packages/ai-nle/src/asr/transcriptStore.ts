import { create } from "zustand";
import type { TranscriptRecord } from "./types";

interface TranscriptStoreState {
	transcripts: TranscriptRecord[];
	setTranscripts: (transcripts: TranscriptRecord[]) => void;
	addTranscript: (record: TranscriptRecord) => void;
	updateTranscript: (
		id: string,
		updater: (record: TranscriptRecord) => TranscriptRecord,
	) => void;
}

export const useTranscriptStore = create<TranscriptStoreState>((set) => ({
	transcripts: [],
	setTranscripts: (transcripts) => set({ transcripts }),
	addTranscript: (record) =>
		set((state) => ({ transcripts: [...state.transcripts, record] })),
	updateTranscript: (id, updater) =>
		set((state) => ({
			transcripts: state.transcripts.map((record) =>
				record.id === id ? updater(record) : record,
			),
		})),
}));
