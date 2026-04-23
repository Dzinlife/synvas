// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import type { TimelineElement } from "core/timeline-system/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TimelineProvider, useTimelineStore } from "@/scene-editor/contexts/TimelineContext";
import { createEditorRuntime } from "./createEditorRuntime";
import {
	EditorRuntimeProvider,
	useEditorRuntime,
	useModelRegistry,
	useTimelineStoreApi,
} from "./EditorRuntimeProvider";

const createElement = (id: string): TimelineElement => ({
	id,
	type: "Image",
	component: "image",
	name: id,
	timeline: {
		start: 0,
		end: 60,
		startTimecode: "00:00:00:00",
		endTimecode: "00:00:02:00",
		trackIndex: 0,
		role: "clip",
	},
	props: {},
});

const RuntimeProbe = ({ testId }: { testId: string }) => {
	const currentTime = useTimelineStore((state) => state.currentTime);
	const selectedIds = useTimelineStore((state) => state.selectedIds);
	const elements = useTimelineStore((state) => state.elements);
	return (
		<div
			data-testid={testId}
			data-current-time={String(currentTime)}
			data-selected-ids={selectedIds.join(",")}
			data-element-count={String(elements.length)}
		/>
	);
};

afterEach(() => {
	cleanup();
});

describe("EditorRuntime isolation", () => {
	it("双 runtime 同时挂载时 timeline 状态互不影响", () => {
		const runtimeA = createEditorRuntime({ id: "runtime-a" });
		const runtimeB = createEditorRuntime({ id: "runtime-b" });

		render(
			<>
				<EditorRuntimeProvider runtime={runtimeA}>
					<TimelineProvider>
						<RuntimeProbe testId="runtime-a-probe" />
					</TimelineProvider>
				</EditorRuntimeProvider>
				<EditorRuntimeProvider runtime={runtimeB}>
					<TimelineProvider>
						<RuntimeProbe testId="runtime-b-probe" />
					</TimelineProvider>
				</EditorRuntimeProvider>
			</>,
		);

		act(() => {
			const storeA = runtimeA.timelineStore.getState();
			storeA.setElements([createElement("shared-element-id")], { history: false });
			storeA.setCurrentTime(48);
			storeA.setSelectedIds(["shared-element-id"], "shared-element-id");
		});

		act(() => {
			runtimeB.timelineStore.getState().setCurrentTime(7);
		});

		expect(runtimeA.timelineStore.getState().currentTime).toBe(48);
		expect(runtimeA.timelineStore.getState().elements).toHaveLength(1);
		expect(runtimeA.timelineStore.getState().selectedIds).toEqual([
			"shared-element-id",
		]);

		expect(runtimeB.timelineStore.getState().currentTime).toBe(7);
		expect(runtimeB.timelineStore.getState().elements).toHaveLength(0);
		expect(runtimeB.timelineStore.getState().selectedIds).toEqual([]);
	});

	it("不同 runtime 可使用相同 model id 且互不覆盖", () => {
		const runtimeA = createEditorRuntime({ id: "runtime-a-model" });
		const runtimeB = createEditorRuntime({ id: "runtime-b-model" });
		const disposeA = vi.fn();
		const disposeB = vi.fn();
		const modelStoreA = {
			getState: () => ({
				dispose: disposeA,
			}),
		};
		const modelStoreB = {
			getState: () => ({
				dispose: disposeB,
			}),
		};

		runtimeA.modelRegistry.register(
			"shared-model-id",
			modelStoreA as unknown as Parameters<typeof runtimeA.modelRegistry.register>[1],
		);
		runtimeB.modelRegistry.register(
			"shared-model-id",
			modelStoreB as unknown as Parameters<typeof runtimeB.modelRegistry.register>[1],
		);

		expect(runtimeA.modelRegistry.get("shared-model-id")).toBe(modelStoreA);
		expect(runtimeB.modelRegistry.get("shared-model-id")).toBe(modelStoreB);

		runtimeA.modelRegistry.unregister("shared-model-id");

		expect(disposeA).toHaveBeenCalledTimes(1);
		expect(disposeB).not.toHaveBeenCalled();
		expect(runtimeA.modelRegistry.has("shared-model-id")).toBe(false);
		expect(runtimeB.modelRegistry.has("shared-model-id")).toBe(true);
		expect(runtimeB.modelRegistry.get("shared-model-id")).toBe(modelStoreB);
	});

	it("无 Provider 时 runtime hooks 显式抛错", () => {
		const RuntimeHookProbe = () => {
			useEditorRuntime();
			return null;
		};
		const TimelineStoreHookProbe = () => {
			useTimelineStoreApi();
			return null;
		};
		const ModelRegistryHookProbe = () => {
			useModelRegistry();
			return null;
		};

		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(() => render(<RuntimeHookProbe />)).toThrowError(
			"EditorRuntimeProvider is missing. Wrap the editor tree with EditorRuntimeProvider.",
		);
		expect(() => render(<TimelineStoreHookProbe />)).toThrowError(
			"EditorRuntimeProvider is missing. Wrap the editor tree with EditorRuntimeProvider.",
		);
		expect(() => render(<ModelRegistryHookProbe />)).toThrowError(
			"EditorRuntimeProvider is missing. Wrap the editor tree with EditorRuntimeProvider.",
		);
		errorSpy.mockRestore();
	});
});
