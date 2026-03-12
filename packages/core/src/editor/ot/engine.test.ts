import { describe, expect, it } from "vitest";
import { createOtEngine } from "./engine";
import type { OtCommand } from "./types";

interface TestCommand extends OtCommand {
	id: "timeline.move" | "canvas.layout";
	args: {
		value: string;
	};
}

describe("createOtEngine", () => {
	it("按 stream 独立维护 undo/redo 游标", () => {
		const engine = createOtEngine<TestCommand>({ actorId: "local" });
		engine.applyLocal({
			streamId: "timeline:scene-a",
			command: { id: "timeline.move", args: { value: "a1" } },
		});
		engine.applyLocal({
			streamId: "timeline:scene-b",
			command: { id: "timeline.move", args: { value: "b1" } },
		});

		expect(engine.getStreamState("timeline:scene-a").undoStack).toHaveLength(1);
		expect(engine.getStreamState("timeline:scene-b").undoStack).toHaveLength(1);

		engine.undo("timeline:scene-a", (op) => ({
			id: "timeline.move",
			args: { value: `undo:${op.command.args.value}` },
		}));

		expect(engine.getStreamState("timeline:scene-a").undoStack).toHaveLength(0);
		expect(engine.getStreamState("timeline:scene-a").redoStack).toHaveLength(1);
		expect(engine.getStreamState("timeline:scene-b").undoStack).toHaveLength(1);
		expect(engine.getStreamState("timeline:scene-b").redoStack).toHaveLength(0);
	});

	it("undo/redo 会写入补偿 op 并记录 inverseOf/causedBy", () => {
		const engine = createOtEngine<TestCommand>({ actorId: "local" });
		const created = engine.applyLocal({
			streamId: "canvas",
			command: { id: "canvas.layout", args: { value: "layout-1" } },
		});

		const inverse = engine.undo("canvas", () => ({
			id: "canvas.layout",
			args: { value: "layout-undo" },
		}));
		expect(inverse).not.toBeNull();
		expect(inverse?.inverseOf).toBe(created.opId);
		expect(inverse?.causedBy).toEqual([created.opId]);

		const redo = engine.redo("canvas", () => ({
			id: "canvas.layout",
			args: { value: "layout-redo" },
		}));
		expect(redo).not.toBeNull();
		expect(redo?.causedBy).toEqual([created.opId]);

		const snapshot = engine.getSnapshot();
		expect(snapshot.opLog).toHaveLength(3);
	});

	it("applyLocal 支持覆盖 actorId", () => {
		const engine = createOtEngine<TestCommand>({ actorId: "local" });
		const op = engine.applyLocal({
			streamId: "canvas",
			command: { id: "canvas.layout", args: { value: "layout-1" } },
			actorId: "user-2",
		});
		expect(op.actorId).toBe("user-2");
		expect(op.opId.startsWith("user-2:")).toBe(true);
	});
});
