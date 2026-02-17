import type { TimelineElement, TimelineSource } from "core/dsl/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AsrClient } from "@/asr";
import { transcribeSourceById } from "@/asr";
import { useTimelineStore } from "../contexts/TimelineContext";
import { createTimelineStoreAgentCliHost } from "./createTimelineStoreAgentCliHost";

vi.mock("@/asr", async () => {
	const actual = await vi.importActual<typeof import("@/asr")>("@/asr");
	return {
		...actual,
		transcribeSourceById: vi.fn(),
	};
});

const mockedTranscribeSourceById = vi.mocked(transcribeSourceById);

const initialState = useTimelineStore.getState();

afterEach(() => {
	useTimelineStore.setState(initialState, true);
	mockedTranscribeSourceById.mockReset();
});

const createClip = (type: "VideoClip" | "AudioClip" | "Image"): TimelineElement => ({
	id: "clip-1",
	type,
	component: type === "Image" ? "image" : type === "AudioClip" ? "audio-clip" : "video-clip",
	name: "clip-1",
	sourceId: "source-1",
	timeline: {
		start: 0,
		end: 30,
		startTimecode: "00:00:00:00",
		endTimecode: "00:00:01:00",
		trackIndex: type === "AudioClip" ? -1 : 0,
		trackId: "main-track",
	},
	props: {},
});

const createSource = (withAsr: boolean): TimelineSource => ({
	id: "source-1",
	kind: "video",
	uri: "file:///clip.mp4",
	name: "clip.mp4",
	...(withAsr
		? {
				data: {
					asr: {
						id: "asr-1",
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
						segments: [],
					},
				},
			}
		: {}),
});

const createSourceWithUri = (uri: string): TimelineSource => ({
	id: "source-1",
	kind: "video",
	uri,
	name: "clip.mp4",
});

describe("createTimelineStoreAgentCliHost.transcribe", () => {
	it("force=false 且已有 asr 时应跳过", async () => {
		useTimelineStore.setState({
			elements: [createClip("VideoClip")],
			sources: [createSource(true)],
		});
		const host = createTimelineStoreAgentCliHost({
			asrClient: {} as AsrClient,
		});
		const result = await host.executeRuntimeCommand?.({
			id: "timeline.element.transcribe",
			args: { id: "clip-1" },
			raw: "timeline.element.transcribe --id clip-1",
		});
		expect(result?.ok).toBe(true);
		expect(result?.changed).toBe(false);
		expect(result?.summaryText).toContain("已跳过");
		expect(mockedTranscribeSourceById).not.toHaveBeenCalled();
	});

	it("force=true 时应执行转写服务", async () => {
		mockedTranscribeSourceById.mockResolvedValue({
			status: "done",
			changed: true,
			summaryText: "转写完成",
			record: null,
		});
		useTimelineStore.setState({
			elements: [createClip("VideoClip")],
			sources: [createSource(true)],
		});
		const host = createTimelineStoreAgentCliHost({
			asrClient: {} as AsrClient,
		});
		const result = await host.executeRuntimeCommand?.({
			id: "timeline.element.transcribe",
			args: { id: "clip-1", force: true, language: "zh" },
			raw: "timeline.element.transcribe --id clip-1 --force true --language zh",
		});
		expect(mockedTranscribeSourceById).toHaveBeenCalledWith(
			expect.objectContaining({
				sourceId: "source-1",
				language: "zh",
				force: true,
			}),
		);
		expect(result?.ok).toBe(true);
		expect(result?.changed).toBe(true);
	});

	it("非法目标元素类型应报错", async () => {
		useTimelineStore.setState({
			elements: [createClip("Image")],
			sources: [createSource(false)],
		});
		const host = createTimelineStoreAgentCliHost({
			asrClient: {} as AsrClient,
		});
		const result = await host.executeRuntimeCommand?.({
			id: "timeline.element.transcribe",
			args: { id: "clip-1" },
			raw: "timeline.element.transcribe --id clip-1",
		});
		expect(result?.ok).toBe(false);
		expect(result?.error).toContain("不是可转写片段");
	});

	it("不支持的 source URI 应报错", async () => {
		useTimelineStore.setState({
			elements: [createClip("VideoClip")],
			sources: [createSourceWithUri("data:text/plain,hello")],
		});
		const host = createTimelineStoreAgentCliHost({
			asrClient: {} as AsrClient,
		});
		const result = await host.executeRuntimeCommand?.({
			id: "timeline.element.transcribe",
			args: { id: "clip-1", force: true },
			raw: "timeline.element.transcribe --id clip-1 --force true",
		});
		expect(result?.ok).toBe(false);
		expect(result?.error).toContain("URI 不支持转写");
	});
});
