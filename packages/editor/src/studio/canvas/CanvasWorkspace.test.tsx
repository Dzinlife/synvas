// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { StudioProject } from "core/studio/types";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectStore } from "@/projects/projectStore";
import CanvasWorkspace from "./CanvasWorkspace";

const stageMockState = vi.hoisted(() => ({
	props: null as Record<string, unknown> | null,
}));

vi.mock("react-konva", () => ({
	Stage: ({ children, ...props }: Record<string, unknown>) => {
		stageMockState.props = props;
		return <div>{children as ReactNode}</div>;
	},
	Layer: ({ children }: Record<string, unknown>) => (
		<div>{children as ReactNode}</div>
	),
	Rect: ({ children, onClick, className }: Record<string, unknown>) => (
		<button
			type="button"
			data-testid={String(className ?? "rect")}
			onClick={onClick as () => void}
		>
			{children as ReactNode}
		</button>
	),
	Text: ({ text }: { text: string }) => <span>{text}</span>,
	Line: () => <span />,
	Transformer: () => <span data-testid="transformer" />,
}));

vi.mock("@/editor/PreviewEditor", () => ({
	default: () => <div data-testid="preview-editor" />,
}));

vi.mock("@/editor/components/SceneTimelineDrawer", () => ({
	default: ({ onExitFocus }: { onExitFocus: () => void }) => (
		<button
			type="button"
			onClick={onExitFocus}
			data-testid="scene-timeline-drawer"
		>
			drawer
		</button>
	),
}));

vi.mock("@/editor/MaterialLibrary", () => ({
	default: () => (
		<div data-testid="material-library-content">material-library</div>
	),
}));

vi.mock("@/editor/runtime/EditorRuntimeProvider", () => ({
	useTimelineStoreApi: () =>
		({
			getState: () => ({
				currentTime: 0,
				previewTime: null,
			}),
		}) as unknown,
}));

const createProject = (): StudioProject => ({
	id: "project-1",
	revision: 0,
	canvas: {
		nodes: [
			{
				id: "node-1",
				type: "scene",
				sceneId: "scene-1",
				name: "Scene 1",
				x: 0,
				y: 0,
				width: 960,
				height: 540,
				zIndex: 0,
				locked: false,
				hidden: false,
				createdAt: 1,
				updatedAt: 1,
			},
			{
				id: "node-2",
				type: "scene",
				sceneId: "scene-2",
				name: "Scene 2",
				x: 100,
				y: 100,
				width: 960,
				height: 540,
				zIndex: 1,
				locked: false,
				hidden: false,
				createdAt: 1,
				updatedAt: 1,
			},
		],
	},
	scenes: {
		"scene-1": {
			id: "scene-1",
			name: "Scene 1",
			posterFrame: 0,
			createdAt: 1,
			updatedAt: 1,
			timeline: {
				fps: 30,
				canvas: { width: 1920, height: 1080 },
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
				assets: [],
				elements: [],
			},
		},
		"scene-2": {
			id: "scene-2",
			name: "Scene 2",
			posterFrame: 0,
			createdAt: 1,
			updatedAt: 1,
			timeline: {
				fps: 30,
				canvas: { width: 1920, height: 1080 },
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
				assets: [],
				elements: [],
			},
		},
	},
	ui: {
		activeSceneId: "scene-1",
		focusedSceneId: null,
		camera: { x: 0, y: 0, zoom: 1 },
	},
	createdAt: 1,
	updatedAt: 1,
});

beforeEach(() => {
	useProjectStore.setState({
		status: "ready",
		projects: [],
		currentProjectId: "project-1",
		currentProject: createProject(),
		currentProjectData: null,
		focusedSceneDrafts: {},
		error: null,
	});
});

afterEach(() => {
	cleanup();
});

describe("CanvasWorkspace", () => {
	const triggerStageWheel = (
		wheelEvent: WheelEvent,
		pointer = { x: 0, y: 0 },
	) => {
		const onWheel = stageMockState.props?.onWheel as
			| ((event: {
					evt: WheelEvent;
					target: {
						getStage: () => {
							getPointerPosition: () => { x: number; y: number };
						};
					};
			  }) => void)
			| undefined;
		expect(onWheel).toBeTypeOf("function");
		onWheel?.({
			evt: wheelEvent,
			target: {
				getStage: () => ({
					getPointerPosition: () => pointer,
				}),
			},
		});
	};

	it("canvas 模式渲染 scene 节点", () => {
		render(<CanvasWorkspace />);
		expect(screen.getByText(/Scene 1/)).toBeTruthy();
		expect(screen.getByText(/Scene 2/)).toBeTruthy();
	});

	it("点击节点进入 focus 并显示 timeline drawer", () => {
		render(<CanvasWorkspace />);
		const firstNode = screen.getAllByTestId("scene-node-node-1")[0];
		expect(firstNode).toBeTruthy();
		if (!firstNode) return;
		fireEvent.click(firstNode);
		expect(screen.getByTestId("preview-editor")).toBeTruthy();
		expect(screen.getByTestId("scene-timeline-drawer")).toBeTruthy();
		expect(screen.getByTestId("focus-material-library")).toBeTruthy();
		expect(screen.getByTestId("material-library-content")).toBeTruthy();
	});

	it("普通滚轮应平移画布", () => {
		render(<CanvasWorkspace />);
		triggerStageWheel(new WheelEvent("wheel", { deltaX: 20, deltaY: 30 }));
		const camera = useProjectStore.getState().currentProject?.ui.camera;
		expect(camera).toMatchObject({ x: -20, y: -30, zoom: 1 });
	});

	it("Ctrl + 滚轮应缩放画布", () => {
		render(<CanvasWorkspace />);
		triggerStageWheel(
			new WheelEvent("wheel", {
				deltaY: -10,
				ctrlKey: true,
			}),
			{ x: 100, y: 120 },
		);
		const camera = useProjectStore.getState().currentProject?.ui.camera;
		expect(camera?.zoom).toBeCloseTo(1.08, 4);
		expect(camera?.x).toBeCloseTo(-8, 4);
		expect(camera?.y).toBeCloseTo(-9.6, 4);
	});

	it("按下空白区域不会触发拖拽平移", () => {
		render(<CanvasWorkspace />);
		const stage = {
			getStage: () => stage,
		};
		const onMouseDown = stageMockState.props?.onMouseDown as
			| ((event: { target: { getStage: () => unknown } }) => void)
			| undefined;
		expect(onMouseDown).toBeTypeOf("function");
		onMouseDown?.({ target: stage });
		expect(stageMockState.props?.onMouseMove).toBeUndefined();
		const camera = useProjectStore.getState().currentProject?.ui.camera;
		expect(camera).toMatchObject({ x: 0, y: 0, zoom: 1 });
	});
});
