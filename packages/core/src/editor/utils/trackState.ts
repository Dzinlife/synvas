import { TimelineElement } from "../../dsl/types";
import { TimelineTrack } from "../timeline/types";
import {
	getElementRole,
	MAIN_TRACK_INDEX,
	normalizeStoredTrackIndices,
	type TrackRoleOptions,
} from "./trackAssignment";

export const MAIN_TRACK_ID = "main";

const createMainTrack = (
	hidden: boolean,
	locked: boolean,
	muted: boolean,
	solo: boolean,
): TimelineTrack => ({
	id: MAIN_TRACK_ID,
	role: "clip",
	hidden,
	locked,
	muted,
	solo,
});

const createTrackId = (): string => {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
		return crypto.randomUUID();
	}
	return `track-${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2, 6)}`;
};

const buildTrackIdStats = (
	elements: TimelineElement[],
): Map<string, Map<number, number>> => {
	const stats = new Map<string, Map<number, number>>();
	for (const el of elements) {
		const trackId = el.timeline.trackId;
		if (!trackId) continue;
		const index = el.timeline.trackIndex ?? MAIN_TRACK_INDEX;
		let indexMap = stats.get(trackId);
		if (!indexMap) {
			indexMap = new Map();
			stats.set(trackId, indexMap);
		}
		indexMap.set(index, (indexMap.get(index) ?? 0) + 1);
	}
	return stats;
};

const pickPreferredIndex = (
	trackId: string,
	indexMap: Map<number, number>,
	prevIndexById: Map<string, number>,
): number => {
	let bestCount = -1;
	let candidates: number[] = [];
	for (const [index, count] of indexMap.entries()) {
		if (count > bestCount) {
			bestCount = count;
			candidates = [index];
			continue;
		}
		if (count === bestCount) {
			candidates.push(index);
		}
	}
	if (candidates.length === 0) return MAIN_TRACK_INDEX;
	const prevIndex = prevIndexById.get(trackId);
	if (prevIndex !== undefined && candidates.includes(prevIndex)) {
		return prevIndex;
	}
	return Math.min(...candidates);
};

const isSameTracks = (next: TimelineTrack[], prev: TimelineTrack[]): boolean => {
	if (next.length !== prev.length) return false;
	for (let i = 0; i < next.length; i += 1) {
		const a = next[i];
		const b = prev[i];
		if (!b) return false;
		if (
			a.id !== b.id ||
			a.role !== b.role ||
			a.hidden !== b.hidden ||
			a.locked !== b.locked ||
			a.muted !== b.muted ||
			a.solo !== b.solo
		) {
			return false;
		}
	}
	return true;
};

export interface TrackReconcileResult {
	tracks: TimelineTrack[];
	elements: TimelineElement[];
	didChangeTracks: boolean;
	didChangeElements: boolean;
}

