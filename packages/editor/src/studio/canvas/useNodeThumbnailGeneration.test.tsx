// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type {
	ImageCanvasNode,
	SceneCanvasNode,
	StudioProject,
	VideoCanvasNode,
} from "core/studio/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeProjectFileToOpfsAtPath } from "@/lib/projectOpfsStorage";
import { useProjectStore } from "@/projects/projectStore";
import type { CanvasNodeThumbnailCapability } from "@/studio/canvas/node-system/types";
import { useNodeThumbnailGeneration } from "./useNodeThumbnailGeneration";

const getCanvasNodeDefinitionMock = vi.fn();

vi.mock("./node-system/registry", () => ({
	getCanvasNodeDefinition: (type: string) => getCanvasNodeDefinitionMock(type),
}));

vi.mock("@/lib/projectOpfsStorage", () => ({
	writeProjectFileToOpfsAtPath: vi.fn(),
}));

const createProject = (hash = "hash-a"): StudioProject => ({
	id: "project-1",
	revision: 0,
	assets: [
		{
			id: "asset-video-1",
			kind: "video",
			name: "source.mp4",
			locator: {
				type: "managed",
				fileName: "source.mp4",
			},
			meta: {
				hash,
			},
		},
	],
	canvas: {
		nodes: [
			{
				id: "node-video-1",
				type: "video",
				assetId: "asset-video-1",
				name: "Video 1",
				x: 0,
				y: 0,
				width: 640,
				height: 360,
				siblingOrder: 0,
				locked: false,
				hidden: false,
				createdAt: 1,
				updatedAt: 1,
			},
		],
	},
	scenes: {},
	ui: {
		activeSceneId: null,
		focusedNodeId: null,
		activeNodeId: "node-video-1",
		canvasSnapEnabled: true,
		camera: {
			x: 0,
			y: 0,
			zoom: 1,
		},
	},
	createdAt: 1,
	updatedAt: 1,
});

const createVideoThumbnailCapability =
	(): CanvasNodeThumbnailCapability<VideoCanvasNode> => {
		return {
			getSourceSignature: ({ node, asset }) => {
				return `${node.assetId}:${typeof asset?.meta?.hash === "string" ? asset.meta.hash : ""}`;
			},
			generate: vi.fn(async ({ node, asset }) => {
				return {
					blob: new Blob([`thumb-${node.id}`], { type: "image/webp" }),
					sourceSignature: `${node.assetId}:${typeof asset?.meta?.hash === "string" ? asset.meta.hash : ""}`,
					frame: 0,
					sourceSize: {
						width: 1920,
						height: 1080,
					},
				};
			}),
		};
	};

const createSceneProject = (options?: {
	sceneUpdatedAt?: number;
	thumbnailSourceSignature?: string;
}): StudioProject => ({
	id: "project-scene-1",
	revision: 0,
	assets: [
		{
			id: "asset-thumb-1",
			kind: "image",
			name: "thumb.webp",
			locator: {
				type: "managed",
				fileName: ".thumbs/node-scene-1.webp",
			},
			meta: {
				hash: "thumb-hash",
			},
		},
	],
	canvas: {
		nodes: [
			{
				id: "node-scene-1",
				type: "scene",
				sceneId: "scene-1",
				name: "Scene 1",
				x: 0,
				y: 0,
				width: 1920,
				height: 1080,
				siblingOrder: 0,
				locked: false,
				hidden: false,
				createdAt: 1,
				updatedAt: 1,
				thumbnail: {
					assetId: "asset-thumb-1",
					sourceSignature:
						options?.thumbnailSourceSignature ?? "scene-1:1",
					frame: 0,
					generatedAt: 1,
					version: 1,
				},
			} satisfies SceneCanvasNode,
		],
	},
	scenes: {
		"scene-1": {
			id: "scene-1",
			name: "Scene 1",
			timeline: {
				version: "3",
				fps: 30,
				canvas: {
					width: 1920,
					height: 1080,
				},
				elements: [],
				tracks: [],
			},
			posterFrame: 0,
			createdAt: 1,
			updatedAt: options?.sceneUpdatedAt ?? 2,
		},
	},
	ui: {
		activeSceneId: "scene-1",
		focusedNodeId: null,
		activeNodeId: "node-scene-1",
		canvasSnapEnabled: true,
		camera: {
			x: 0,
			y: 0,
			zoom: 1,
		},
	},
	createdAt: 1,
	updatedAt: 1,
});

