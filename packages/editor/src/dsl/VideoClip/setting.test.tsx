// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TimelineElement } from "core/dsl/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransformMeta } from "@/dsl/transform";
import type { VideoClipProps } from "./model";
import { VideoClipSetting } from "./setting";

const createVideoClipElement = (
	props: Partial<VideoClipProps> = {},
): TimelineElement<VideoClipProps> => {
	return {
		id: "video-1",
		type: "VideoClip",
		component: "video-clip",
		name: "Video Clip",
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
			uri: "/intro.mp4",
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
	it("仅在 blur 时提交 uri", () => {
		const updateProps = vi.fn();
		render(
			<VideoClipSetting
				element={createVideoClipElement({ uri: "/origin.mp4" })}
				updateProps={updateProps}
			/>,
		);

		const sourceInput = screen.getByLabelText("Source URI") as HTMLInputElement;
		fireEvent.change(sourceInput, { target: { value: "/updated.mp4" } });
		expect(updateProps).not.toHaveBeenCalled();

		fireEvent.blur(sourceInput);
		expect(updateProps).toHaveBeenCalledWith({ uri: "/updated.mp4" });
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
