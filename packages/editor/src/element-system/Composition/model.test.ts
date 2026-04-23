import type { TimelineJSON } from "core/timeline-system/loader";
import type { TimelineElement } from "core/timeline-system/types";
import type { StudioProject } from "@/studio/project/types";
import { framesToTimecode } from "core/timeline-system/timecode";
import { beforeEach, describe, expect, it } from "vitest";
import { useProjectStore } from "@/projects/projectStore";
import { createTestEditorRuntime } from "@/scene-editor/runtime/testUtils";
import {
	createCompositionAudioClipModel,
	createCompositionModel,
} from "./model";

const createSceneTimeline = (durationFrames: number): TimelineJSON => ({
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
	elements:
		durationFrames <= 0
			? []
			: [
					{
						id: "source-clip",
						type: "Image" as const,
						component: "image",
						name: "source",
						assetId: "asset-1",
						props: {},
						timeline: {
							start: 0,
							end: durationFrames,
							startTimecode: framesToTimecode(0, 30),
							endTimecode: framesToTimecode(durationFrames, 30),
							trackIndex: 0,
							role: "clip" as const,
						},
					},
				],
});

const createProject = (sourceDuration: number): StudioProject => ({
	id: "project-1",
	revision: 0,
	assets: [
		{
			id: "asset-1",
			kind: "image",
			name: "asset-1",
			locator: {
				type: "linked-file",
				filePath: "/asset-1.png",
			},
			meta: {
				fileName: "asset-1.png",
			},
		},
	],
	canvas: {
		nodes: [
			{
				id: "node-source",
				type: "scene",
				sceneId: "scene-source",
				name: "Source",
				x: 0,
				y: 0,
				width: 960,
				height: 540,
				siblingOrder: 0,
				locked: false,
				hidden: false,
				createdAt: 1,
				updatedAt: 1,
			},
			{
				id: "node-host",
				type: "scene",
				sceneId: "scene-host",
				name: "Host",
				x: 100,
				y: 100,
				width: 960,
				height: 540,
				siblingOrder: 1,
				locked: false,
				hidden: false,
				createdAt: 1,
				updatedAt: 1,
			},
		],
	},
	scenes: {
		"scene-source": {
			id: "scene-source",
			name: "Source",
			timeline: createSceneTimeline(sourceDuration),
			posterFrame: 0,
			createdAt: 1,
			updatedAt: 1,
		},
		"scene-host": {
			id: "scene-host",
			name: "Host",
			timeline: createSceneTimeline(0),
			posterFrame: 0,
			createdAt: 1,
			updatedAt: 1,
		},
	},
	ui: {
		activeSceneId: "scene-host",
		focusedNodeId: "node-host",
		activeNodeId: "node-host",
		canvasSnapEnabled: true,
		camera: { x: 0, y: 0, zoom: 1 },
	},
	createdAt: 1,
	updatedAt: 1,
});

const createCompositionElement = (
	duration: number,
): TimelineElement<{
	sceneId: string;
}> => ({
	id: "composition-1",
	type: "Composition",
	component: "composition",
	name: "Composition",
	props: {
		sceneId: "scene-source",
	},
	timeline: {
		start: 0,
		end: duration,
		startTimecode: framesToTimecode(0, 30),
		endTimecode: framesToTimecode(duration, 30),
		offset: 0,
		trackIndex: 0,
		role: "clip",
	},
});

const createTailClip = (start: number, end: number): TimelineElement => ({
	id: "tail-clip",
	type: "Image",
	component: "image",
	name: "Tail",
	assetId: "asset-1",
	props: {},
	timeline: {
		start,
		end,
		startTimecode: framesToTimecode(start, 30),
		endTimecode: framesToTimecode(end, 30),
		trackIndex: 0,
		role: "clip",
	},
});

const createCompositionAudioClipElement = (
	duration: number,
	offset = 0,
): TimelineElement<{
	sceneId: string;
}> => ({
	id: "composition-audio-1",
	type: "CompositionAudioClip",
	component: "composition-audio-clip",
	name: "Composition Audio",
	props: {
		sceneId: "scene-source",
	},
	timeline: {
		start: 0,
		end: duration,
		startTimecode: framesToTimecode(0, 30),
		endTimecode: framesToTimecode(duration, 30),
		offset,
		trackIndex: -1,
		role: "audio",
	},
});

beforeEach(() => {
	useProjectStore.setState({
		status: "ready",
		projects: [],
		currentProjectId: "project-1",
		currentProject: createProject(100),
		focusedSceneDrafts: {},
		sceneTimelineMutationOpIds: {},
		error: null,
	});
});