const createImageProject = (): StudioProject => ({
	id: "project-image-1",
	revision: 0,
	assets: [
		{
			id: "asset-image-1",
			kind: "image",
			name: "image.png",
			locator: {
				type: "managed",
				fileName: "image.png",
			},
		},
		{
			id: "asset-thumb-legacy",
			kind: "image",
			name: "legacy-thumb.webp",
			locator: {
				type: "managed",
				fileName: ".thumbs/node-image-1.webp",
			},
		},
	],
	canvas: {
		nodes: [
			{
				id: "node-image-1",
				type: "image",
				assetId: "asset-image-1",
				name: "Image 1",
				x: 0,
				y: 0,
				width: 1280,
				height: 720,
				siblingOrder: 0,
				locked: false,
				hidden: false,
				createdAt: 1,
				updatedAt: 1,
				thumbnail: {
					assetId: "asset-thumb-legacy",
					sourceSignature: "legacy-image-thumb",
					frame: 0,
					generatedAt: 1,
					version: 1,
				},
			} satisfies ImageCanvasNode,
		],
	},
	scenes: {},
	ui: {
		activeSceneId: null,
		focusedNodeId: null,
		activeNodeId: "node-image-1",
		canvasSnapEnabled: true,
		camera: {
			x: 0,
			y: 0,
			zoom: 1,
		},
	},
	createdAt: 1,
	updatedAt: 1,
});

const HookHarness = ({
	project,
	projectId,
}: {
	project: StudioProject | null;
	projectId: string | null;
}) => {
	useNodeThumbnailGeneration({
		project,
		projectId,
		runtimeManager: null,
	});
	return null;
};

