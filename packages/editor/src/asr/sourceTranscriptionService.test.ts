// @vitest-environment jsdom
import type { TimelineSource } from "core/dsl/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTimelineStore } from "@/editor/contexts/TimelineContext";
import type { AsrClient } from "./AsrContext";
import type { TranscriptSegment } from "./types";
import { transcribeSourceById } from "./sourceTranscriptionService";

vi.mock("./sourceMediaFile", () => ({
	resolveSourceMediaFile: vi.fn(),
}));

vi.mock("./opfsAudio", () => ({
	readAudioMetadata: vi.fn(),
}));

vi.mock("@/editor/utils/externalVideo", () => ({
	readVideoMetadata: vi.fn(),
}));

import { readVideoMetadata } from "@/editor/utils/externalVideo";
import { readAudioMetadata } from "./opfsAudio";
import { resolveSourceMediaFile } from "./sourceMediaFile";

const mockedResolveSourceMediaFile = vi.mocked(resolveSourceMediaFile);
const mockedReadAudioMetadata = vi.mocked(readAudioMetadata);
const mockedReadVideoMetadata = vi.mocked(readVideoMetadata);

const initialState = useTimelineStore.getState();

afterEach(() => {
	useTimelineStore.setState(initialState, true);
	mockedResolveSourceMediaFile.mockReset();
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
			id: `${id}-word`,
			text,
			start: 0,
			end: 1,
		},
	],
});

const createSource = (options?: {
	withAsr?: boolean;
}): TimelineSource => ({
	id: "source-1",
	kind: "video",
	uri: "file:///clip.mp4",
	name: "clip.mp4",
	...(options?.withAsr
		? {
				data: {
					asr: {
						id: "old-asr",
						source: {
							type: "timeline-source" as const,
							sourceId: "source-1",
							kind: "video" as const,
							uri: "file:///clip.mp4",
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

describe("sourceTranscriptionService", () => {
	it("普通转写应增量写入 source.data.asr", async () => {
		const file = new File([new Uint8Array([1, 2, 3])], "clip.mp4", {
			type: "video/mp4",
		});
		mockedResolveSourceMediaFile.mockResolvedValue({
			file,
			fileName: "clip.mp4",
		});
		mockedReadVideoMetadata.mockResolvedValue({
			duration: 3,
			width: 1920,
			height: 1080,
		});
		useTimelineStore.setState({
			sources: [createSource()],
		});

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
		const result = await transcribeSourceById({
			sourceId: "source-1",
			asrClient,
			signal: controller.signal,
			language: "zh",
		});
		expect(result.status).toBe("done");
		expect(result.changed).toBe(true);
		const asr = useTimelineStore.getState().getSourceById("source-1")?.data?.asr;
		expect(asr?.segments).toHaveLength(1);
		expect(asr?.segments[0]?.text).toBe("你好");
	});

	it("强制转写在首 chunk 前取消时不覆盖旧数据", async () => {
		const file = new File([new Uint8Array([1, 2, 3])], "clip.mp4", {
			type: "video/mp4",
		});
		mockedResolveSourceMediaFile.mockResolvedValue({
			file,
			fileName: "clip.mp4",
		});
		mockedReadVideoMetadata.mockResolvedValue({
			duration: 3,
			width: 1920,
			height: 1080,
		});
		useTimelineStore.setState({
			sources: [createSource({ withAsr: true })],
		});

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
		const result = await transcribeSourceById({
			sourceId: "source-1",
			asrClient,
			signal: controller.signal,
			language: "zh",
			force: true,
		});
		expect(result.status).toBe("canceled");
		expect(result.changed).toBe(false);
		const asr = useTimelineStore.getState().getSourceById("source-1")?.data?.asr;
		expect(asr?.id).toBe("old-asr");
		expect(asr?.segments[0]?.text).toBe("旧内容");
	});

	it("强制转写在首 chunk 到达后应覆盖旧数据", async () => {
		const file = new File([new Uint8Array([1, 2, 3])], "clip.mp4", {
			type: "video/mp4",
		});
		mockedResolveSourceMediaFile.mockResolvedValue({
			file,
			fileName: "clip.mp4",
		});
		mockedReadVideoMetadata.mockResolvedValue({
			duration: 3,
			width: 1920,
			height: 1080,
		});
		useTimelineStore.setState({
			sources: [createSource({ withAsr: true })],
		});

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
		const result = await transcribeSourceById({
			sourceId: "source-1",
			asrClient,
			signal: controller.signal,
			language: "zh",
			force: true,
		});
		expect(result.status).toBe("done");
		const asr = useTimelineStore.getState().getSourceById("source-1")?.data?.asr;
		expect(asr?.id).not.toBe("old-asr");
		expect(asr?.segments[0]?.text).toBe("新内容");
	});
});