export const reconcileTracks = (
	elements: TimelineElement[],
	prevTracks: TimelineTrack[],
	options?: TrackRoleOptions,
): TrackReconcileResult => {
	if (elements.length === 0) {
		const prevMain = prevTracks.find((track) => track.id === MAIN_TRACK_ID);
		const nextTracks = [
			createMainTrack(
				prevMain?.hidden ?? false,
				prevMain?.locked ?? false,
				prevMain?.muted ?? false,
				prevMain?.solo ?? false,
			),
		];
		const didChangeTracks = !isSameTracks(nextTracks, prevTracks);
		return {
			tracks: didChangeTracks ? nextTracks : prevTracks,
			elements,
			didChangeTracks,
			didChangeElements: false,
		};
	}

	const normalizedElements = normalizeStoredTrackIndices(elements);
	const elementsByIndex = new Map<number, TimelineElement[]>();
	let maxIndex = MAIN_TRACK_INDEX;
	for (const el of normalizedElements) {
		const index = el.timeline.trackIndex ?? MAIN_TRACK_INDEX;
		maxIndex = Math.max(maxIndex, index);
		const bucket = elementsByIndex.get(index);
		if (bucket) {
			bucket.push(el);
		} else {
			elementsByIndex.set(index, [el]);
		}
	}

	const prevTrackById = new Map(prevTracks.map((track) => [track.id, track]));
	const prevIndexById = new Map(
		prevTracks.map((track, index) => [track.id, index]),
	);
	const prevTrackIdByIndex = new Map(
		prevTracks.map((track, index) => [index, track.id]),
	);
	const trackIdStats = buildTrackIdStats(normalizedElements);
	const preferredIndexById = new Map<string, number>();
	for (const [trackId, indexMap] of trackIdStats.entries()) {
		preferredIndexById.set(
			trackId,
			pickPreferredIndex(trackId, indexMap, prevIndexById),
		);
	}

	const assignedTrackIds = new Set<string>([MAIN_TRACK_ID]);
	const trackIdByIndex = new Map<number, string>([
		[MAIN_TRACK_INDEX, MAIN_TRACK_ID],
	]);

	const preferredAssignments = Array.from(preferredIndexById.entries())
		.map(([trackId, preferredIndex]) => {
			const preferredCount =
				trackIdStats.get(trackId)?.get(preferredIndex) ?? 0;
			const prevIndex = prevIndexById.get(trackId);
			return { trackId, preferredIndex, preferredCount, prevIndex };
		})
		.sort((a, b) => {
			if (a.preferredCount !== b.preferredCount) {
				return b.preferredCount - a.preferredCount;
			}
			const aPrevMatch = a.prevIndex === a.preferredIndex;
			const bPrevMatch = b.prevIndex === b.preferredIndex;
			if (aPrevMatch !== bPrevMatch) {
				return aPrevMatch ? -1 : 1;
			}
			if (a.preferredIndex !== b.preferredIndex) {
				return a.preferredIndex - b.preferredIndex;
			}
			return a.trackId.localeCompare(b.trackId);
		});

	for (const { trackId, preferredIndex } of preferredAssignments) {
		if (preferredIndex === MAIN_TRACK_INDEX) continue;
		if (assignedTrackIds.has(trackId)) continue;
		if (trackIdByIndex.has(preferredIndex)) continue;
		if (!elementsByIndex.has(preferredIndex)) continue;
		trackIdByIndex.set(preferredIndex, trackId);
		assignedTrackIds.add(trackId);
	}

	const pickCandidateId = (index: number): string | null => {
		const elementsInIndex = elementsByIndex.get(index) ?? [];
		let bestId: string | null = null;
		let bestCount = -1;
		let bestPrevMatch = false;
		for (const el of elementsInIndex) {
			const trackId = el.timeline.trackId;
			if (!trackId || trackId === MAIN_TRACK_ID) continue;
			if (assignedTrackIds.has(trackId)) continue;
			const count = trackIdStats.get(trackId)?.get(index) ?? 0;
			const prevMatch = prevIndexById.get(trackId) === index;
			if (
				count > bestCount ||
				(count === bestCount && prevMatch && !bestPrevMatch) ||
				(count === bestCount &&
					prevMatch === bestPrevMatch &&
					bestId !== null &&
					trackId.localeCompare(bestId) < 0)
			) {
				bestCount = count;
				bestId = trackId;
				bestPrevMatch = prevMatch;
			}
		}
		if (bestId) return bestId;
		const prevTrackId = prevTrackIdByIndex.get(index);
		if (
			prevTrackId &&
			prevTrackId !== MAIN_TRACK_ID &&
			!assignedTrackIds.has(prevTrackId)
		) {
			return prevTrackId;
		}
		return bestId;
	};

	for (let index = MAIN_TRACK_INDEX + 1; index <= maxIndex; index += 1) {
		if (trackIdByIndex.has(index)) continue;
		const candidate = pickCandidateId(index);
		if (candidate) {
			trackIdByIndex.set(index, candidate);
			assignedTrackIds.add(candidate);
			continue;
		}
		trackIdByIndex.set(index, createTrackId());
	}

	const nextTracks: TimelineTrack[] = [];
	for (let index = MAIN_TRACK_INDEX; index <= maxIndex; index += 1) {
		const trackId = trackIdByIndex.get(index) ?? createTrackId();
		const prevTrack = prevTrackById.get(trackId);
		const elementsInIndex = elementsByIndex.get(index) ?? [];
		const derivedRole =
			elementsInIndex[0]
				? getElementRole(elementsInIndex[0], options)
				: prevTrack?.role ?? "overlay";
		nextTracks.push({
			id: trackId,
			role: index === MAIN_TRACK_INDEX ? "clip" : derivedRole,
			hidden: prevTrack?.hidden ?? false,
			locked: prevTrack?.locked ?? false,
			muted: prevTrack?.muted ?? false,
			solo: prevTrack?.solo ?? false,
		});
	}

	let didChangeElements = normalizedElements !== elements;
	let didUpdateTrackId = false;
	const updatedElements = normalizedElements.map((el) => {
		const index = el.timeline.trackIndex ?? MAIN_TRACK_INDEX;
		const targetId =
			index === MAIN_TRACK_INDEX
				? MAIN_TRACK_ID
				: trackIdByIndex.get(index) ?? MAIN_TRACK_ID;
		if (el.timeline.trackId === targetId) return el;
		didUpdateTrackId = true;
		return {
			...el,
			timeline: {
				...el.timeline,
				trackId: targetId,
			},
		};
	});

	if (didUpdateTrackId) {
		didChangeElements = true;
	}

	const didChangeTracks = !isSameTracks(nextTracks, prevTracks);

	return {
		tracks: didChangeTracks ? nextTracks : prevTracks,
		elements: didChangeElements ? updatedElements : elements,
		didChangeTracks,
		didChangeElements,
	};
};
