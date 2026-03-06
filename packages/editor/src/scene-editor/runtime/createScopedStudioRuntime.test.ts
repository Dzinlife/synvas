import { describe, expect, it } from "vitest";
import { createEditorRuntime } from "./createEditorRuntime";
import { createScopedStudioRuntime } from "./createScopedStudioRuntime";
import type { EditorRuntime, StudioRuntimeManager } from "./types";

const toSceneTimelineRef = (sceneId: string) =>
	({
		kind: "scene",
		sceneId,
	}) as const;

const createRuntimeManager = (): EditorRuntime & StudioRuntimeManager => {
	return createEditorRuntime({ id: "scoped-runtime-test" }) as EditorRuntime &
		StudioRuntimeManager;
};

describe("createScopedStudioRuntime", () => {
	it("activeTimelineRef 指向 scene-2 时，timelineStore/modelRegistry 固定到 scene-2", () => {
		const runtimeManager = createRuntimeManager();
		const scene1Ref = toSceneTimelineRef("scene-1");
		const scene2Ref = toSceneTimelineRef("scene-2");
		const scene1Runtime = runtimeManager.ensureTimelineRuntime(scene1Ref);
		const scene2Runtime = runtimeManager.ensureTimelineRuntime(scene2Ref);
		runtimeManager.setActiveEditTimeline(scene1Ref);

		const scopedRuntime = createScopedStudioRuntime({
			runtimeManager,
			activeSceneId: "scene-2",
		});

		expect(scopedRuntime.timelineStore).toBe(scene2Runtime.timelineStore);
		expect(scopedRuntime.timelineStore).not.toBe(scene1Runtime.timelineStore);
		expect(scopedRuntime.modelRegistry).toBe(scene2Runtime.modelRegistry);
		expect(scopedRuntime.modelRegistry).not.toBe(scene1Runtime.modelRegistry);
	});

	it("getActiveEditTimelineRef/getActiveEditTimelineRuntime 优先返回 scoped activeTimelineRef", () => {
		const runtimeManager = createRuntimeManager();
		const scene1Ref = toSceneTimelineRef("scene-1");
		const scene2Ref = toSceneTimelineRef("scene-2");
		runtimeManager.ensureTimelineRuntime(scene1Ref);
		const scene2Runtime = runtimeManager.ensureTimelineRuntime(scene2Ref);
		runtimeManager.setActiveEditTimeline(scene1Ref);

		const scopedRuntime = createScopedStudioRuntime({
			runtimeManager,
			activeSceneId: "scene-2",
		});

		expect(scopedRuntime.getActiveEditTimelineRef()).toEqual(scene2Ref);
		expect(scopedRuntime.getActiveEditTimelineRuntime()).toBe(scene2Runtime);
	});

	it("activeTimelineRef 为 null 时回退到 runtimeManager 当前 active", () => {
		const runtimeManager = createRuntimeManager();
		const scene1Ref = toSceneTimelineRef("scene-1");
		const scene1Runtime = runtimeManager.ensureTimelineRuntime(scene1Ref);
		runtimeManager.setActiveEditTimeline(scene1Ref);

		const scopedRuntime = createScopedStudioRuntime({
			runtimeManager,
			activeSceneId: null,
		});

		expect(scopedRuntime.timelineStore).toBe(scene1Runtime.timelineStore);
		expect(scopedRuntime.modelRegistry).toBe(scene1Runtime.modelRegistry);
		expect(scopedRuntime.getActiveEditTimelineRef()).toEqual(scene1Ref);
		expect(scopedRuntime.getActiveEditTimelineRuntime()).toBe(scene1Runtime);
	});

	it("ensure/remove/get/list/setActiveEditTimeline 会委托到底层 runtimeManager", () => {
		const runtimeManager = createRuntimeManager();
		const scopedRuntime = createScopedStudioRuntime({
			runtimeManager,
			activeSceneId: "scene-1",
		});
		const scene3Ref = toSceneTimelineRef("scene-3");

		const scene3Runtime = scopedRuntime.ensureTimelineRuntime(scene3Ref);
		expect(runtimeManager.getTimelineRuntime(scene3Ref)).toBe(scene3Runtime);
		expect(scopedRuntime.getTimelineRuntime(scene3Ref)).toBe(scene3Runtime);
		expect(
			scopedRuntime
				.listTimelineRuntimes()
				.some((runtime) => runtime.ref.sceneId === "scene-3"),
		).toBe(true);

		scopedRuntime.setActiveEditTimeline(scene3Ref);
		expect(runtimeManager.getActiveEditTimelineRef()).toEqual(scene3Ref);

		scopedRuntime.removeTimelineRuntime(scene3Ref);
		expect(runtimeManager.getTimelineRuntime(scene3Ref)).toBeNull();
	});

	it("activeSceneId 以 getter 传入时会按最新值动态解析", () => {
		const runtimeManager = createRuntimeManager();
		const scene1Ref = toSceneTimelineRef("scene-1");
		const scene2Ref = toSceneTimelineRef("scene-2");
		const scene1Runtime = runtimeManager.ensureTimelineRuntime(scene1Ref);
		const scene2Runtime = runtimeManager.ensureTimelineRuntime(scene2Ref);
		let activeSceneId: string | null = "scene-1";

		const scopedRuntime = createScopedStudioRuntime({
			runtimeManager,
			activeSceneId: () => activeSceneId,
		});

		expect(scopedRuntime.timelineStore).toBe(scene1Runtime.timelineStore);
		expect(scopedRuntime.getActiveEditTimelineRef()).toEqual(scene1Ref);

		activeSceneId = "scene-2";
		expect(scopedRuntime.timelineStore).toBe(scene2Runtime.timelineStore);
		expect(scopedRuntime.getActiveEditTimelineRef()).toEqual(scene2Ref);

		activeSceneId = null;
		runtimeManager.setActiveEditTimeline(scene1Ref);
		expect(scopedRuntime.timelineStore).toBe(scene1Runtime.timelineStore);
		expect(scopedRuntime.getActiveEditTimelineRef()).toEqual(scene1Ref);
	});
});
