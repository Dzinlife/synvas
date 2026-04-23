import type { TrackRole } from "../types";
import type { DropTarget, TimelineTrack } from "../timeline";
import { findAttachments } from "../utils/attachments";
import {
	type AudioTrackControlStateMap,
	getAudioTrackControlState,
} from "../utils/audioTrackState";
import {
	finalizeTimelineElements,
	insertElementIntoMainTrack,
} from "../utils/mainTrackMagnet";
import {
	type ResolveRole,
	getElementRole,
	getStoredTrackAssignments,
	hasOverlapOnStoredTrack,
	hasRoleConflictOnStoredTrack,
	insertTrackAt,
	MAIN_TRACK_INDEX,
	resolveDropTargetForRole,
} from "../utils/trackAssignment";
import { updateElementTime } from "../utils/timelineTime";
import type {
	TimelineCommandApplyResult,
	TimelineCommandSnapshot,
} from "./types";

export interface TrackPlacementResult {
	finalTrack: number;
	updatedAssignments: Map<string, number>;
}

interface MoveChildTimeRange {
	start: number;
	end: number;
}

export interface CommandRoleOptions {
	resolveRole?: ResolveRole;
}

const toFiniteNumber = (value: unknown): number | null => {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return value;
};

const toStringValue = (value: unknown): string | null => {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed.length === 0) return null;
	return trimmed;
};

export const createTrackLockedMap = (
	tracks: TimelineTrack[],
	audioTrackStates: AudioTrackControlStateMap,
): Map<number, boolean> => {
	const map = new Map<number, boolean>(
		tracks.map((track, index) => [index, track.locked ?? false]),
	);
	for (const trackIndexRaw of Object.keys(audioTrackStates)) {
		const trackIndex = Number(trackIndexRaw);
		if (!Number.isFinite(trackIndex)) continue;
		const state = getAudioTrackControlState(audioTrackStates, trackIndex);
		map.set(trackIndex, state.locked);
	}
	return map;
};

const buildTimedEntries = (
	entries: TimelineCommandSnapshot["elements"],
	elementId: string,
	start: number,
	end: number,
): TimelineCommandSnapshot["elements"] =>
	entries.map((element) => {
		if (element.id !== elementId) return element;
		return {
			...element,
			timeline: { ...element.timeline, start, end },
		};
	});

const resolveAudioDropResult = (
	entries: TimelineCommandSnapshot["elements"],
	elementId: string,
	start: number,
	end: number,
	dropTarget: DropTarget,
	assignments: Map<string, number>,
	options?: CommandRoleOptions,
): TrackPlacementResult => {
	const targetTrack =
		dropTarget.trackIndex < MAIN_TRACK_INDEX ? dropTarget.trackIndex : -1;
	const hasConflict = (trackIndex: number) =>
		hasRoleConflictOnStoredTrack(
			"audio",
			trackIndex,
			entries,
			elementId,
			options,
		) || hasOverlapOnStoredTrack(start, end, trackIndex, entries, elementId);

	if (dropTarget.type === "gap") {
		return {
			finalTrack: targetTrack,
			updatedAssignments: insertTrackAt(targetTrack, assignments),
		};
	}

	if (!hasConflict(targetTrack)) {
		return {
			finalTrack: targetTrack,
			updatedAssignments: assignments,
		};
	}

	return {
		finalTrack: targetTrack,
		updatedAssignments: insertTrackAt(targetTrack, assignments),
	};
};

