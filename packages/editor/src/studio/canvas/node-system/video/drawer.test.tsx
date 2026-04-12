// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TimelineAsset } from "core/element/types";
import type { VideoCanvasNode } from "core/studio/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	useVideoNodePlayback: vi.fn(),
	togglePlayback: vi.fn(async () => {}),
	seekToTime: vi.fn(async () => {}),
}));

vi.mock("./useVideoNodePlayback", () => ({
	useVideoNodePlayback: mocks.useVideoNodePlayback,
}));

vi.mock("@/projects/projectStore", () => ({
	useProjectStore: (selector: (state: { currentProjectId: string | null }) => unknown) =>
		selector({
			currentProjectId: "project-1",
		}),
}));

vi.mock("@/components/ui/slider", () => ({
	Slider: ({
		value,
		onValueChange,
		min,
		max,
		step,
	}: {
		value?: number[];
		onValueChange?: (next: number[]) => void;
		min?: number;
		max?: number;
		step?: number;
	}) => {
		const current = Array.isArray(value) ? (value[0] ?? 0) : 0;
		return (
			<input
				type="range"
				data-testid="mock-slider"
				min={min ?? 0}
				max={max ?? 100}
				step={step ?? 1}
				value={current}
				onChange={(event) => {
					onValueChange?.([Number(event.currentTarget.value)]);
				}}
			/>
		);
	},
}));

import { VideoNodeDrawer } from "./drawer";

const createNode = (): VideoCanvasNode => ({
	id: "video-node-1",
	type: "video",
	assetId: "asset-video-1",
	name: "Video Node",
	x: 0,
	y: 0,
	width: 320,
	height: 180,
	siblingOrder: 1,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
});

const createAsset = (): TimelineAsset => ({
	id: "asset-video-1",
	kind: "video",
	name: "video.mp4",
	locator: {
		type: "linked-remote",
		uri: "https://example.com/video.mp4",
	},
});

describe("VideoNodeDrawer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.togglePlayback.mockReset();
		mocks.seekToTime.mockReset();
		mocks.useVideoNodePlayback.mockReturnValue({
			snapshot: {
				isLoading: false,
				isReady: true,
				isPlaying: false,
				currentFrame: null,
				currentTime: 3,
				duration: 12,
				errorMessage: null,
			},
			togglePlayback: mocks.togglePlayback,
			seekToTime: mocks.seekToTime,
		});
	});

	afterEach(() => {
		cleanup();
	});

	it("播放/暂停按钮会触发 togglePlayback", () => {
		render(
			<VideoNodeDrawer
				node={createNode()}
				scene={null}
				asset={createAsset()}
				onClose={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "播放视频" }));
		expect(mocks.togglePlayback).toHaveBeenCalledTimes(1);
	});

	it("拖拽进度条会触发实时 seek", () => {
		render(
			<VideoNodeDrawer
				node={createNode()}
				scene={null}
				asset={createAsset()}
				onClose={vi.fn()}
			/>,
		);

		fireEvent.change(screen.getByTestId("mock-slider"), {
			target: { value: "50" },
		});
		expect(mocks.seekToTime).toHaveBeenCalledWith(6);
	});

	it("会显示时间线刻度和当前/总时码", () => {
		render(
			<VideoNodeDrawer
				node={createNode()}
				scene={null}
				asset={createAsset()}
				onClose={vi.fn()}
			/>,
		);

		expect(screen.getByTestId("video-node-timecode").textContent).toContain(
			"00:00:03:00 / 00:00:12:00",
		);
		expect(screen.getAllByTestId("video-node-timeline-tick")).toHaveLength(7);
	});
});
