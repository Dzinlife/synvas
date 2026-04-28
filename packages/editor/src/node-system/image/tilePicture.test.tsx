import type { TimelineAsset } from "core/timeline-system/types";
import type { ImageCanvasNode } from "@/studio/project/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { imageNodeTilePictureCapability } from "./tilePicture";

const mocks = vi.hoisted(() => ({
	acquireImageAsset: vi.fn(),
	renderNodeToPicture: vi.fn(),
	renderImageNodeTilePictureContent: vi.fn(),
}));

vi.mock("@/assets/imageAsset", () => ({
	acquireImageAsset: mocks.acquireImageAsset,
}));

vi.mock("core/render-system/renderNodeSnapshot", () => ({
	renderNodeToPicture: mocks.renderNodeToPicture,
}));

vi.mock("./renderer", () => ({
	renderImageNodeTilePictureContent: mocks.renderImageNodeTilePictureContent,
}));

const createNode = (patch: Partial<ImageCanvasNode> = {}): ImageCanvasNode => ({
	id: "image-node-1",
	type: "image",
	name: "Image",
	x: 0,
	y: 0,
	width: 640,
	height: 360,
	siblingOrder: 0,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
	assetId: "asset-image",
	...patch,
});

const createAsset = (uri = "https://example.com/image.png"): TimelineAsset => ({
	id: "asset-image",
	kind: "image",
	name: "image.png",
	locator: {
		type: "linked-remote",
		uri,
	},
});

const createImageHandle = () => {
	const image = {
		id: "sk-image",
		width: () => 1920,
		height: () => 1080,
		dispose: vi.fn(),
	};
	return {
		asset: {
			uri: "https://example.com/image.png",
			image,
			width: 1920,
			height: 1080,
		},
		release: vi.fn(),
	};
};

describe("imageNodeTilePictureCapability", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.renderImageNodeTilePictureContent.mockReturnValue("picture-content");
		mocks.renderNodeToPicture.mockReturnValue({ dispose: vi.fn() });
	});

	it("生成 tile picture 时会持有共享 image asset handle", async () => {
		const handle = createImageHandle();
		mocks.acquireImageAsset.mockResolvedValue(handle);

		const result = await imageNodeTilePictureCapability.generate({
			node: createNode(),
			scene: null,
			asset: createAsset(),
			projectId: "project-1",
			runtimeManager: {} as never,
		});

		expect(mocks.acquireImageAsset).toHaveBeenCalledWith(
			"https://example.com/image.png",
		);
		expect(mocks.renderImageNodeTilePictureContent).toHaveBeenCalledWith(
			expect.any(Object),
			handle.asset.image,
		);
		expect(result?.sourceWidth).toBe(640);
		expect(result?.sourceHeight).toBe(360);

		result?.dispose?.();
		expect(handle.release).toHaveBeenCalledTimes(1);
	});

	it("picture 生成失败时会释放 image asset handle", async () => {
		const handle = createImageHandle();
		mocks.acquireImageAsset.mockResolvedValue(handle);
		mocks.renderNodeToPicture.mockReturnValue(null);

		const result = await imageNodeTilePictureCapability.generate({
			node: createNode(),
			scene: null,
			asset: createAsset(),
			projectId: "project-1",
			runtimeManager: {} as never,
		});

		expect(result).toBeNull();
		expect(handle.release).toHaveBeenCalledTimes(1);
	});

	it("缺少图片内容时会释放 image asset handle", async () => {
		const handle = createImageHandle();
		mocks.acquireImageAsset.mockResolvedValue(handle);
		mocks.renderImageNodeTilePictureContent.mockReturnValue(null);

		const result = await imageNodeTilePictureCapability.generate({
			node: createNode(),
			scene: null,
			asset: createAsset(),
			projectId: "project-1",
			runtimeManager: {} as never,
		});

		expect(result).toBeNull();
		expect(handle.release).toHaveBeenCalledTimes(1);
		expect(mocks.renderNodeToPicture).not.toHaveBeenCalled();
	});
});