export const resolveTrackPlacementWithStoredAssignments = (args: {
	entries: TimelineCommandSnapshot["elements"];
	elementId: string;
	start: number;
	end: number;
	role: TrackRole;
	dropTarget: DropTarget;
	assignments: Map<string, number>;
	originalTrack: number;
	resolveRole?: ResolveRole;
}): TrackPlacementResult => {
	const {
		entries,
		elementId,
		start,
		end,
		role,
		dropTarget,
		assignments,
		originalTrack,
		resolveRole,
	} = args;
	const roleOptions: CommandRoleOptions = { resolveRole };
	if (role === "audio") {
		return resolveAudioDropResult(
			entries,
			elementId,
			start,
			end,
			dropTarget,
			assignments,
			roleOptions,
		);
	}

	const timedEntries = buildTimedEntries(entries, elementId, start, end);
	const maxStoredTrack = Math.max(
		0,
		...timedEntries.map((element) => element.timeline.trackIndex ?? 0),
	);
	const hasTrackConflict = (trackIndex: number) =>
		hasRoleConflictOnStoredTrack(
			role,
			trackIndex,
			timedEntries,
			elementId,
			roleOptions,
		) || hasOverlapOnStoredTrack(start, end, trackIndex, timedEntries, elementId);

	if (dropTarget.type === "gap") {
		const gapTrackIndex = dropTarget.trackIndex;
		const belowTrack = gapTrackIndex - 1;
		const aboveTrack = gapTrackIndex;
		const belowIsDestination =
			belowTrack >= 0 &&
			belowTrack !== originalTrack &&
			!hasTrackConflict(belowTrack);
		const aboveIsDestination =
			aboveTrack <= maxStoredTrack &&
			aboveTrack !== originalTrack &&
			!hasTrackConflict(aboveTrack);

		if (belowIsDestination) {
			return {
				finalTrack: belowTrack,
				updatedAssignments: assignments,
			};
		}
		if (aboveIsDestination) {
			return {
				finalTrack: aboveTrack,
				updatedAssignments: assignments,
			};
		}
		return {
			finalTrack: gapTrackIndex,
			updatedAssignments: insertTrackAt(gapTrackIndex, assignments),
		};
	}

	const targetTrack = dropTarget.trackIndex;
	if (!hasTrackConflict(targetTrack)) {
		return {
			finalTrack: targetTrack,
			updatedAssignments: assignments,
		};
	}

	const aboveTrack = targetTrack + 1;
	if (aboveTrack <= maxStoredTrack && !hasTrackConflict(aboveTrack)) {
		return {
			finalTrack: aboveTrack,
			updatedAssignments: assignments,
		};
	}

	return {
		finalTrack: targetTrack + 1,
		updatedAssignments: insertTrackAt(targetTrack + 1, assignments),
	};
};

export const resolveMovedChildrenTracks = (
	nextElements: TimelineCommandSnapshot["elements"],
	movedChildren: Map<string, MoveChildTimeRange>,
	options?: CommandRoleOptions,
): TimelineCommandSnapshot["elements"] => {
	if (movedChildren.size === 0) return nextElements;

	let updated = nextElements;
	for (const childId of movedChildren.keys()) {
		const child = updated.find((element) => element.id === childId);
		if (!child) continue;

		const childRole = getElementRole(child, options);
		const currentTrack =
			child.timeline.trackIndex ?? (childRole === "audio" ? -1 : 1);
		let availableTrack = currentTrack;

		// 从当前轨道向上查找可用轨，避免联动后出现重叠
		if (childRole === "audio") {
			const minStoredTrack = Math.min(
				-1,
				...updated.map((element) => element.timeline.trackIndex ?? 0),
			);
			for (let track = currentTrack; track >= minStoredTrack - 1; track -= 1) {
				if (
					hasRoleConflictOnStoredTrack(
						childRole,
						track,
						updated,
						childId,
						options,
					)
				) {
					continue;
				}
				if (
					!hasOverlapOnStoredTrack(
						child.timeline.start,
						child.timeline.end,
						track,
						updated,
						childId,
					)
				) {
					availableTrack = track;
					break;
				}
			}
		} else {
			const maxStoredTrack = Math.max(
				0,
				...updated.map((element) => element.timeline.trackIndex ?? 0),
			);
			for (let track = currentTrack; track <= maxStoredTrack + 1; track += 1) {
				if (
					hasRoleConflictOnStoredTrack(
						childRole,
						track,
						updated,
						childId,
						options,
					)
				) {
					continue;
				}
				if (
					!hasOverlapOnStoredTrack(
						child.timeline.start,
						child.timeline.end,
						track,
						updated,
						childId,
					)
				) {
					availableTrack = track;
					break;
				}
			}
		}

		if (availableTrack !== currentTrack) {
			updated = updated.map((element) =>
				element.id === childId
					? {
							...element,
							timeline: {
								...element.timeline,
								trackIndex: availableTrack,
							},
						}
					: element,
			);
		}
	}
	return updated;
};

