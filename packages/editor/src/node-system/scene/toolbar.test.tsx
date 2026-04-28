// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import type { SceneNode } from "@/studio/project/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetAudioOwnerForTests, getOwner } from "@/audio/owner";
import {
	createRuntimeProviderWrapper,
	createTestEditorRuntime,
} from "@/scene-editor/runtime/testUtils";
import type {
	EditorRuntime,
	StudioRuntimeManager,
} from "@/scene-editor/runtime/types";
import { usePlaybackOwnerStore } from "@/studio/scene/playbackOwnerStore";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import { framesToTimecode } from "@/utils/timecode";
import { SceneNodeToolbar } from "./toolbar";

vi.mock("@/scene-editor/components/ExportVideoDialog", () => ({
	default: () => <button type="button">导出视频</button>,
}));

vi.mock("@/scene-editor/components/PreviewLoudnessMeterCanvas", () => ({
	default: ({ active }: { active?: boolean }) => (
		<div data-active={String(active)} data-testid="preview-loudness-meter" />
	),
}));

vi.mock("@/scene-editor/exportVideo", () => ({
	exportTimelineAsVideo: vi.fn(async () => {}),
}));

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
	siblingOrder: 1,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
});

afterEach(() => {
	cleanup();
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
		fps: 30,
		canvasSize: { width: 1920, height: 1080 },
	});
	scene2Runtime.timelineStore.setState({
		elements: [createPlayableElement("scene-2-element")],
		currentTime: 0,
		previewTime: null,
		fps: 30,
		canvasSize: { width: 1920, height: 1080 },
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
				setFocusedNode={vi.fn()}
			/>,
			{ wrapper },
		);

		act(() => {
			fireEvent.click(screen.getByRole("button", { name: "播放 / 暂停" }));
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
					setFocusedNode={vi.fn()}
				/>
				<SceneNodeToolbar
					node={createSceneNode("scene-2")}
					scene={null}
					asset={null}
					updateNode={vi.fn()}
					setActiveScene={vi.fn()}
					setFocusedNode={vi.fn()}
				/>
			</>,
			{ wrapper },
		);

		act(() => {
			fireEvent.click(
				screen.getAllByRole("button", { name: "播放 / 暂停" })[0],
			);
		});

		act(() => {
			fireEvent.click(
				screen.getAllByRole("button", { name: "播放 / 暂停" })[1],
			);
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

	it("时间码读取当前 node 对应的 scene runtime", () => {
		studioRuntime
			.getTimelineRuntime(toSceneTimelineRef("scene-1"))
			?.timelineStore.setState({
				currentTime: 150,
				previewTime: 90,
				fps: 30,
			});
		studioRuntime
			.getTimelineRuntime(toSceneTimelineRef("scene-2"))
			?.timelineStore.setState({
				currentTime: 48,
				previewTime: null,
				fps: 24,
			});
		studioRuntime.setActiveEditTimeline(toSceneTimelineRef("scene-2"));

		render(
			<SceneNodeToolbar
				node={createSceneNode("scene-1")}
				scene={null}
				asset={null}
				updateNode={vi.fn()}
				setActiveScene={vi.fn()}
				setFocusedNode={vi.fn()}
			/>,
			{ wrapper },
		);

		expect(screen.getByText(framesToTimecode(90, 30))).toBeTruthy();
		expect(screen.queryByText(framesToTimecode(48, 24))).toBeNull();
	});

	it("更多菜单只保留占位选项", async () => {
		render(
			<SceneNodeToolbar
				node={createSceneNode("scene-1")}
				scene={null}
				asset={null}
				updateNode={vi.fn()}
				setActiveScene={vi.fn()}
				setFocusedNode={vi.fn()}
			/>,
			{ wrapper },
		);

		fireEvent.click(screen.getByRole("button", { name: "Scene 选项" }));

		expect(await screen.findByText("选项（待实现）")).toBeTruthy();
		expect(screen.queryByText("缩放")).toBeNull();
		expect(screen.queryByText("重置视图位置（适应窗口）")).toBeNull();
		expect(screen.queryByText("导出静帧画面")).toBeNull();
	});

	it("未聚焦时圆形按钮会聚焦当前 scene", () => {
		const setActiveScene = vi.fn();
		const setFocusedNode = vi.fn();

		render(
			<SceneNodeToolbar
				node={createSceneNode("scene-1")}
				scene={null}
				asset={null}
				updateNode={vi.fn()}
				setActiveScene={setActiveScene}
				setFocusedNode={setFocusedNode}
			/>,
			{ wrapper },
		);

		fireEvent.click(screen.getByRole("button", { name: "聚焦 Scene" }));

		expect(setActiveScene).toHaveBeenCalledWith("scene-1");
		expect(setFocusedNode).toHaveBeenCalledWith("node-scene-1");
		expect(screen.queryByRole("button", { name: "退出聚焦" })).toBeNull();
	});

	it("已聚焦时圆形按钮会退出聚焦", () => {
		const setActiveScene = vi.fn();
		const setFocusedNode = vi.fn();

		render(
			<SceneNodeToolbar
				node={createSceneNode("scene-1")}
				scene={null}
				asset={null}
				isFocused
				updateNode={vi.fn()}
				setActiveScene={setActiveScene}
				setFocusedNode={setFocusedNode}
			/>,
			{ wrapper },
		);

		fireEvent.click(screen.getByRole("button", { name: "退出聚焦" }));

		expect(setFocusedNode).toHaveBeenCalledWith(null);
		expect(setActiveScene).not.toHaveBeenCalled();
		expect(screen.queryByRole("button", { name: "聚焦 Scene" })).toBeNull();
	});
});
