// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { SceneNode } from "core/studio/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAudioOwnerForTests, getOwner } from "@/audio/owner";
import {
	createRuntimeProviderWrapper,
	createTestEditorRuntime,
} from "@/editor/runtime/testUtils";
import type {
	EditorRuntime,
	StudioRuntimeManager,
} from "@/editor/runtime/types";
import { usePlaybackOwnerStore } from "@/studio/scene/playbackOwnerStore";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import { SceneNodeToolbar } from "./toolbar";

const runtime = createTestEditorRuntime("scene-toolbar-playback-test");
const studioRuntime = runtime as EditorRuntime & StudioRuntimeManager;
const wrapper = createRuntimeProviderWrapper(runtime);

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

const createSceneNode = (sceneId: string): SceneNode => ({
	id: `node-${sceneId}`,
	type: "scene",
	sceneId,
	name: sceneId,
	x: 0,
	y: 0,
	width: 640,
	height: 360,
	zIndex: 1,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
});

beforeEach(() => {
	for (const timelineRuntime of studioRuntime.listTimelineRuntimes()) {
		studioRuntime.removeTimelineRuntime(timelineRuntime.ref);
	}
	studioRuntime.setActiveEditTimeline(null);
	__resetAudioOwnerForTests();
	usePlaybackOwnerStore.getState().clearOwner();

	const scene1Runtime = studioRuntime.ensureTimelineRuntime(
		toSceneTimelineRef("scene-1"),
	);
	const scene2Runtime = studioRuntime.ensureTimelineRuntime(
		toSceneTimelineRef("scene-2"),
	);
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

describe("SceneNodeToolbar playback", () => {
	it("点击播放会驱动对应 scene runtime 播放并设置 owner", () => {
		render(
			<SceneNodeToolbar
				node={createSceneNode("scene-1")}
				scene={null}
				asset={null}
				updateNode={vi.fn()}
				setActiveScene={vi.fn()}
				setFocusedScene={vi.fn()}
			/>,
			{ wrapper },
		);

		act(() => {
			fireEvent.click(screen.getByRole("button", { name: "播放 Scene" }));
		});

		expect(
			studioRuntime
				.getTimelineRuntime(toSceneTimelineRef("scene-1"))
				?.timelineStore.getState().isPlaying,
		).toBe(true);
		expect(getOwner()).toBe("scene:scene-1");
	});

	it("播放第二个 scene 时会抢占并暂停第一个 scene", () => {
		render(
			<>
				<SceneNodeToolbar
					node={createSceneNode("scene-1")}
					scene={null}
					asset={null}
					updateNode={vi.fn()}
					setActiveScene={vi.fn()}
					setFocusedScene={vi.fn()}
				/>
				<SceneNodeToolbar
					node={createSceneNode("scene-2")}
					scene={null}
					asset={null}
					updateNode={vi.fn()}
					setActiveScene={vi.fn()}
					setFocusedScene={vi.fn()}
				/>
			</>,
			{ wrapper },
		);

		const playButtons = screen.getAllByRole("button", { name: "播放 Scene" });
		act(() => {
			fireEvent.click(playButtons[0]);
		});

		act(() => {
			fireEvent.click(screen.getByRole("button", { name: "播放 Scene" }));
		});

		expect(
			studioRuntime
				.getTimelineRuntime(toSceneTimelineRef("scene-1"))
				?.timelineStore.getState().isPlaying,
		).toBe(false);
		expect(
			studioRuntime
				.getTimelineRuntime(toSceneTimelineRef("scene-2"))
				?.timelineStore.getState().isPlaying,
		).toBe(true);
		expect(getOwner()).toBe("scene:scene-2");
	});
});
