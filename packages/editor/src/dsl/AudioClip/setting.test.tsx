// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TimelineElement } from "core/dsl/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransformMeta } from "@/dsl/transform";
import type { AudioClipProps } from "./model";
import { AudioClipSetting } from "./setting";

const createAudioClipElement = (
	props: Partial<AudioClipProps> = {},
): TimelineElement<AudioClipProps> => {
	return {
		id: "audio-1",
		type: "AudioClip",
		component: "audio-clip",
		name: "Audio Clip",
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
			trackIndex: -1,
			trackId: "track-a",
			role: "audio",
		},
		render: {
			visible: true,
			opacity: 1,
			zIndex: 0,
		},
		props: {
			uri: "/voice.mp3",
			reversed: false,
			...props,
		},
	};
};

afterEach(() => {
	cleanup();
});

describe("AudioClipSetting", () => {
	it("仅在 blur 时提交 uri", () => {
		const updateProps = vi.fn();
		render(
			<AudioClipSetting
				element={createAudioClipElement({ uri: "/origin.mp3" })}
				updateProps={updateProps}
			/>,
		);

		const sourceInput = screen.getByLabelText("Source URI") as HTMLInputElement;
		fireEvent.change(sourceInput, { target: { value: "/updated.mp3" } });
		expect(updateProps).not.toHaveBeenCalled();

		fireEvent.blur(sourceInput);
		expect(updateProps).toHaveBeenCalledWith({ uri: "/updated.mp3" });
	});

	it("可以切换到倒放", () => {
		const updateProps = vi.fn();
		render(
			<AudioClipSetting
				element={createAudioClipElement({ reversed: false })}
				updateProps={updateProps}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Reverse" }));
		expect(updateProps).toHaveBeenCalledWith({ reversed: true });
	});
});
