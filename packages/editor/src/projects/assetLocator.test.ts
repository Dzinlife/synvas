import type { TimelineAsset } from "core/element/types";
import { describe, expect, it } from "vitest";
import {
	resolveAssetLocatorFromUri,
	resolveAssetPlayableUri,
} from "./assetLocator";

const createAsset = (
	partial: Partial<TimelineAsset> & Pick<TimelineAsset, "kind" | "locator">,
): TimelineAsset => {
	return {
		id: partial.id ?? "asset-1",
		kind: partial.kind,
		name: partial.name ?? "asset",
		locator: partial.locator,
		meta: partial.meta,
	};
};

describe("assetLocator", () => {
	it("linked-file 在 Electron 环境解析为 file://", () => {
		const asset = createAsset({
			kind: "video",
			locator: {
				type: "linked-file",
				filePath: "/tmp/video 1.mp4",
			},
		});
		expect(
			resolveAssetPlayableUri(asset, {
				environment: "electron",
			}),
		).toBe("file:///tmp/video%201.mp4");
	});

	it("linked-file 在 Browser 环境返回 null", () => {
		const asset = createAsset({
			kind: "video",
			locator: {
				type: "linked-file",
				filePath: "/tmp/video.mp4",
			},
		});
		expect(
			resolveAssetPlayableUri(asset, {
				environment: "browser",
			}),
		).toBeNull();
	});

	it("linked-remote 直接返回远程地址", () => {
		const asset = createAsset({
			kind: "audio",
			locator: {
				type: "linked-remote",
				uri: "https://example.com/audio.mp3",
			},
		});
		expect(
			resolveAssetPlayableUri(asset, {
				environment: "browser",
			}),
		).toBe("https://example.com/audio.mp3");
	});

	it("managed 使用 projectId 解析为 OPFS 路径", () => {
		const asset = createAsset({
			kind: "image",
			locator: {
				type: "managed",
				fileName: "photo.png",
			},
		});
		expect(
			resolveAssetPlayableUri(asset, {
				projectId: "project-1",
				environment: "browser",
			}),
		).toBe("opfs://projects/project-1/images/photo.png");
	});

	it("从 uri 推断 locator", () => {
		expect(resolveAssetLocatorFromUri("file:///tmp/a.mp4")).toEqual({
			type: "linked-file",
			filePath: "/tmp/a.mp4",
		});
		expect(
			resolveAssetLocatorFromUri(
				"opfs://projects/project-1/videos/clip.mp4",
				"video",
			),
		).toEqual({
			type: "managed",
			fileName: "clip.mp4",
		});
		expect(resolveAssetLocatorFromUri("https://example.com/a.mp4")).toEqual({
			type: "linked-remote",
			uri: "https://example.com/a.mp4",
		});
	});
});