export const applyMoveCommand = (
	snapshot: TimelineCommandSnapshot,
	args: Record<string, unknown>,
	options?: CommandRoleOptions,
): TimelineCommandApplyResult => {
	const id = toStringValue(args.id);
	if (!id) {
		return { ok: false, changed: false, snapshot, error: "缺少 id 参数" };
	}

	if (args.end !== undefined) {
		return {
			ok: false,
			changed: false,
			snapshot,
			error: "move 不支持 end 参数，请使用 timeline.element.trim",
		};
	}

	const hasStart = args.start !== undefined;
	const hasDelta = args.delta !== undefined;
	if (hasStart && hasDelta) {
		return {
			ok: false,
			changed: false,
			snapshot,
			error: "start 与 delta 不能同时提供",
		};
	}
	if (!hasStart && !hasDelta) {
		return {
			ok: false,
			changed: false,
			snapshot,
			error: "请提供 start 或 delta 参数",
		};
	}

	const startArg = toFiniteNumber(args.start);
	const deltaArg = toFiniteNumber(args.delta);
	if (hasStart && startArg === null) {
		return {
			ok: false,
			changed: false,
			snapshot,
			error: "start 参数无效",
		};
	}
	if (hasDelta && deltaArg === null) {
		return {
			ok: false,
			changed: false,
			snapshot,
			error: "delta 参数无效",
		};
	}

	const hasTrackIndex = args.trackIndex !== undefined;
	const trackIndexValue = toFiniteNumber(args.trackIndex);
	if (hasTrackIndex && trackIndexValue === null) {
		return {
			ok: false,
			changed: false,
			snapshot,
			error: "trackIndex 参数无效",
		};
	}
	const requestedTrackIndex =
		hasTrackIndex && trackIndexValue !== null ? Math.round(trackIndexValue) : null;

	const target = snapshot.elements.find((element) => element.id === id);
	if (!target) {
		return {
			ok: false,
			changed: false,
			snapshot,
			error: `未找到元素: ${id}`,
		};
	}

	const sourceTrackIndex = target.timeline.trackIndex ?? 0;
	const trackLockedMap = createTrackLockedMap(
		snapshot.tracks,
		snapshot.audioTrackStates,
	);
	if (trackLockedMap.get(sourceTrackIndex)) {
		return {
			ok: false,
			changed: false,
			snapshot,
			error: "源轨道已锁定，无法移动",
		};
	}
	if (
		requestedTrackIndex !== null &&
		trackLockedMap.get(requestedTrackIndex) === true
	) {
		return {
			ok: false,
			changed: false,
			snapshot,
			error: `目标轨道已锁定: ${requestedTrackIndex}`,
		};
	}

	const duration = target.timeline.end - target.timeline.start;
	const roundedStart = hasStart ? Math.round(startArg as number) : null;
	const roundedDelta = hasDelta ? Math.round(deltaArg as number) : null;
	const nextStartRaw =
		roundedStart ?? target.timeline.start + (roundedDelta as number);
	const nextStart = Math.max(0, nextStartRaw);
	const nextEnd = nextStart + duration;

	const role = getElementRole(target, options);
	const assignments = getStoredTrackAssignments(snapshot.elements);
	const baseDropTarget: DropTarget = {
		type: "track",
		trackIndex: requestedTrackIndex ?? sourceTrackIndex,
	};
	const resolvedDropTarget = resolveDropTargetForRole(
		baseDropTarget,
		role,
		snapshot.elements,
		assignments,
		options,
	);
	const shouldUseRippleMove =
		snapshot.rippleEditingEnabled &&
		resolvedDropTarget.type === "track" &&
		resolvedDropTarget.trackIndex === MAIN_TRACK_INDEX;
	if (shouldUseRippleMove) {
		const nextElements = insertElementIntoMainTrack(
			snapshot.elements,
			id,
			nextStart,
			{
				rippleEditingEnabled: true,
				attachments: findAttachments(snapshot.elements),
				autoAttach: snapshot.autoAttach,
				fps: snapshot.fps,
				trackLockedMap,
				resolveRole: options?.resolveRole,
			},
		);
		if (nextElements === snapshot.elements) {
			return { ok: true, changed: false, snapshot };
		}
		return {
			ok: true,
			changed: true,
			snapshot: {
				...snapshot,
				elements: nextElements,
			},
		};
	}

	const placement = resolveTrackPlacementWithStoredAssignments({
		entries: snapshot.elements,
		elementId: id,
		start: nextStart,
		end: nextEnd,
		role,
		dropTarget: resolvedDropTarget,
		assignments,
		originalTrack: sourceTrackIndex,
		resolveRole: options?.resolveRole,
	});
	const finalTrack = placement.finalTrack;
	if (trackLockedMap.get(finalTrack)) {
		return {
			ok: false,
			changed: false,
			snapshot,
			error: `目标轨道已锁定: ${finalTrack}`,
		};
	}

	const actualDelta = nextStart - target.timeline.start;
	const isLeavingMainTrack =
		sourceTrackIndex === MAIN_TRACK_INDEX && finalTrack > MAIN_TRACK_INDEX;
	const movedChildren = new Map<string, MoveChildTimeRange>();

	if (snapshot.autoAttach && actualDelta !== 0 && !isLeavingMainTrack) {
		const attachments = findAttachments(snapshot.elements);
		for (const childId of attachments.get(id) ?? []) {
			const child = snapshot.elements.find((element) => element.id === childId);
			if (!child) continue;
			const childTrackIndex = child.timeline.trackIndex ?? 0;
			if (trackLockedMap.get(childTrackIndex)) continue;
			const childStart = child.timeline.start + actualDelta;
			const childEnd = child.timeline.end + actualDelta;
			if (childStart < 0) continue;
			movedChildren.set(childId, {
				start: childStart,
				end: childEnd,
			});
		}
	}

	const targetTrackId =
		finalTrack >= 0 ? snapshot.tracks[finalTrack]?.id : undefined;
	let didChange = false;
	let updated = snapshot.elements.map((element) => {
		if (element.id === id) {
			const timed = updateElementTime(element, nextStart, nextEnd, snapshot.fps);
			const moved =
				timed.timeline.trackIndex === finalTrack &&
				timed.timeline.trackId === targetTrackId
					? timed
					: {
							...timed,
							timeline: {
								...timed.timeline,
								trackIndex: finalTrack,
								trackId: targetTrackId,
							},
						};
			if (moved !== element) {
				didChange = true;
			}
			return moved;
		}
		const reassignedTrack = placement.updatedAssignments.get(element.id);
		if (
			reassignedTrack !== undefined &&
			reassignedTrack !== (element.timeline.trackIndex ?? 0)
		) {
			didChange = true;
			return {
				...element,
				timeline: {
					...element.timeline,
					trackIndex: reassignedTrack,
				},
			};
		}
		return element;
	});

	if (movedChildren.size > 0) {
		updated = updated.map((element) => {
			const childMove = movedChildren.get(element.id);
			if (!childMove) return element;
			const timed = updateElementTime(
				element,
				childMove.start,
				childMove.end,
				snapshot.fps,
			);
			if (timed !== element) {
				didChange = true;
			}
			return timed;
		});
		updated = resolveMovedChildrenTracks(updated, movedChildren, options);
	}

	const finalized = finalizeTimelineElements(updated, {
		rippleEditingEnabled: snapshot.rippleEditingEnabled,
		attachments: findAttachments(updated),
		autoAttach: snapshot.autoAttach,
		fps: snapshot.fps,
		trackLockedMap,
		resolveRole: options?.resolveRole,
	});
	if (finalized !== snapshot.elements) {
		didChange = true;
	}

	if (!didChange) {
		return { ok: true, changed: false, snapshot };
	}
	return {
		ok: true,
		changed: true,
		snapshot: {
			...snapshot,
			elements: finalized,
		},
	};
};
