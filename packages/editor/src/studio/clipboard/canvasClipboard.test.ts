import type { StudioProject } from "@/studio/project/types";
import { describe, expect, it } from "vitest";
import {
	buildCanvasClipboardEntries,
	instantiateCanvasClipboardEntries,
} from "./canvasClipboard";

const createProject = (): StudioProject => ({
	id: "project-1",
	revision: 1,
	canvas: {
		nodes: [
			{
				id: "node-scene-1",
				type: "scene",
				sceneId: "scene-1",
				name: "Scene 1",
				x: 100,
				y: 80,
				width: 960,
				height: 540,
				siblingOrder: 0,
				locked: false,
				hidden: false,
				createdAt: 1,
				updatedAt: 1,
			},
			{
				id: "node-image-1",
				type: "image",
				assetId: "asset-1",
				name: "Image 1",
				x: 420,
				y: 260,
				width: 320,
				height: 180,
				siblingOrder: 1,
				locked: false,
				hidden: false,
				createdAt: 2,
				updatedAt: 2,
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
				elements: [],
			},
		},
	},
	assets: [
		{
			id: "asset-1",
			kind: "image",
			name: "image",
			locator: {
				type: "linked-file",
				filePath: "/tmp/image.png",
			},
			meta: {
				fileName: "image.png",
			},
		},
	],
	ui: {
		activeSceneId: "scene-1",
		focusedNodeId: null,
		activeNodeId: "node-scene-1",
		canvasSnapEnabled: true,
		camera: { x: 0, y: 0, zoom: 1 },
	},
	createdAt: 1,
	updatedAt: 1,
});

describe("canvasClipboard", () => {
	it("buildCanvasClipboardEntries 会携带 scene 快照", () => {
		const project = createProject();
		const entries = buildCanvasClipboardEntries(project, [
			"node-scene-1",
			"node-image-1",
		]);
		expect(entries).toHaveLength(2);
		expect(entries[0]?.node.type).toBe("scene");
		expect(entries[0]?.scene?.id).toBe("scene-1");
		expect(entries[1]?.node.type).toBe("image");
		expect(entries[1]?.scene).toBeUndefined();
	});

	it("instantiateCanvasClipboardEntries 会按包围盒左上落点并深拷贝 scene", () => {
		const project = createProject();
		const sourceEntries = buildCanvasClipboardEntries(project, [
			"node-scene-1",
			"node-image-1",
		]);
		const pastedEntries = instantiateCanvasClipboardEntries({
			sourceEntries,
			targetLeft: 1000,
			targetTop: 600,
			existingNodes: [
				...project.canvas.nodes,
				{
					...project.canvas.nodes[1],
					id: "existing-node-10",
					siblingOrder: 10,
				},
			],
		});
		expect(pastedEntries).toHaveLength(2);
		const sceneEntry = pastedEntries.find(
			(entry) => entry.node.type === "scene",
		);
		const imageEntry = pastedEntries.find(
			(entry) => entry.node.type === "image",
		);
		expect(sceneEntry).toBeTruthy();
		expect(imageEntry).toBeTruthy();
		if (!sceneEntry || !imageEntry || sceneEntry.node.type !== "scene") return;
		expect(sceneEntry.node.x).toBe(1000);
		expect(sceneEntry.node.y).toBe(600);
		expect(imageEntry.node.x).toBe(1320);
		expect(imageEntry.node.y).toBe(780);
		expect(sceneEntry.scene?.id).not.toBe("scene-1");
			expect(sceneEntry.node.sceneId).toBe(sceneEntry.scene?.id);
			expect(sceneEntry.node.name).toBe("Scene 1副本");
			expect(imageEntry.node.name).toBe("Image 1副本");
			expect(sceneEntry.node.siblingOrder).toBeGreaterThanOrEqual(3);
			expect(imageEntry.node.siblingOrder).toBeGreaterThan(sceneEntry.node.siblingOrder);
			expect(imageEntry.node.siblingOrder - sceneEntry.node.siblingOrder).toBe(1);
		});
	});
