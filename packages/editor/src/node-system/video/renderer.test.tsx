// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { TimelineAsset } from "core/timeline-system/types";
import type { VideoCanvasNode } from "@/studio/project/types";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	useVideoNodePlayback: vi.fn(),
	useCanvasNodeThumbnailImage: vi.fn(),
}));

vi.mock("./useVideoNodePlayback", () => ({
	useVideoNodePlayback: mocks.useVideoNodePlayback,
}));

vi.mock("../thumbnail/useCanvasNodeThumbnailImage", () => ({
	useCanvasNodeThumbnailImage: mocks.useCanvasNodeThumbnailImage,
}));

vi.mock("@/projects/projectStore", () => ({
	useProjectStore: (
		selector: (state: {
			currentProjectId: string | null;
			currentProject: unknown;
		}) => unknown,
	) =>
		selector({
			currentProjectId: "project-1",
			currentProject: null,
		}),
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
		Object.defineProperty(window, "matchMedia", {
			configurable: true,
			value: vi.fn((query: string) => ({
				matches: query === "(color-gamut: p3)",
				media: query,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
			})),
		});
		mocks.useCanvasNodeThumbnailImage.mockReturnValue(null);
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
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
		});

		render(
			<VideoNodeSkiaRenderer
				node={createNode()}
				scene={null}
				asset={createAsset()}
				isActive={true}
				isFocused={false}
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
		});

		render(
			<VideoNodeSkiaRenderer
				node={createNode()}
				scene={null}
				asset={createAsset()}
				isActive={true}
				isFocused={false}
				runtimeManager={runtimeManager}
			/>,
		);

		expect(screen.getByTestId("rect")).toBeTruthy();
		expect(screen.queryByTestId("image-shader")).toBeNull();
	});

	it("无实时帧时回退 thumbnail 画面", () => {
		mocks.useVideoNodePlayback.mockReturnValue({
			snapshot: {
				isLoading: false,
				isReady: true,
				isPlaying: true,
				currentFrame: null,
				currentTime: 0,
				duration: 10,
				errorMessage: null,
			},
		});
		mocks.useCanvasNodeThumbnailImage.mockReturnValue({ id: "thumb-1" });

		render(
			<VideoNodeSkiaRenderer
				node={createNode()}
				scene={null}
				asset={createAsset()}
				isActive={true}
				isFocused={false}
				runtimeManager={runtimeManager}
			/>,
		);

		expect(screen.getByTestId("image-shader")).toBeTruthy();
	});

	it("实时帧优先于 thumbnail", () => {
		mocks.useVideoNodePlayback.mockReturnValue({
			snapshot: {
				isLoading: false,
				isReady: true,
				isPlaying: false,
				currentFrame: { id: "frame-1" },
				currentTime: 2,
				duration: 10,
				errorMessage: null,
			},
		});
		mocks.useCanvasNodeThumbnailImage.mockReturnValue({ id: "thumb-1" });

		render(
			<VideoNodeSkiaRenderer
				node={createNode()}
				scene={null}
				asset={createAsset()}
				isActive={true}
				isFocused={false}
				runtimeManager={runtimeManager}
			/>,
		);

		const shader = screen.getByTestId("image-shader");
		expect(shader).toBeTruthy();
		const props = JSON.parse(shader.getAttribute("data-props") ?? "{}") as {
			image?: { id?: string };
		};
		expect(props.image?.id).toBe("frame-1");
	});

	it("切换为 inactive 时会透传 active=false 到播放 hook", () => {
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
		});

		const { rerender } = render(
			<VideoNodeSkiaRenderer
				node={createNode()}
				scene={null}
				asset={createAsset()}
				isActive={true}
				isFocused={false}
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
				runtimeManager={runtimeManager}
			/>,
		);

		const lastCall =
			mocks.useVideoNodePlayback.mock.calls[
				mocks.useVideoNodePlayback.mock.calls.length - 1
			]?.[0] ?? null;
		expect(lastCall).toMatchObject({
			nodeId: "video-node-1",
			assetId: "asset-video-1",
			targetColorSpace: "display-p3",
			active: false,
		});
	});
});