describe("Composition model", () => {
	it("来源 scene 变化会自动收缩/增长，并复用来源 historyOpId", () => {
		const runtime = createTestEditorRuntime("composition-model-test");
		const timelineStore = runtime.timelineStore;
		timelineStore.getState().setRippleEditingEnabled(true);
		timelineStore
			.getState()
			.setElements([createCompositionElement(100), createTailClip(100, 130)], {
				history: false,
			});

		const model = createCompositionModel(
			"composition-1",
			{
				sceneId: "scene-source",
			},
			runtime,
		);
		model.getState().init();
		expect(model.getState().constraints.maxDuration).toBe(100);

		useProjectStore
			.getState()
			.updateSceneTimeline("scene-source", createSceneTimeline(80), {
				historyOpId: "op-shrink",
			});

		const afterShrink = timelineStore.getState().elements;
		const compositionAfterShrink = afterShrink.find(
			(element) => element.id === "composition-1",
		);
		const tailAfterShrink = afterShrink.find(
			(element) => element.id === "tail-clip",
		);
		expect(compositionAfterShrink?.timeline.end).toBe(80);
		expect(tailAfterShrink?.timeline.start).toBe(80);
		expect(timelineStore.getState().lastCommittedOtTxnId).toBe("op-shrink");

		useProjectStore
			.getState()
			.updateSceneTimeline("scene-source", createSceneTimeline(120), {
				historyOpId: "op-grow",
			});

		const afterGrow = timelineStore.getState().elements;
		const compositionAfterGrow = afterGrow.find(
			(element) => element.id === "composition-1",
		);
		const tailAfterGrow = afterGrow.find(
			(element) => element.id === "tail-clip",
		);
		expect(compositionAfterGrow?.timeline.end).toBe(120);
		expect(tailAfterGrow?.timeline.start).toBe(120);
		expect(timelineStore.getState().lastCommittedOtTxnId).toBe("op-grow");
		model.getState().dispose();
	});

	it("来源变长时只有原本贴上限才会自动增长", () => {
		const runtime = createTestEditorRuntime("composition-model-test-grow");
		const timelineStore = runtime.timelineStore;
		timelineStore.getState().setRippleEditingEnabled(true);
		timelineStore
			.getState()
			.setElements([createCompositionElement(70), createTailClip(70, 100)], {
				history: false,
			});

		const model = createCompositionModel(
			"composition-1",
			{
				sceneId: "scene-source",
			},
			runtime,
		);
		model.getState().init();
		expect(model.getState().constraints.maxDuration).toBe(100);

		useProjectStore
			.getState()
			.updateSceneTimeline("scene-source", createSceneTimeline(130), {
				historyOpId: "op-grow-skip",
			});

		const elements = timelineStore.getState().elements;
		const composition = elements.find(
			(element) => element.id === "composition-1",
		);
		const tail = elements.find((element) => element.id === "tail-clip");
		expect(composition?.timeline.end).toBe(70);
		expect(tail?.timeline.start).toBe(70);
		model.getState().dispose();
	});

	it("CompositionAudioClip 会按 offset 感知来源时长变化", () => {
		const runtime = createTestEditorRuntime(
			"composition-audio-model-test-grow-shrink",
		);
		const timelineStore = runtime.timelineStore;
		timelineStore.getState().setRippleEditingEnabled(true);
		timelineStore
			.getState()
			.setElements([createCompositionAudioClipElement(90, 10)], {
				history: false,
			});

		const model = createCompositionAudioClipModel(
			"composition-audio-1",
			{
				sceneId: "scene-source",
			},
			runtime,
		);
		model.getState().init();
		expect(model.getState().constraints.maxDuration).toBe(90);

		useProjectStore
			.getState()
			.updateSceneTimeline("scene-source", createSceneTimeline(120), {
				historyOpId: "op-audio-grow",
			});

		let proxyClip = timelineStore
			.getState()
			.elements.find((element) => element.id === "composition-audio-1");
		expect(proxyClip?.timeline.end).toBe(110);
		expect(model.getState().constraints.maxDuration).toBe(110);
		expect(timelineStore.getState().lastCommittedOtTxnId).toBe(
			"op-audio-grow",
		);

		useProjectStore
			.getState()
			.updateSceneTimeline("scene-source", createSceneTimeline(70), {
				historyOpId: "op-audio-shrink",
			});

		proxyClip = timelineStore
			.getState()
			.elements.find((element) => element.id === "composition-audio-1");
		expect(proxyClip?.timeline.end).toBe(60);
		expect(model.getState().constraints.maxDuration).toBe(60);
		expect(timelineStore.getState().lastCommittedOtTxnId).toBe(
			"op-audio-shrink",
		);
		model.getState().dispose();
	});
});