describe("useNodeThumbnailGeneration", () => {
	beforeEach(() => {
		getCanvasNodeDefinitionMock.mockReset();
		vi.mocked(writeProjectFileToOpfsAtPath).mockReset();
		vi.stubGlobal(
			"requestIdleCallback",
			(callback: (deadline: IdleDeadline) => void) =>
				window.setTimeout(
					() =>
						callback({
							didTimeout: false,
							timeRemaining: () => 12,
						}),
					0,
				),
		);
		vi.stubGlobal("cancelIdleCallback", (id: number) => {
			window.clearTimeout(id);
		});
	});

	afterEach(() => {
		cleanup();
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("同签名生成任务在进行中会去重", async () => {
		type PendingResult = {
			blob: Blob;
			sourceSignature: string;
			frame: number;
			sourceSize: { width: number; height: number };
		};
		type PendingResolver = (value: PendingResult) => void;
		let resolveGenerate: PendingResolver | undefined;
		const pending = new Promise<{
			blob: Blob;
			sourceSignature: string;
			frame: number;
			sourceSize: { width: number; height: number };
		}>((resolve) => {
			resolveGenerate = resolve as PendingResolver;
		});
		const capability = createVideoThumbnailCapability();
		const generateMock = vi
			.spyOn(capability, "generate")
			.mockImplementation(() => pending);
		getCanvasNodeDefinitionMock.mockReturnValue({
			thumbnail: capability,
		});
		vi.mocked(writeProjectFileToOpfsAtPath).mockResolvedValue({
			uri: "opfs://projects/project-1/images/.thumbs/node-node-video-1.webp",
			fileName: ".thumbs/node-node-video-1.webp",
			hash: "thumb-hash-1",
		});
		useProjectStore.setState((state) => ({
			...state,
			currentProjectId: "project-1",
			currentProject: createProject("hash-a"),
		}));

		const { rerender } = render(
			<HookHarness
				project={useProjectStore.getState().currentProject}
				projectId={useProjectStore.getState().currentProjectId}
			/>,
		);
		await waitFor(() => {
			expect(generateMock).toHaveBeenCalledTimes(1);
		});
		act(() => {
			useProjectStore.getState().setActiveNode(null);
		});
		rerender(
			<HookHarness
				project={useProjectStore.getState().currentProject}
				projectId={useProjectStore.getState().currentProjectId}
			/>,
		);
		await new Promise((resolve) => window.setTimeout(resolve, 30));
		expect(generateMock).toHaveBeenCalledTimes(1);
		const finalizeGenerate = resolveGenerate;
		if (!finalizeGenerate) {
			throw new Error("resolveGenerate is not ready");
		}
		finalizeGenerate({
			blob: new Blob(["thumb-node-video-1"], { type: "image/webp" }),
			sourceSignature: "asset-video-1:hash-a",
			frame: 0,
			sourceSize: {
				width: 1920,
				height: 1080,
			},
		});
		await waitFor(() => {
			const project = useProjectStore.getState().currentProject;
			const node = project?.canvas.nodes.find(
				(item) => item.id === "node-video-1",
			);
			expect(node?.thumbnail?.sourceSignature).toBe("asset-video-1:hash-a");
		});
	});

	it("scene 节点同签名时会复用已有 thumb，不会后台重生", async () => {
		const capability: CanvasNodeThumbnailCapability<SceneCanvasNode> = {
			getSourceSignature: vi.fn(() => "scene-1:2"),
			generate: vi.fn(async () => {
				return {
					blob: new Blob(["thumb-scene-1"], { type: "image/webp" }),
					sourceSignature: "scene-1:2",
					frame: 0,
					sourceSize: {
						width: 1920,
						height: 1080,
					},
				};
			}),
		};
		getCanvasNodeDefinitionMock.mockReturnValue({
			thumbnail: capability,
		});
		useProjectStore.setState((state) => ({
			...state,
			currentProjectId: "project-scene-1",
			currentProject: createSceneProject({
				sceneUpdatedAt: 2,
				thumbnailSourceSignature: "scene-1:2",
			}),
		}));

		render(
			<HookHarness
				project={useProjectStore.getState().currentProject}
				projectId={useProjectStore.getState().currentProjectId}
			/>,
		);

		await new Promise((resolve) => window.setTimeout(resolve, 30));
		expect(getCanvasNodeDefinitionMock).toHaveBeenCalledWith("scene");
		expect(capability.getSourceSignature).toHaveBeenCalled();
		expect(capability.generate).not.toHaveBeenCalled();
		expect(writeProjectFileToOpfsAtPath).not.toHaveBeenCalled();
	});

	it("scene 节点内容变化后会触发 thumb 重生", async () => {
		const capability: CanvasNodeThumbnailCapability<SceneCanvasNode> = {
			getSourceSignature: vi.fn(() => "scene-1:2"),
			generate: vi.fn(async () => {
				return {
					blob: new Blob(["thumb-scene-1-next"], { type: "image/webp" }),
					sourceSignature: "scene-1:2",
					frame: 0,
					sourceSize: {
						width: 1920,
						height: 1080,
					},
				};
			}),
		};
		getCanvasNodeDefinitionMock.mockReturnValue({
			thumbnail: capability,
		});
		vi.mocked(writeProjectFileToOpfsAtPath).mockResolvedValue({
			uri: "opfs://projects/project-scene-1/images/.thumbs/node-node-scene-1.webp",
			fileName: ".thumbs/node-node-scene-1.webp",
			hash: "thumb-hash-2",
		});
		useProjectStore.setState((state) => ({
			...state,
			currentProjectId: "project-scene-1",
			currentProject: createSceneProject({
				sceneUpdatedAt: 2,
				thumbnailSourceSignature: "scene-1:1",
			}),
		}));

		render(
			<HookHarness
				project={useProjectStore.getState().currentProject}
				projectId={useProjectStore.getState().currentProjectId}
			/>,
		);

		await waitFor(() => {
			expect(capability.generate).toHaveBeenCalledTimes(1);
		});
		await waitFor(() => {
			const project = useProjectStore.getState().currentProject;
			const node = project?.canvas.nodes.find(
				(item) => item.id === "node-scene-1",
			);
			expect(node?.thumbnail?.sourceSignature).toBe("scene-1:2");
		});
		expect(writeProjectFileToOpfsAtPath).toHaveBeenCalledTimes(1);
	});

	it("无 thumbnail capability 的 image 节点不会入队生成", async () => {
		getCanvasNodeDefinitionMock.mockReturnValue({
			thumbnail: undefined,
		});
		useProjectStore.setState((state) => ({
			...state,
			currentProjectId: "project-image-1",
			currentProject: createImageProject(),
		}));

		render(
			<HookHarness
				project={useProjectStore.getState().currentProject}
				projectId={useProjectStore.getState().currentProjectId}
			/>,
		);

		await new Promise((resolve) => window.setTimeout(resolve, 30));
		expect(getCanvasNodeDefinitionMock).toHaveBeenCalledWith("image");
		expect(writeProjectFileToOpfsAtPath).not.toHaveBeenCalled();
	});
});
