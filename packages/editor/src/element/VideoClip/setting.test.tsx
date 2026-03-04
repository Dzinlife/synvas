// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TimelineElement } from "core/element/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransformMeta } from "@/element/transform";
import type { VideoClipProps } from "./model";
import { VideoClipSetting } from "./setting";

vi.mock("@/projects/useProjectAssets", () => ({
	useProjectAssets: () => ({
		getProjectAssetById: (id: string) =>
			id === "source-video-1" ? { id: "source-video-1", uri: "/origin.mp4" } : null,
	}),
}));

const createVideoClipElement = (
	props: Partial<VideoClipProps> = {},
): TimelineElement<VideoClipProps> => {
	return {
		id: "video-1",
		type: "VideoClip",
		component: "video-clip",
		name: "Video Clip",
		assetId: "source-video-1",
		transform: createTransformMeta({
			width: 320,
			height: 180,
			positionX: 160,
			positionY: 90,
		}),
		timeline: {
			start: 0,
			end: 120,
			startTimecode: "00:00:00:00",
			endTimecode: "00:00:04:00",
			trackIndex: 0,
			trackId: "track-1",
			role: "clip",
		},
		render: {
			visible: true,
			opacity: 1,
			zIndex: 0,
		},
		props: {
			reversed: false,
			start: 0,
			end: 90,
			...props,
		},
	};
};

afterEach(() => {
	cleanup();
});

describe("VideoClipSetting", () => {
	it("展示绑定素材信息", () => {
		const updateProps = vi.fn();
		render(
			<VideoClipSetting
				element={createVideoClipElement()}
				updateProps={updateProps}
			/>,
		);

		expect(screen.getByText("/origin.mp4")).toBeTruthy();
		expect(updateProps).not.toHaveBeenCalled();
	});

	it("可以切换到倒放", () => {
		const updateProps = vi.fn();
		render(
			<VideoClipSetting
				element={createVideoClipElement({ reversed: false })}
				updateProps={updateProps}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Reverse" }));
		expect(updateProps).toHaveBeenCalledWith({ reversed: true });
	});
});
