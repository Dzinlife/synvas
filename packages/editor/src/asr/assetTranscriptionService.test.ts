// @vitest-environment jsdom
import type { TimelineAsset } from "core/element/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AsrClient } from "./AsrContext";
import type { TranscriptSegment } from "./types";
import { transcribeAssetById } from "./assetTranscriptionService";

vi.mock("./assetMediaFile", () => ({
	resolveAssetMediaFile: vi.fn(),
}));

vi.mock("./opfsAudio", () => ({
	readAudioMetadata: vi.fn(),
}));

vi.mock("@/scene-editor/utils/externalVideo", () => ({
	readVideoMetadata: vi.fn(),
}));

import { readVideoMetadata } from "@/scene-editor/utils/externalVideo";
import { readAudioMetadata } from "./opfsAudio";
import { resolveAssetMediaFile } from "./assetMediaFile";

const mockedResolveAssetMediaFile = vi.mocked(resolveAssetMediaFile);
const mockedReadAudioMetadata = vi.mocked(readAudioMetadata);
const mockedReadVideoMetadata = vi.mocked(readVideoMetadata);
const projectAssetsState = {
	assets: [] as TimelineAsset[],
};

const getProjectAssetById = (assetId: string): TimelineAsset | null => {
	return projectAssetsState.assets.find((asset) => asset.id === assetId) ?? null;
};

const updateProjectAssetMeta = (
	assetId: string,
	updater: (
		prevMeta: TimelineAsset["meta"] | undefined,
	) => TimelineAsset["meta"] | undefined,
) => {
	projectAssetsState.assets = projectAssetsState.assets.map((asset) => {
		if (asset.id !== assetId) return asset;
		return {
			...asset,
			meta: updater(asset.meta),
		};
	});
};

afterEach(() => {
	projectAssetsState.assets = [];
	mockedResolveAssetMediaFile.mockReset();
	mockedReadAudioMetadata.mockReset();
	mockedReadVideoMetadata.mockReset();
});

const createSegment = (id: string, text: string): TranscriptSegment => ({
	id,
	start: 0,
	end: 1,
	text,
	words: [
		{
			text,
			start: 0,
			end: 1,
		},
	],
});

const createSource = (options?: {
	withAsr?: boolean;
}): TimelineAsset => ({
	id: "source-1",
	kind: "video",
	name: "clip.mp4",
	locator: {
		type: "linked-remote",
		uri: "https://example.com/clip.mp4",
	},
	meta: {
		fileName: "clip.mp4",
	},
	...(options?.withAsr
		? {
				meta: {
					fileName: "clip.mp4",
					asr: {
						id: "old-asr",
						source: {
							type: "asset" as const,
							assetId: "source-1",
							kind: "video" as const,
							uri: "https://example.com/clip.mp4",
							fileName: "clip.mp4",
							duration: 2,
						},
						language: "auto",
						model: "tiny",
						createdAt: 1,
						updatedAt: 1,
						segments: [createSegment("old-seg", "旧内容")],
					},
				},
			}
		: {}),
});

describe("assetTranscriptionService", () => {
	it("普通转写应增量写入 asset.meta.asr", async () => {
		const file = new File([new Uint8Array([1, 2, 3])], "clip.mp4", {
			type: "video/mp4",
		});
		mockedResolveAssetMediaFile.mockResolvedValue({
			file,
			fileName: "clip.mp4",
		});
		mockedReadVideoMetadata.mockResolvedValue({
			duration: 3,
			width: 1920,
			height: 1080,
		});
		projectAssetsState.assets = [createSource()];

		const asrClient: AsrClient = {
			ensureReady: vi.fn(async () => {}),
			transcribeAudioFile: vi.fn(async (options) => {
				const segment = createSegment("seg-1", "你好");
				options.onChunk(segment);
				return {
					segments: [segment],
				};
			}),
		};
		const controller = new AbortController();
		const result = await transcribeAssetById({
			assetId: "source-1",
			projectId: "project-1",
			asrClient,
			signal: controller.signal,
			language: "zh",
			getProjectAssetById,
			updateProjectAssetMeta,
		});
		expect(result.status).toBe("done");
		expect(result.changed).toBe(true);
		const asr = getProjectAssetById("source-1")?.meta?.asr;
		expect(asr?.segments).toHaveLength(1);
		expect(asr?.segments[0]?.text).toBe("你好");
	});

	it("强制转写在首 chunk 前取消时不覆盖旧数据", async () => {
		const file = new File([new Uint8Array([1, 2, 3])], "clip.mp4", {
			type: "video/mp4",
		});
		mockedResolveAssetMediaFile.mockResolvedValue({
			file,
			fileName: "clip.mp4",
		});
		mockedReadVideoMetadata.mockResolvedValue({
			duration: 3,
			width: 1920,
			height: 1080,
		});
		projectAssetsState.assets = [createSource({ withAsr: true })];

		const asrClient: AsrClient = {
			ensureReady: vi.fn(async ({ signal }) => {
				if (signal.aborted) {
					throw new DOMException("已取消", "AbortError");
				}
			}),
			transcribeAudioFile: vi.fn(async () => ({
				segments: [],
			})),
		};
		const controller = new AbortController();
		controller.abort();
		const result = await transcribeAssetById({
			assetId: "source-1",
			projectId: "project-1",
			asrClient,
			signal: controller.signal,
			language: "zh",
			force: true,
			getProjectAssetById,
			updateProjectAssetMeta,
		});
		expect(result.status).toBe("canceled");
		expect(result.changed).toBe(false);
		const asr = getProjectAssetById("source-1")?.meta?.asr;
		expect(asr?.id).toBe("old-asr");
		expect(asr?.segments[0]?.text).toBe("旧内容");
	});

	it("强制转写在首 chunk 到达后应覆盖旧数据", async () => {
		const file = new File([new Uint8Array([1, 2, 3])], "clip.mp4", {
			type: "video/mp4",
		});
		mockedResolveAssetMediaFile.mockResolvedValue({
			file,
			fileName: "clip.mp4",
		});
		mockedReadVideoMetadata.mockResolvedValue({
			duration: 3,
			width: 1920,
			height: 1080,
		});
		projectAssetsState.assets = [createSource({ withAsr: true })];

		const asrClient: AsrClient = {
			ensureReady: vi.fn(async () => {}),
			transcribeAudioFile: vi.fn(async (options) => {
				const segment = createSegment("new-seg", "新内容");
				options.onChunk(segment);
				return {
					segments: [segment],
				};
			}),
		};
		const controller = new AbortController();
		const result = await transcribeAssetById({
			assetId: "source-1",
			projectId: "project-1",
			asrClient,
			signal: controller.signal,
			language: "zh",
			force: true,
			getProjectAssetById,
			updateProjectAssetMeta,
		});
		expect(result.status).toBe("done");
		const asr = getProjectAssetById("source-1")?.meta?.asr;
		expect(asr?.id).not.toBe("old-asr");
		expect(asr?.segments[0]?.text).toBe("新内容");
	});
});
