// @vitest-environment jsdom
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTransformMeta } from "@/element-system/transform";
import { useProjectStore } from "@/projects/projectStore";
import {
	createRuntimeProviderWrapper,
	createTestEditorRuntime,
} from "@/scene-editor/runtime/testUtils";
import { buildTimelineMeta } from "@/scene-editor/utils/timelineTime";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import type { SceneDocument, SceneNode } from "@/studio/project/types";
import { SceneNodeInspector } from "./inspector";

vi.mock("@/scene-editor/components/SceneElementLibrary", () => ({
	default: () => <div data-testid="canvas-element-library" />,
}));

const createSceneNode = (sceneId = "scene-1"): SceneNode => ({
	id: `node-${sceneId}`,
	type: "scene",
	sceneId,
	name: `Node ${sceneId}`,
	x: 0,
	y: 0,
	width: 960,
	height: 540,
	siblingOrder: 0,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
});

const createTimelineElement = (id = "element-1") => ({
	id,
	type: "Image" as const,
	component: "image",
	name: "Image Clip",
	assetId: "asset-1",
	props: {},
	transform: createTransformMeta({
		width: 320,
		height: 180,
		positionX: 0,
		positionY: 0,
	}),
	timeline: buildTimelineMeta(
		{
			start: 0,
			end: 150,
			trackIndex: 0,
			role: "clip",
		},
		30,
	),
	render: {
		zIndex: 0,
		visible: true,
		opacity: 1,
	},
});

const createSceneDocument = (
	elements: Array<ReturnType<typeof createTimelineElement>> = [],
): SceneDocument => ({
	id: "scene-1",
	name: "Scene 1",
	posterFrame: 0,
	createdAt: 1,
	updatedAt: 1,
	timeline: {
		fps: 30,
		canvas: {
			width: 1920,
			height: 1080,
		},
		settings: {
			snapEnabled: true,
			autoAttach: true,
			rippleEditingEnabled: false,
			previewAxisEnabled: true,
			audio: {
				exportSampleRate: 48000,
				exportBlockSize: 512,
				masterGainDb: 0,
				compressor: {
					enabled: true,
					thresholdDb: -12,
					ratio: 4,
					kneeDb: 6,
					attackMs: 10,
					releaseMs: 80,
					makeupGainDb: 0,
				},
			},
		},
		tracks: [],
		elements,
	},
});

beforeEach(() => {
	useProjectStore.setState({
		currentProject: null,
		currentProjectId: null,
	});
});

afterEach(() => {
	cleanup();
});

describe("SceneNodeInspector", () => {
	it("默认展示属性 tab，未选中 element 时不显示选中元素 tab", () => {
		const runtime = createTestEditorRuntime("scene-inspector-meta");
		runtime.ensureTimelineRuntime(toSceneTimelineRef("scene-1"));

		render(
			<SceneNodeInspector
				node={createSceneNode()}
				scene={createSceneDocument()}
				asset={null}
				isFocused={false}
				updateNode={() => {}}
				setFocusedNode={() => {}}
				setActiveScene={() => {}}
			/>,
			{ wrapper: createRuntimeProviderWrapper(runtime) },
		);

		expect(
			screen
				.getByTestId("scene-inspector-tab-properties")
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(
			screen.queryByTestId("scene-inspector-tab-selected-element"),
		).toBeNull();
		const panel = screen.getByTestId("canvas-scene-node-meta-panel");
		expect(panel.textContent).toContain("Scene 1");
		expect(panel.textContent).toContain("scene-1");
		expect(panel.textContent).toContain("1920 x 1080");
		expect(panel.textContent).toContain("30");
		expect(panel.textContent).toContain("0f");
	});

	it("点击元素组件 tab 后展示 scene 元素组件库", () => {
		const runtime = createTestEditorRuntime("scene-inspector-components");
		runtime.ensureTimelineRuntime(toSceneTimelineRef("scene-1"));

		render(
			<SceneNodeInspector
				node={createSceneNode()}
				scene={createSceneDocument()}
				asset={null}
				isFocused={false}
				updateNode={() => {}}
				setFocusedNode={() => {}}
				setActiveScene={() => {}}
			/>,
			{ wrapper: createRuntimeProviderWrapper(runtime) },
		);

		fireEvent.click(screen.getByTestId("scene-inspector-tab-components"));

		expect(
			screen.getByTestId("canvas-scene-element-library-panel"),
		).toBeTruthy();
		expect(screen.getByTestId("canvas-element-library")).toBeTruthy();
		expect(
			screen
				.getByTestId("scene-inspector-tab-components")
				.getAttribute("aria-pressed"),
		).toBe("true");
	});

	it("选中 element 时自动展示 scene runtime 作用域下的 element 面板", () => {
		const runtime = createTestEditorRuntime("scene-inspector-element");
		const element = createTimelineElement();
		const sceneRef = toSceneTimelineRef("scene-1");
		const sceneRuntime = runtime.ensureTimelineRuntime(sceneRef);
		sceneRuntime.timelineStore.setState({
			elements: [element],
			selectedIds: [element.id],
			primarySelectedId: element.id,
			fps: 30,
		});

		render(
			<SceneNodeInspector
				node={createSceneNode()}
				scene={createSceneDocument([element])}
				asset={null}
				isFocused
				updateNode={() => {}}
				setFocusedNode={() => {}}
				setActiveScene={() => {}}
			/>,
			{ wrapper: createRuntimeProviderWrapper(runtime) },
		);

		expect(
			screen
				.getByTestId("scene-inspector-tab-selected-element")
				.getAttribute("aria-pressed"),
		).toBe("true");
		const panel = screen.getByTestId("canvas-timeline-element-settings-panel");
		expect(panel).toBeTruthy();
		expect(screen.getByDisplayValue("Image Clip")).toBeTruthy();
	});

	it("scene 不可用时 fallback 到默认 node inspector", () => {
		const runtime = createTestEditorRuntime("scene-inspector-fallback");

		render(
			<SceneNodeInspector
				node={createSceneNode()}
				scene={null}
				asset={null}
				isFocused={false}
				updateNode={() => {}}
				setFocusedNode={() => {}}
				setActiveScene={() => {}}
			/>,
			{ wrapper: createRuntimeProviderWrapper(runtime) },
		);

		expect(screen.getByTestId("canvas-node-inspector")).toBeTruthy();
	});

	it("清空 element 选中后会回到 scene 元数据面板", () => {
		const runtime = createTestEditorRuntime("scene-inspector-clear-selection");
		const element = createTimelineElement();
		const sceneRef = toSceneTimelineRef("scene-1");
		const sceneRuntime = runtime.ensureTimelineRuntime(sceneRef);
		sceneRuntime.timelineStore.setState({
			elements: [element],
			selectedIds: [element.id],
			primarySelectedId: element.id,
			fps: 30,
		});

		render(
			<SceneNodeInspector
				node={createSceneNode()}
				scene={createSceneDocument([element])}
				asset={null}
				isFocused
				updateNode={() => {}}
				setFocusedNode={() => {}}
				setActiveScene={() => {}}
			/>,
			{ wrapper: createRuntimeProviderWrapper(runtime) },
		);

		act(() => {
			sceneRuntime.timelineStore.getState().setSelectedIds([], null);
		});

		expect(
			screen.queryByTestId("scene-inspector-tab-selected-element"),
		).toBeNull();
		expect(
			screen
				.getByTestId("scene-inspector-tab-properties")
				.getAttribute("aria-pressed"),
		).toBe("true");
		expect(screen.getByTestId("canvas-scene-node-meta-panel")).toBeTruthy();
	});
});
