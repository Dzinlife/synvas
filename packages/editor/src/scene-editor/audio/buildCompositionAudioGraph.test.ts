import type { TimelineTrack } from "core/editor/timeline/types";
import type { TimelineElement, TimelineMeta } from "core/element/types";
import { describe, expect, it, vi } from "vitest";
import { createEditorRuntime } from "@/scene-editor/runtime/createEditorRuntime";
import type {
	StudioRuntimeManager,
	TimelineRuntime,
} from "@/scene-editor/runtime/types";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import { buildCompositionAudioGraph } from "./buildCompositionAudioGraph";

const createTrack = (): TimelineTrack => ({
	id: "main",
	role: "clip",
	hidden: false,
	locked: false,
	muted: false,
	solo: false,
});

const createTimeline = (
	start: number,
	end: number,
	offset = 0,
	trackIndex = 0,
): TimelineMeta => ({
	start,
	end,
	startTimecode: "",
	endTimecode: "",
	offset,
	trackIndex,
});

const createAudioClip = ({
	id,
	start,
	end,
	offset = 0,
}: {
	id: string;
	start: number;
	end: number;
	offset?: number;
}): TimelineElement => ({
	id,
	type: "AudioClip",
	component: "audio-clip",
	name: id,
	assetId: `${id}-asset`,
	timeline: createTimeline(start, end, offset),
	props: {},
});

const createComposition = ({
	id,
	sceneId,
	start,
	end,
	offset = 0,
}: {
	id: string;
	sceneId: string;
	start: number;
	end: number;
	offset?: number;
}): TimelineElement => ({
	id,
	type: "Composition",
	component: "composition",
	name: id,
	timeline: createTimeline(start, end, offset),
	props: {
		sceneId,
	},
});

const createTransition = ({
	id,
	fromId,
	toId,
	start,
	end,
	boundary,
}: {
	id: string;
	fromId: string;
	toId: string;
	start: number;
	end: number;
	boundary: number;
}): TimelineElement => ({
	id,
	type: "Transition",
	component: "transition/crossfade",
	name: id,
	timeline: createTimeline(start, end),
	props: {
		audioCurve: "linear",
	},
	transition: {
		duration: end - start,
		boundry: boundary,
		fromId,
		toId,
	},
});

const registerAudioModel = (runtime: TimelineRuntime, elementId: string) => {
	const applyAudioMix = vi.fn();
	runtime.modelRegistry.register(elementId, {
		getState: () => ({
			type: "AudioClip",
			internal: {
				audioDuration: 3,
				audioSink: {},
				applyAudioMix,
			},
			dispose: () => {},
		}),
	} as unknown as Parameters<typeof runtime.modelRegistry.register>[1]);
	return {
		applyAudioMix,
	};
};

