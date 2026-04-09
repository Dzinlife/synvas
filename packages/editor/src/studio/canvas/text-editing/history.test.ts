import { describe, expect, it } from "vitest";
import {
	canRedoTextEditingLocalHistory,
	canUndoTextEditingLocalHistory,
	createTextEditingLocalHistory,
	pushTextEditingLocalHistory,
	redoTextEditingLocalHistory,
	undoTextEditingLocalHistory,
} from "./history";

describe("text-editing/history", () => {
	it("支持 push -> undo -> redo 的本地历史回放", () => {
		let history = createTextEditingLocalHistory();
		history = pushTextEditingLocalHistory(history, {
			text: "a",
			selection: { start: 1, end: 1, direction: "none" },
		});
		history = pushTextEditingLocalHistory(history, {
			text: "ab",
			selection: { start: 2, end: 2, direction: "none" },
		});
		expect(canUndoTextEditingLocalHistory(history)).toBe(true);
		expect(canRedoTextEditingLocalHistory(history)).toBe(false);

		const undo = undoTextEditingLocalHistory(history, {
			text: "abc",
			selection: { start: 3, end: 3, direction: "none" },
		});
		expect(undo.snapshot).toEqual({
			text: "ab",
			selection: { start: 2, end: 2, direction: "none" },
		});
		expect(canRedoTextEditingLocalHistory(undo.history)).toBe(true);

		const redo = redoTextEditingLocalHistory(undo.history, {
			text: undo.snapshot?.text ?? "",
			selection: undo.snapshot?.selection ?? {
				start: 0,
				end: 0,
				direction: "none",
			},
		});
		expect(redo.snapshot).toEqual({
			text: "abc",
			selection: { start: 3, end: 3, direction: "none" },
		});
	});
});
