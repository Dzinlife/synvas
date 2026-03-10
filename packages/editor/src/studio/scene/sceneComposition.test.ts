import type { TimelineElement } from "core/element/types";
import type { StudioProject } from "core/studio/types";
import { describe, expect, it } from "vitest";
import {
	resolveCompositionSceneIdFromElement,
	wouldCreateSceneCompositionCycle,
} from "./sceneComposition";

const createElement = (id: string, sceneId: string): TimelineElement => ({
	id,
	type: "Composition",
	component: "composition",
	name: id,
	props: { sceneId },
	timeline: {
		start: 0,
		end: 30,
		startTimecode: "00:00:00:00",
		endTimecode: "00:00:01:00",
		trackIndex: 0,
		role: "clip",
	},
});

const createProject = (
	compositionByScene: Record<string, string[]>,
): StudioProject => {
	const now = 1;
	const scenes = Object.fromEntries(
		Object.entries(compositionByScene).map(([sceneId, children]) => [
			sceneId,
			{
				id: sceneId,
				name: sceneId,
				timeline: {
					fps: 30,
					canvas: { width: 1920, height: 1080 },
					settings: {
						snapEnabled: true,
						autoAttach: true,
						rippleEditingEnabled: true,
						previewAxisEnabled: true,
						audio: {
							exportSampleRate: 44100 as const,
							exportBlockSize: 1024 as const,
							masterGainDb: 0,
							compressor: {
								enabled: false,
								thresholdDb: -24,
								ratio: 2,
								kneeDb: 30,
								attackMs: 10,
								releaseMs: 100,
								makeupGainDb: 0,
							},
						},
					},
					elements: children.map((childId, index) =>
						createElement(`composition-${sceneId}-${index}`, childId),
					),
					tracks: [],
				},
				posterFrame: 0,
				createdAt: now,
				updatedAt: now,
			},
		]),
	);

	return {
		id: "project",
		revision: 0,
		canvas: { nodes: [] },
		scenes,
		assets: [],
		ui: {
			activeSceneId: null,
			focusedNodeId: null,
			activeNodeId: null,
			canvasSnapEnabled: true,
			camera: { x: 0, y: 0, zoom: 1 },
		},
		createdAt: now,
		updatedAt: now,
	};
};

describe("sceneComposition", () => {
	it("resolveCompositionSceneIdFromElement 仅解析 Composition.sceneId", () => {
		expect(
			resolveCompositionSceneIdFromElement(
				createElement("composition-1", "scene-1"),
			),
		).toBe("scene-1");
		expect(
			resolveCompositionSceneIdFromElement({
				...createElement("composition-2", "scene-2"),
				props: {},
			}),
		).toBeNull();
		expect(
			resolveCompositionSceneIdFromElement({
				...createElement("composition-3", "scene-3"),
				type: "Image",
			}),
		).toBeNull();
	});

	it("wouldCreateSceneCompositionCycle 能检测自引用与间接环", () => {
		const project = createProject({
			a: ["b"],
			b: ["c"],
			c: [],
		});
		expect(wouldCreateSceneCompositionCycle(project, "a", "a")).toBe(true);
		expect(wouldCreateSceneCompositionCycle(project, "c", "a")).toBe(true);
		expect(wouldCreateSceneCompositionCycle(project, "a", "c")).toBe(false);
	});
});
