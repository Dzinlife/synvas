import type { TimelineElement } from "core/element/types";
import { describe, expect, it } from "vitest";
import { createTransformMeta } from "@/element/transform";
import {
	detachCompositionAudio,
	isCompositionSourceAudioMuted,
	restoreCompositionAudio,
} from "./compositionAudioSeparation";

const createCompositionElement = (
	id: string,
	options?: { gainDb?: number },
): TimelineElement => {
	return {
		id,
		type: "Composition",
		component: "composition",
		name: "composition",
		props: {
			sceneId: "scene-source",
		},
		transform: createTransformMeta({
			width: 1920,
			height: 1080,
			positionX: 960,
			positionY: 540,
		}),
		timeline: {
			start: 10,
			end: 100,
			startTimecode: "00:00:00:10",
			endTimecode: "00:00:03:10",
			offset: 7,
			trackIndex: 0,
			role: "clip",
		},
		render: {
			zIndex: 0,
			visible: true,
			opacity: 1,
		},
		...(options?.gainDb === undefined
			? {}
			: {
					clip: {
						gainDb: options.gainDb,
					},
				}),
	};
};

describe("compositionAudioSeparation", () => {
	it("分离会创建 CompositionAudioClip 并写入 sourceCompositionId", () => {
		const composition = createCompositionElement("composition-1");
		const next = detachCompositionAudio({
			elements: [composition],
			compositionId: composition.id,
			fps: 30,
		});
		expect(next).toHaveLength(2);
		const detached = next.find(
			(element) => element.type === "CompositionAudioClip",
		);
		expect(detached).toBeTruthy();
		expect(detached?.clip?.sourceCompositionId).toBe("composition-1");
		expect((detached?.props as { sceneId?: string } | undefined)?.sceneId).toBe(
			"scene-source",
		);
		expect(detached?.timeline.start).toBe(10);
		expect(detached?.timeline.end).toBe(100);
		expect(detached?.timeline.offset).toBe(7);
	});

	it("分离会把 Composition 标记为 muteSourceAudio 并转移 gain", () => {
		const composition = createCompositionElement("composition-1", {
			gainDb: 6,
		});
		const next = detachCompositionAudio({
			elements: [composition],
			compositionId: composition.id,
			fps: 30,
		});
		const updatedComposition = next.find(
			(element) => element.id === composition.id,
		);
		const detached = next.find(
			(element) => element.type === "CompositionAudioClip",
		);
		expect(isCompositionSourceAudioMuted(updatedComposition)).toBe(true);
		expect(updatedComposition?.clip).toEqual({ muteSourceAudio: true });
		expect(detached?.clip).toEqual({
			sourceCompositionId: "composition-1",
			gainDb: 6,
		});
	});

	it("无可用源音频时不会执行分离", () => {
		const composition = createCompositionElement("composition-1");
		const elements = [composition];
		const next = detachCompositionAudio({
			elements,
			compositionId: composition.id,
			fps: 30,
			hasSourceAudioTrack: false,
		});
		expect(next).toBe(elements);
	});

	it("重复分离会每次新增一条 CompositionAudioClip", () => {
		const composition = createCompositionElement("composition-1");
		const first = detachCompositionAudio({
			elements: [composition],
			compositionId: composition.id,
			fps: 30,
		});
		const second = detachCompositionAudio({
			elements: first,
			compositionId: composition.id,
			fps: 30,
		});
		expect(
			second.filter((element) => element.type === "CompositionAudioClip"),
		).toHaveLength(2);
	});

	it("还原仅恢复 Composition，不移除分离音轨", () => {
		const composition = createCompositionElement("composition-1", {
			gainDb: 3,
		});
		const detached = detachCompositionAudio({
			elements: [composition],
			compositionId: composition.id,
			fps: 30,
		});
		const restored = restoreCompositionAudio({
			elements: detached,
			compositionId: composition.id,
		});
		const restoredComposition = restored.find(
			(element) => element.id === composition.id,
		);
		expect(isCompositionSourceAudioMuted(restoredComposition)).toBe(false);
		expect(restoredComposition?.clip).toBeUndefined();
		expect(
			restored.filter((element) => element.type === "CompositionAudioClip"),
		).toHaveLength(1);
	});
});
