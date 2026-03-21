// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { TimelineAsset } from "core/element/types";
import type { VideoCanvasNode } from "core/studio/types";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	useVideoNodePlayback: vi.fn(),
	pause: vi.fn(),
}));

vi.mock("./useVideoNodePlayback", () => ({
	useVideoNodePlayback: mocks.useVideoNodePlayback,
}));

vi.mock("react-skia-lite", () => ({
	Rect: ({
		children,
		...props
	}: {
		children?: React.ReactNode;
		[key: string]: unknown;
	}) => (
		<div data-testid="rect" data-props={JSON.stringify(props)}>
			{children}
		</div>
	),
	ImageShader: (props: Record<string, unknown>) => (
		<div data-testid="image-shader" data-props={JSON.stringify(props)} />
	),
}));

import { VideoNodeSkiaRenderer } from "./renderer";

const createNode = (): VideoCanvasNode => ({
	id: "video-node-1",
	type: "video",
	assetId: "asset-video-1",
	name: "Video Node",
	x: 0,
	y: 0,
	width: 320,
	height: 180,
	zIndex: 1,
	locked: false,
	hidden: false,
	createdAt: 1,
	updatedAt: 1,
});

const createAsset = (): TimelineAsset => ({
	id: "asset-video-1",
	kind: "video",
	uri: "file:///video.mp4",
	name: "video.mp4",
});

const runtimeManager = {
	getActiveEditTimelineRuntime: () => ({
		timelineStore: {
			getState: () => ({ fps: 30 }),
		},
	}),
} as never;

describe("VideoNodeSkiaRenderer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.pause.mockReset();
	});

	afterEach(() => {
		cleanup();
	});

	it("有帧时渲染 ImageShader", () => {
		mocks.useVideoNodePlayback.mockReturnValue({
			snapshot: {
				isLoading: false,
				isReady: true,
				isPlaying: false,
				currentFrame: { id: "frame-1" },
				currentTime: 1,
				duration: 10,
				errorMessage: null,
			},
			pause: mocks.pause,
		});

		render(
			<VideoNodeSkiaRenderer
				node={createNode()}
				scene={null}
				asset={createAsset()}
				isActive={true}
				isFocused={false}
				isDimmed={false}
				runtimeManager={runtimeManager}
			/>,
		);

		expect(screen.getByTestId("image-shader")).toBeTruthy();
	});

	it("无帧时保留占位矩形", () => {
		mocks.useVideoNodePlayback.mockReturnValue({
			snapshot: {
				isLoading: false,
				isReady: true,
				isPlaying: false,
				currentFrame: null,
				currentTime: 0,
				duration: 10,
				errorMessage: null,
			},
			pause: mocks.pause,
		});

		render(
			<VideoNodeSkiaRenderer
				node={createNode()}
				scene={null}
				asset={createAsset()}
				isActive={true}
				isFocused={false}
				isDimmed={false}
				runtimeManager={runtimeManager}
			/>,
		);

		expect(screen.getByTestId("rect")).toBeTruthy();
		expect(screen.queryByTestId("image-shader")).toBeNull();
	});

	it("切为非 active 时会自动暂停并保留进度", () => {
		mocks.useVideoNodePlayback.mockReturnValue({
			snapshot: {
				isLoading: false,
				isReady: true,
				isPlaying: true,
				currentFrame: { id: "frame-1" },
				currentTime: 3,
				duration: 10,
				errorMessage: null,
			},
			pause: mocks.pause,
		});

		const { rerender } = render(
			<VideoNodeSkiaRenderer
				node={createNode()}
				scene={null}
				asset={createAsset()}
				isActive={true}
				isFocused={false}
				isDimmed={false}
				runtimeManager={runtimeManager}
			/>,
		);

		rerender(
			<VideoNodeSkiaRenderer
				node={createNode()}
				scene={null}
				asset={createAsset()}
				isActive={false}
				isFocused={false}
				isDimmed={false}
				runtimeManager={runtimeManager}
			/>,
		);

		expect(mocks.pause).toHaveBeenCalledTimes(1);
	});
});
