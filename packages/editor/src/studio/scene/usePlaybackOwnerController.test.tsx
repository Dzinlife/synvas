// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { __resetAudioOwnerForTests, getOwner } from "@/audio/owner";
import {
	createRuntimeProviderWrapper,
	createTestEditorRuntime,
} from "@/scene-editor/runtime/testUtils";
import type {
	EditorRuntime,
	StudioRuntimeManager,
} from "@/scene-editor/runtime/types";
import { usePlaybackOwnerStore } from "./playbackOwnerStore";
import { toSceneTimelineRef } from "./timelineRefAdapter";
import { usePlaybackOwnerController } from "./usePlaybackOwnerController";

const runtime = createTestEditorRuntime("playback-owner-controller-test");
const studioRuntime = runtime as EditorRuntime & StudioRuntimeManager;
const wrapper = createRuntimeProviderWrapper(runtime);

const scene1Ref = toSceneTimelineRef("scene-1");
const scene2Ref = toSceneTimelineRef("scene-2");

const createPlayableElement = (id: string) => ({
	id,
	type: "Image" as const,
	component: "image",
	name: id,
	props: {},
	timeline: {
		start: 0,
		end: 300,
		startTimecode: "00:00:00:00",
		endTimecode: "00:00:10:00",
		trackIndex: 0,
		role: "clip" as const,
	},
});

beforeEach(() => {
	for (const timelineRuntime of studioRuntime.listTimelineRuntimes()) {
		studioRuntime.removeTimelineRuntime(timelineRuntime.ref);
	}
	studioRuntime.setActiveEditTimeline(null);
	usePlaybackOwnerStore.getState().clearOwner();
	__resetAudioOwnerForTests();
	const scene1Runtime = studioRuntime.ensureTimelineRuntime(scene1Ref);
	const scene2Runtime = studioRuntime.ensureTimelineRuntime(scene2Ref);
	scene1Runtime.timelineStore.setState({
		elements: [createPlayableElement("scene-1-element")],
		currentTime: 0,
		previewTime: null,
	});
	scene2Runtime.timelineStore.setState({
		elements: [createPlayableElement("scene-2-element")],
		currentTime: 0,
		previewTime: null,
	});
});

describe("usePlaybackOwnerController", () => {
	it("只允许单 runtime 播放，后起播会抢占 owner", () => {
		const { result } = renderHook(() => usePlaybackOwnerController(), {
			wrapper,
		});

		act(() => {
			result.current.requestPlay(scene1Ref);
		});
		expect(
			studioRuntime.getTimelineRuntime(scene1Ref)?.timelineStore.getState()
				.isPlaying,
		).toBe(true);
			expect(usePlaybackOwnerStore.getState().ownerTimelineRef).toEqual(
				scene1Ref,
			);
			expect(getOwner()).toBe("scene:scene-1");

		act(() => {
			result.current.requestPlay(scene2Ref);
		});
		expect(
			studioRuntime.getTimelineRuntime(scene1Ref)?.timelineStore.getState()
				.isPlaying,
		).toBe(false);
		expect(
			studioRuntime.getTimelineRuntime(scene2Ref)?.timelineStore.getState()
				.isPlaying,
		).toBe(true);
			expect(usePlaybackOwnerStore.getState().ownerTimelineRef).toEqual(
				scene2Ref,
			);
			expect(getOwner()).toBe("scene:scene-2");
	});

	it("起播时间使用目标 runtime 当前显示时间", () => {
		const { result } = renderHook(() => usePlaybackOwnerController(), {
			wrapper,
		});
		const scene2Runtime = studioRuntime.getTimelineRuntime(scene2Ref);
		scene2Runtime?.timelineStore.setState({
			currentTime: 12,
			previewTime: 36,
		});

		act(() => {
			result.current.requestPlay(scene2Ref);
		});

		const state = scene2Runtime?.timelineStore.getState();
		expect(state?.currentTime).toBe(36);
		expect(state?.previewTime).toBeNull();
		expect(state?.isPlaying).toBe(true);
	});

	it("预览结束后不会自动恢复之前 owner", async () => {
		const { result } = renderHook(() => usePlaybackOwnerController(), {
			wrapper,
		});

		act(() => {
			result.current.requestPlay(scene1Ref);
			result.current.requestPlay(scene2Ref);
		});

		act(() => {
			studioRuntime
				.getTimelineRuntime(scene2Ref)
				?.timelineStore.getState()
				.pause();
		});

			await waitFor(() => {
				expect(usePlaybackOwnerStore.getState().ownerTimelineRef).toBeNull();
			});
			expect(getOwner()).toBeNull();
			expect(
				studioRuntime.getTimelineRuntime(scene1Ref)?.timelineStore.getState()
					.isPlaying,
		).toBe(false);
	});
});