describe("buildCompositionAudioGraph", () => {
	it("会展开 Composition 子 scene 的 AudioClip 到混音图", () => {
		const runtimeManager = createEditorRuntime({
			id: "runtime-root",
		}) as unknown as StudioRuntimeManager;
		const rootRuntime = runtimeManager.ensureTimelineRuntime(
			toSceneTimelineRef("scene-root"),
		);
		const childRuntime = runtimeManager.ensureTimelineRuntime(
			toSceneTimelineRef("scene-child"),
		);

		rootRuntime.timelineStore.getState().setTracks([createTrack()]);
		rootRuntime.timelineStore.getState().setElements([
			createComposition({
				id: "comp-1",
				sceneId: "scene-child",
				start: 0,
				end: 90,
			}),
		]);

		childRuntime.timelineStore.getState().setTracks([createTrack()]);
		childRuntime.timelineStore.getState().setElements([
			createAudioClip({
				id: "child-audio",
				start: 0,
				end: 90,
			}),
		]);
		registerAudioModel(childRuntime, "child-audio");

		const graph = buildCompositionAudioGraph({
			rootRuntime,
			runtimeManager,
		});

		expect(graph.previewTargets.size).toBe(1);
		expect(graph.exportAudioSourceMap.size).toBe(1);
		expect(graph.physicalClipRefs).toEqual([
			expect.objectContaining({
				sceneId: "scene-child",
				elementId: "child-audio",
			}),
		]);
		const mixedClip = graph.mixElements.find((element) => {
			return element.type === "AudioClip";
		});
		expect(mixedClip?.timeline.start).toBe(0);
		expect(mixedClip?.timeline.end).toBe(90);
	});

	it("Composition offset 会映射到子场景时间并裁剪可听片段", () => {
		const runtimeManager = createEditorRuntime({
			id: "runtime-root",
		}) as unknown as StudioRuntimeManager;
		const rootRuntime = runtimeManager.ensureTimelineRuntime(
			toSceneTimelineRef("scene-root"),
		);
		const childRuntime = runtimeManager.ensureTimelineRuntime(
			toSceneTimelineRef("scene-child"),
		);

		rootRuntime.timelineStore.getState().setTracks([createTrack()]);
		rootRuntime.timelineStore.getState().setElements([
			createComposition({
				id: "comp-offset",
				sceneId: "scene-child",
				start: 10,
				end: 70,
				offset: 15,
			}),
		]);

		childRuntime.timelineStore.getState().setTracks([createTrack()]);
		childRuntime.timelineStore.getState().setElements([
			createAudioClip({
				id: "child-audio",
				start: 0,
				end: 120,
			}),
		]);
		registerAudioModel(childRuntime, "child-audio");

		const graph = buildCompositionAudioGraph({
			rootRuntime,
			runtimeManager,
		});
		const mixedClip = graph.mixElements.find((element) => {
			return element.type === "AudioClip";
		});
		expect(mixedClip?.timeline.start).toBe(10);
		expect(mixedClip?.timeline.end).toBe(70);
		expect(mixedClip?.timeline.offset).toBe(15);
	});

	it("Composition 边界单片段映射会保持双侧转场", () => {
		const runtimeManager = createEditorRuntime({
			id: "runtime-root",
		}) as unknown as StudioRuntimeManager;
		const rootRuntime = runtimeManager.ensureTimelineRuntime(
			toSceneTimelineRef("scene-root"),
		);
		const fromRuntime = runtimeManager.ensureTimelineRuntime(
			toSceneTimelineRef("scene-from"),
		);
		const toRuntime = runtimeManager.ensureTimelineRuntime(
			toSceneTimelineRef("scene-to"),
		);

		rootRuntime.timelineStore.getState().setTracks([createTrack()]);
		rootRuntime.timelineStore.getState().setElements([
			createComposition({
				id: "comp-from",
				sceneId: "scene-from",
				start: 0,
				end: 60,
			}),
			createComposition({
				id: "comp-to",
				sceneId: "scene-to",
				start: 60,
				end: 120,
			}),
			createTransition({
				id: "transition-root",
				fromId: "comp-from",
				toId: "comp-to",
				start: 45,
				end: 75,
				boundary: 60,
			}),
		]);

		fromRuntime.timelineStore.getState().setTracks([createTrack()]);
		fromRuntime.timelineStore.getState().setElements([
			createAudioClip({
				id: "from-audio",
				start: 0,
				end: 60,
			}),
		]);
		toRuntime.timelineStore.getState().setTracks([createTrack()]);
		toRuntime.timelineStore.getState().setElements([
			createAudioClip({
				id: "to-audio",
				start: 0,
				end: 60,
			}),
		]);
		registerAudioModel(fromRuntime, "from-audio");
		registerAudioModel(toRuntime, "to-audio");

		const graph = buildCompositionAudioGraph({
			rootRuntime,
			runtimeManager,
		});

		const transitionElements = graph.mixElements.filter((element) => {
			return element.type === "Transition";
		});
		expect(transitionElements).toHaveLength(1);
		const transition = transitionElements[0];
		expect(transition?.transition?.fromId.includes("from-audio")).toBe(true);
		expect(transition?.transition?.toId.includes("to-audio")).toBe(true);
		const proxyCount = graph.mixElements.filter((element) => {
			return element.component === "__composition_audio_proxy__";
		}).length;
		expect(proxyCount).toBe(0);
	});

	it("Composition 边界多片段映射会拆分为单侧转场并使用 proxy", () => {
		const runtimeManager = createEditorRuntime({
			id: "runtime-root",
		}) as unknown as StudioRuntimeManager;
		const rootRuntime = runtimeManager.ensureTimelineRuntime(
			toSceneTimelineRef("scene-root"),
		);
		const fromRuntime = runtimeManager.ensureTimelineRuntime(
			toSceneTimelineRef("scene-from"),
		);
		const toRuntime = runtimeManager.ensureTimelineRuntime(
			toSceneTimelineRef("scene-to"),
		);

		rootRuntime.timelineStore.getState().setTracks([createTrack()]);
		rootRuntime.timelineStore.getState().setElements([
			createComposition({
				id: "comp-from",
				sceneId: "scene-from",
				start: 0,
				end: 60,
			}),
			createComposition({
				id: "comp-to",
				sceneId: "scene-to",
				start: 60,
				end: 120,
			}),
			createTransition({
				id: "transition-root",
				fromId: "comp-from",
				toId: "comp-to",
				start: 45,
				end: 75,
				boundary: 60,
			}),
		]);

		fromRuntime.timelineStore.getState().setTracks([createTrack()]);
		fromRuntime.timelineStore.getState().setElements([
			createAudioClip({
				id: "from-audio-a",
				start: 0,
				end: 60,
			}),
			createAudioClip({
				id: "from-audio-b",
				start: 30,
				end: 60,
			}),
		]);
		toRuntime.timelineStore.getState().setTracks([createTrack()]);
		toRuntime.timelineStore.getState().setElements([
			createAudioClip({
				id: "to-audio-a",
				start: 0,
				end: 60,
			}),
			createAudioClip({
				id: "to-audio-b",
				start: 0,
				end: 30,
			}),
		]);
		registerAudioModel(fromRuntime, "from-audio-a");
		registerAudioModel(fromRuntime, "from-audio-b");
		registerAudioModel(toRuntime, "to-audio-a");
		registerAudioModel(toRuntime, "to-audio-b");

		const graph = buildCompositionAudioGraph({
			rootRuntime,
			runtimeManager,
		});

		const transitionElements = graph.mixElements.filter((element) => {
			return element.type === "Transition";
		});
		expect(transitionElements.length).toBeGreaterThan(2);
		const proxyCount = graph.mixElements.filter((element) => {
			return element.component === "__composition_audio_proxy__";
		}).length;
		expect(proxyCount).toBeGreaterThan(0);
	});

	it("循环 Composition 引用会被跳过并告警", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		const runtimeManager = createEditorRuntime({
			id: "runtime-root",
		}) as unknown as StudioRuntimeManager;
		const rootRuntime = runtimeManager.ensureTimelineRuntime(
			toSceneTimelineRef("scene-root"),
		);
		const childRuntime = runtimeManager.ensureTimelineRuntime(
			toSceneTimelineRef("scene-child"),
		);

		rootRuntime.timelineStore.getState().setTracks([createTrack()]);
		rootRuntime.timelineStore.getState().setElements([
			createComposition({
				id: "comp-child",
				sceneId: "scene-child",
				start: 0,
				end: 90,
			}),
		]);
		childRuntime.timelineStore.getState().setTracks([createTrack()]);
		childRuntime.timelineStore.getState().setElements([
			createAudioClip({
				id: "child-audio",
				start: 0,
				end: 90,
			}),
			createComposition({
				id: "comp-root",
				sceneId: "scene-root",
				start: 0,
				end: 90,
			}),
		]);
		registerAudioModel(childRuntime, "child-audio");

		const graph = buildCompositionAudioGraph({
			rootRuntime,
			runtimeManager,
		});
		const clipCount = graph.mixElements.filter((element) => {
			return element.type === "AudioClip";
		}).length;
		expect(clipCount).toBe(1);
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});
