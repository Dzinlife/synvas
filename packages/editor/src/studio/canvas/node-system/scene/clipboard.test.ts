import type { TimelineElement } from "core/element/types";
import type { SceneDocument, SceneNode, StudioProject } from "core/studio/types";
import { describe, expect, it } from "vitest";
import { convertSceneNodeToTimelineElement } from "./clipboard";

const createTimelineSettings = () => ({
	snapEnabled: true,
	autoAttach: true,
	rippleEditingEnabled: false,
	previewAxisEnabled: true,
	audio: {
		exportSampleRate: 48000 as const,
		exportBlockSize: 512 as const,
		masterGainDb: 0,
		compressor: {
			enabled: false,
			thresholdDb: -18,
			ratio: 4,
			kneeDb: 6,
			attackMs: 10,
			releaseMs: 120,
			makeupGainDb: 0,
		},
	},
});

const createImageElement = (id: string, end: number): TimelineElement => ({
	id,
	type: "Image",
	component: "image",
	name: id,
	assetId: "asset-image",
	props: {},
	timeline: {
		start: 0,
		end,
		startTimecode: "00:00:00:00",
		endTimecode: "00:00:01:15",
		trackIndex: 0,
		role: "clip",
	},
	render: {
		zIndex: 0,
		visible: true,
		opacity: 1,
	},
});

const createCompositionElement = (
	id: string,
	sceneId: string,
): TimelineElement => ({
	id,
	type: "Composition",
	component: "composition",
	name: id,
	props: {
		sceneId,
	},
	timeline: {
		start: 0,
		end: 30,
		startTimecode: "00:00:00:00",
		endTimecode: "00:00:01:00",
		trackIndex: 0,
		role: "clip",
	},
	render: {
		zIndex: 0,
		visible: true,
		opacity: 1,
	},
});

const createScene = (input: {
	id: string;
	name: string;
	fps: number;
	width: number;
	height: number;
	elements: TimelineElement[];
}): SceneDocument => ({
	id: input.id,
	name: input.name,
	posterFrame: 0,
	createdAt: 1,
	updatedAt: 1,
	timeline: {
		fps: input.fps,
		canvas: { width: input.width, height: input.height },
		settings: createTimelineSettings(),
		tracks: [],
		elements: input.elements,
	},
});

const createProject = (): StudioProject => {
	const sceneA = createScene({
		id: "scene-a",
		name: "Scene A",
		fps: 30,
		width: 1920,
		height: 1080,
		elements: [],
	});
	const sceneB = createScene({
		id: "scene-b",
		name: "Scene B",
		fps: 30,
		width: 1280,
		height: 720,
		elements: [createCompositionElement("comp-b-a", "scene-a")],
	});
	const sceneC = createScene({
		id: "scene-c",
		name: "Scene C",
		fps: 30,
		width: 1280,
		height: 720,
		elements: [createImageElement("img-c", 45)],
	});
	return {
		id: "project-1",
		revision: 1,
		canvas: {
			nodes: [],
		},
		scenes: {
			[sceneA.id]: sceneA,
			[sceneB.id]: sceneB,
			[sceneC.id]: sceneC,
		},
		assets: [],
		ui: {
			activeSceneId: sceneA.id,
			focusedNodeId: null,
			activeNodeId: null,
			canvasSnapEnabled: true,
			camera: {
				x: 0,
				y: 0,
				zoom: 1,
			},
		},
		createdAt: 1,
		updatedAt: 1,
	};
};

const createSceneNode = (sceneId: string): SceneNode => ({
	id: `node-${sceneId}`,
	type: "scene",
	sceneId,
	name: `Node ${sceneId}`,
	x: 120,
	y: 240,
	width: 640,
	height: 360,
	siblingOrder: 1,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
});

describe("scene node clipboard conversion", () => {
	it("scene node 可以转换为 Composition timeline element", () => {
		const project = createProject();
		const scene = project.scenes["scene-c"];
		const converted = convertSceneNodeToTimelineElement({
			node: createSceneNode("scene-c"),
			project,
			targetSceneId: "scene-a",
			scene,
			asset: null,
			fps: 60,
			startFrame: 30,
			trackIndex: 2,
			createElementId: () => "element-scene-c",
		});

		expect(converted).toBeTruthy();
		if (!converted || converted.type !== "Composition") return;
		expect(converted.component).toBe("composition");
		expect(converted.props).toEqual({
			sceneId: "scene-c",
		});
		expect(converted.timeline.start).toBe(30);
		expect(converted.timeline.end).toBe(120);
		expect(converted.timeline.trackIndex).toBe(2);
		expect(converted.timeline.role).toBe("clip");
		expect(converted.transform?.baseSize.width).toBe(1280);
		expect(converted.transform?.baseSize.height).toBe(720);
	});

	it("会在形成 scene composition 循环时跳过转换", () => {
		const project = createProject();
		const scene = project.scenes["scene-b"];
		const converted = convertSceneNodeToTimelineElement({
			node: createSceneNode("scene-b"),
			project,
			targetSceneId: "scene-a",
			scene,
			asset: null,
			fps: 30,
			startFrame: 0,
			trackIndex: 0,
			createElementId: () => "element-scene-b",
		});

		expect(converted).toBeNull();
	});
});
