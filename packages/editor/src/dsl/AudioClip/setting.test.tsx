// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { TimelineElement } from "core/dsl/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTransformMeta } from "@/dsl/transform";
import type { AudioClipProps } from "./model";
import { AudioClipSetting } from "./setting";

vi.mock("@/projects/useProjectAssets", () => ({
	useProjectAssets: () => ({
		getProjectAssetById: (id: string) =>
			id === "source-audio-1" ? { id: "source-audio-1", uri: "/origin.mp3" } : null,
	}),
}));

const createAudioClipElement = (
	props: Partial<AudioClipProps> = {},
): TimelineElement<AudioClipProps> => {
	return {
		id: "audio-1",
		type: "AudioClip",
		component: "audio-clip",
		name: "Audio Clip",
		assetId: "source-audio-1",
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
			reversed: false,
			...props,
		},
	};
};

afterEach(() => {
	cleanup();
});

describe("AudioClipSetting", () => {
	it("展示绑定素材信息", () => {
		const updateProps = vi.fn();
		render(
			<AudioClipSetting
				element={createAudioClipElement()}
				updateProps={updateProps}
			/>,
		);

		expect(screen.getByText("/origin.mp3")).toBeTruthy();
		expect(updateProps).not.toHaveBeenCalled();
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
