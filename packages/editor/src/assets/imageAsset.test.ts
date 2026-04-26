// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	acquireImageAsset,
	disposeImageAsset,
	loadUncachedImageAsset,
} from "./imageAsset";

const mocks = vi.hoisted(() => ({
	resolveProjectOpfsFile: vi.fn(),
	dataFromBytes: vi.fn(),
	makeImageFromEncoded: vi.fn(),
}));

vi.mock("@/lib/projectOpfsStorage", () => ({
	resolveProjectOpfsFile: mocks.resolveProjectOpfsFile,
}));

vi.mock("react-skia-lite", () => ({
	Skia: {
		Data: {
			fromBytes: mocks.dataFromBytes,
		},
		Image: {
			MakeImageFromEncoded: mocks.makeImageFromEncoded,
		},
	},
}));

const createMockImage = (id: string) => {
	return {
		id,
		width: () => 1920,
		height: () => 1080,
		dispose: vi.fn(),
	};
};

describe("imageAsset", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.dataFromBytes.mockImplementation((bytes: Uint8Array) => bytes);
		delete (window as Window & { synvasElectron?: unknown }).synvasElectron;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		delete (window as Window & { synvasElectron?: unknown }).synvasElectron;
	});

	it("同 URI 会复用缓存并在最后一个 release 时释放图片", async () => {
		const mockImage = createMockImage("cached-image");
		mocks.makeImageFromEncoded.mockReturnValue(mockImage);
		const fetchMock = vi.fn(async () => ({
			ok: true,
			arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
		}));
		vi.stubGlobal("fetch", fetchMock);

		const handleA = await acquireImageAsset("https://example.com/shared.png");
		const handleB = await acquireImageAsset("https://example.com/shared.png");

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(handleA.asset).toBe(handleB.asset);
		expect(handleA.asset.width).toBe(1920);
		expect(handleA.asset.height).toBe(1080);

		handleA.release();
		expect(mockImage.dispose).not.toHaveBeenCalled();
		handleB.release();
		expect(mockImage.dispose).toHaveBeenCalledTimes(1);
	});

	it("uncached 加载不会复用 asset store", async () => {
		const imageA = createMockImage("uncached-a");
		const imageB = createMockImage("uncached-b");
		mocks.makeImageFromEncoded
			.mockReturnValueOnce(imageA)
			.mockReturnValueOnce(imageB);
		const fetchMock = vi.fn(async () => ({
			ok: true,
			arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
		}));
		vi.stubGlobal("fetch", fetchMock);

		const assetA = await loadUncachedImageAsset("https://example.com/raw.png");
		const assetB = await loadUncachedImageAsset("https://example.com/raw.png");

		expect(fetchMock).toHaveBeenCalledTimes(2);
		expect(assetA).not.toBe(assetB);
		expect(assetA.image).toBe(imageA);
		expect(assetB.image).toBe(imageB);

		disposeImageAsset(assetA);
		disposeImageAsset(assetB);
		expect(imageA.dispose).toHaveBeenCalledTimes(1);
		expect(imageB.dispose).toHaveBeenCalledTimes(1);
	});

	it("支持 opfs:// 分支读取", async () => {
		const mockImage = createMockImage("opfs-image");
		mocks.makeImageFromEncoded.mockReturnValue(mockImage);
		mocks.resolveProjectOpfsFile.mockResolvedValue({
			arrayBuffer: async () => new Uint8Array([7, 8, 9]).buffer,
		} as File);
		const fetchMock = vi.fn();
		vi.stubGlobal("fetch", fetchMock);

		const handle = await acquireImageAsset("opfs://synvas/images/asset.png");

		expect(mocks.resolveProjectOpfsFile).toHaveBeenCalledWith(
			"opfs://synvas/images/asset.png",
		);
		expect(fetchMock).not.toHaveBeenCalled();

		handle.release();
		expect(mockImage.dispose).toHaveBeenCalledTimes(1);
	});

	it("支持 file:// 分支读取", async () => {
		const mockImage = createMockImage("file-image");
		mocks.makeImageFromEncoded.mockReturnValue(mockImage);

		const stat = vi.fn(async () => ({ size: 3 }));
		const read = vi.fn(async () => new Uint8Array([1, 2, 3]));
		(
			window as Window & {
				synvasElectron?: {
					file?: {
						stat: typeof stat;
						read: typeof read;
					};
				};
			}
		).synvasElectron = {
			file: {
				stat,
				read,
			},
		};

		const handle = await acquireImageAsset("file:///tmp/image.png");
		expect(stat).toHaveBeenCalledWith("/tmp/image.png");
		expect(read).toHaveBeenCalledWith("/tmp/image.png", 0, 3);

		handle.release();
		expect(mockImage.dispose).toHaveBeenCalledTimes(1);
	});

	it("file:// 在 Electron bridge 缺失时会报错", async () => {
		(window as Window & { synvasElectron?: object }).synvasElectron = {};
		mocks.makeImageFromEncoded.mockReturnValue(createMockImage("unused"));

		await expect(acquireImageAsset("file:///tmp/missing.png")).rejects.toThrow(
			"无法读取本地图片文件",
		);
	});
});
