// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TimelineSource } from "core/dsl/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AsrProvider } from "@/asr";
import type { AsrClient } from "@/asr/AsrContext";
import { useTimelineStore } from "../contexts/TimelineContext";
import SmartSpeechCutDialog from "./SmartSpeechCutDialog";

vi.mock("@/asr/sourceTranscriptionService", () => ({
	transcribeSourceById: vi.fn(),
}));

import { transcribeSourceById } from "@/asr/sourceTranscriptionService";

const mockedTranscribeSourceById = vi.mocked(transcribeSourceById);

const initialState = useTimelineStore.getState();

afterEach(() => {
	useTimelineStore.setState(initialState, true);
	mockedTranscribeSourceById.mockReset();
	vi.restoreAllMocks();
});

const asrClient: AsrClient = {
	transcribeAudioFile: vi.fn(async () => ({
		segments: [],
	})),
};

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
							duration: 3,
						},
						language: "auto",
						model: "tiny",
						createdAt: 1,
						updatedAt: 1,
						segments: [
							{
								id: "seg-1",
								start: 0,
								end: 1,
								text: "你好",
								words: [
									{
										id: "word-1",
										text: "你好",
										start: 0,
										end: 1,
									},
								],
							},
						],
					},
				},
			}
		: {}),
});

const renderDialog = () => {
	return render(
		<AsrProvider value={asrClient}>
			<SmartSpeechCutDialog
				open
				onOpenChange={() => {}}
				elementId="clip-1"
				sourceId="source-1"
			/>
		</AsrProvider>,
	);
};

describe("SmartSpeechCutDialog", () => {
	it("应根据 asr 数据在转写模式和文本模式间切换", async () => {
		useTimelineStore.setState({
			sources: [createSource(false)],
		});
		const { rerender } = render(
			<AsrProvider value={asrClient}>
				<SmartSpeechCutDialog
					open
					onOpenChange={() => {}}
					elementId="clip-1"
					sourceId="source-1"
				/>
			</AsrProvider>,
		);
		expect(screen.getByText("当前素材尚未转写，可选择语言并开始转写。")).toBeTruthy();
		expect(screen.getByRole("button", { name: "开始转写" })).toBeTruthy();

		useTimelineStore.setState({
			sources: [createSource(true)],
		});
		rerender(
			<AsrProvider value={asrClient}>
				<SmartSpeechCutDialog
					open
					onOpenChange={() => {}}
					elementId="clip-1"
					sourceId="source-1"
				/>
			</AsrProvider>,
		);
		expect(
			screen.getByText("已检测到转写结果，可进入文本剪辑模式或强制重转写。"),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "强制重新转写" })).toBeTruthy();
	});

	it("点击强制重新转写应以 force=true 调用服务", async () => {
		mockedTranscribeSourceById.mockResolvedValue({
			status: "done",
			changed: true,
			summaryText: "转写完成",
			record: null,
		});
		useTimelineStore.setState({
			sources: [createSource(true)],
		});
		renderDialog();

		fireEvent.click(screen.getByRole("button", { name: "强制重新转写" }));

		await waitFor(() => {
			expect(mockedTranscribeSourceById).toHaveBeenCalledWith(
				expect.objectContaining({
					sourceId: "source-1",
					force: true,
				}),
			);
		});
	});

	it("点击调试按钮应输出当前 asr 数据", () => {
		useTimelineStore.setState({
			sources: [createSource(true)],
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		renderDialog();

		fireEvent.click(screen.getByRole("button", { name: "调试 ASR" }));

		expect(logSpy).toHaveBeenCalledWith(
			"[SmartSpeechCutDialog][asr]",
			expect.objectContaining({
				elementId: "clip-1",
				sourceId: "source-1",
				sourceUri: "file:///clip.mp4",
			}),
		);
	});
});
