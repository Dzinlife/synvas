// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TimelineAsset } from "core/dsl/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AsrProvider } from "@/asr";
import type { AsrClient } from "@/asr/AsrContext";
import {
	createEditorRuntimeWrapper,
	createTestEditorRuntime,
} from "../runtime/testUtils";
import SmartSpeechCutDialog from "./SmartSpeechCutDialog";

vi.mock("@/asr/assetTranscriptionService", () => ({
	transcribeAssetById: vi.fn(),
}));

import { transcribeAssetById } from "@/asr/assetTranscriptionService";

const mockedTranscribeAssetById = vi.mocked(transcribeAssetById);

const runtime = createTestEditorRuntime("smart-speech-cut-dialog-test");
const timelineStore = runtime.timelineStore;
const wrapper = createEditorRuntimeWrapper(runtime);
const initialState = timelineStore.getState();

afterEach(() => {
	timelineStore.setState(initialState, true);
	mockedTranscribeAssetById.mockReset();
	vi.restoreAllMocks();
});

const asrClient: AsrClient = {
	transcribeAudioFile: vi.fn(async () => ({
		segments: [],
	})),
};

const createSource = (withAsr: boolean): TimelineAsset => ({
	id: "source-1",
	kind: "video",
	uri: "file:///clip.mp4",
	name: "clip.mp4",
	...(withAsr
		? {
				meta: {
					asr: {
						id: "asr-1",
						source: {
							type: "asset" as const,
							assetId: "source-1",
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
				assetId="source-1"
			/>
		</AsrProvider>,
		{ wrapper },
	);
};

describe("SmartSpeechCutDialog", () => {
	it("应根据 asr 数据在转写模式和文本模式间切换", async () => {
		timelineStore.setState({
			assets: [createSource(false)],
		});
		const { rerender } = render(
			<AsrProvider value={asrClient}>
				<SmartSpeechCutDialog
					open
					onOpenChange={() => {}}
					elementId="clip-1"
					assetId="source-1"
				/>
			</AsrProvider>,
			{ wrapper },
		);
		expect(screen.getByText("当前素材尚未转写，可选择语言并开始转写。")).toBeTruthy();
		expect(screen.getByRole("button", { name: "开始转写" })).toBeTruthy();

		timelineStore.setState({
			assets: [createSource(true)],
		});
		rerender(
			<AsrProvider value={asrClient}>
				<SmartSpeechCutDialog
					open
					onOpenChange={() => {}}
					elementId="clip-1"
					assetId="source-1"
				/>
			</AsrProvider>,
		);
		expect(
			screen.getByText("已检测到转写结果，可进入文本剪辑模式或强制重转写。"),
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "强制重新转写" })).toBeTruthy();
	});

	it("点击强制重新转写应以 force=true 调用服务", async () => {
		mockedTranscribeAssetById.mockResolvedValue({
			status: "done",
			changed: true,
			summaryText: "转写完成",
			record: null,
		});
		timelineStore.setState({
			assets: [createSource(true)],
		});
		renderDialog();

		fireEvent.click(screen.getByRole("button", { name: "强制重新转写" }));

		await waitFor(() => {
			expect(mockedTranscribeAssetById).toHaveBeenCalledWith(
				expect.objectContaining({
					assetId: "source-1",
					force: true,
				}),
			);
		});
	});

	it("点击调试按钮应输出当前 asr 数据", () => {
		timelineStore.setState({
			assets: [createSource(true)],
		});
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		renderDialog();

		fireEvent.click(screen.getByRole("button", { name: "调试 ASR" }));

		expect(logSpy).toHaveBeenCalledWith(
			"[SmartSpeechCutDialog][asr]",
			expect.objectContaining({
				elementId: "clip-1",
				assetId: "source-1",
				sourceUri: "file:///clip.mp4",
			}),
		);
	});
});
