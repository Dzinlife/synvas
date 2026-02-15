import type { TimelineElement } from "../../dsl/types";
import { findAttachments } from "../utils/attachments";
import type { AudioTrackControlStateMap } from "../utils/audioTrackState";
import { finalizeTimelineElements } from "../utils/mainTrackMagnet";
import { type ResolveRole, MAIN_TRACK_INDEX } from "../utils/trackAssignment";
import { reconcileTracks } from "../utils/trackState";
import { createTrackLockedMap } from "./move";
import {
	applyTimelineCommandToSnapshot,
	isHistoryCommand,
	isMetaCommand,
} from "./reducer";
import type {
	ParsedCommand,
	SnapshotExecutionResult,
	TimelineCommandSnapshot,
} from "./types";

export interface CommandExecutionOptions {
	resolveRole?: ResolveRole;
}

export const hasSnapshotStateChange = (
	prev: TimelineCommandSnapshot,
	next: TimelineCommandSnapshot,
): boolean => {
	return (
		prev.currentTime !== next.currentTime ||
		prev.elements !== next.elements ||
		prev.tracks !== next.tracks ||
		prev.audioTrackStates !== next.audioTrackStates ||
		prev.autoAttach !== next.autoAttach ||
		prev.rippleEditingEnabled !== next.rippleEditingEnabled
	);
};

export const pruneAudioTrackStates = (
	elements: TimelineElement[],
	audioTrackStates: AudioTrackControlStateMap,
): AudioTrackControlStateMap => {
	// 保留默认音轨（-1）的状态，避免空轨时面板状态被清空
	const activeTrackIndices = new Set<number>([-1]);
	for (const element of elements) {
		const trackIndex = element.timeline.trackIndex ?? MAIN_TRACK_INDEX;
		if (trackIndex < MAIN_TRACK_INDEX) {
			activeTrackIndices.add(trackIndex);
		}
	}
	const currentEntries = Object.entries(audioTrackStates);
	if (currentEntries.length === 0) return audioTrackStates;

	let didChange = false;
	const nextStates: AudioTrackControlStateMap = {};
	for (const [trackIndexRaw, state] of currentEntries) {
		const trackIndex = Number(trackIndexRaw);
		if (!activeTrackIndices.has(trackIndex)) {
			didChange = true;
			continue;
		}
		nextStates[trackIndex] = state;
	}
	if (!didChange) return audioTrackStates;
	return nextStates;
};

export const postProcessSnapshot = (
	snapshot: TimelineCommandSnapshot,
	options?: CommandExecutionOptions,
): TimelineCommandSnapshot => {
	const trackLockedMap = createTrackLockedMap(
		snapshot.tracks,
		snapshot.audioTrackStates,
	);
	const finalizedElements = finalizeTimelineElements(snapshot.elements, {
		rippleEditingEnabled: snapshot.rippleEditingEnabled,
		attachments: findAttachments(snapshot.elements),
		autoAttach: snapshot.autoAttach,
		fps: snapshot.fps,
		trackLockedMap,
		resolveRole: options?.resolveRole,
	});
	const reconcileResult = reconcileTracks(
		finalizedElements,
		snapshot.tracks,
		options,
	);
	const nextAudioTrackStates = pruneAudioTrackStates(
		reconcileResult.elements,
		snapshot.audioTrackStates,
	);
	if (
		finalizedElements === snapshot.elements &&
		reconcileResult.tracks === snapshot.tracks &&
		reconcileResult.elements === snapshot.elements &&
		nextAudioTrackStates === snapshot.audioTrackStates
	) {
		return snapshot;
	}
	return {
		...snapshot,
		elements: reconcileResult.elements,
		tracks: reconcileResult.tracks,
		audioTrackStates: nextAudioTrackStates,
	};
};

export const executePlanOnSnapshot = (
	commands: ParsedCommand[],
	baseSnapshot: TimelineCommandSnapshot,
	options?: CommandExecutionOptions,
): SnapshotExecutionResult => {
	let snapshot = baseSnapshot;
	let executed = 0;
	for (const command of commands) {
		const beforeCommand = snapshot;
		const result = applyTimelineCommandToSnapshot(snapshot, command, options);
		if (!result.ok) {
			return {
				ok: false,
				executed,
				snapshot,
				error: result.error,
			};
		}
		let nextSnapshot = result.snapshot;
		if (!isMetaCommand(command.id) && !isHistoryCommand(command.id)) {
			nextSnapshot = postProcessSnapshot(nextSnapshot, options);
		}
		snapshot = nextSnapshot;
		if (hasSnapshotStateChange(beforeCommand, nextSnapshot)) {
			executed += 1;
		}
	}
	return {
		ok: true,
		executed,
		snapshot,
	};
};
