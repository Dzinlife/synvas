import { describe, expect, it } from "vitest";
import { parseShellCommand, parseShellCommandBatch } from "./shellParser";
import type { ParsedCommand, ParsedCommandError } from "./types";

const unwrapParsedCommand = (
	result: ParsedCommand | ParsedCommandError,
): ParsedCommand => {
	if ((result as ParsedCommandError).ok === false) {
		const errorResult = result as ParsedCommandError;
		throw new Error(errorResult.error);
	}
	return result as ParsedCommand;
};

describe("shellParser", () => {
	it("支持 shell 风格参数解析", () => {
		const result = unwrapParsedCommand(
			parseShellCommand(
				"timeline.element.move --id clip-1 --start 12 --delta 6 --track-index 2",
			),
		);
		expect(result.id).toBe("timeline.element.move");
		expect(result.args.id).toBe("clip-1");
		expect(result.args.start).toBe(12);
		expect(result.args.delta).toBe(6);
		expect(result.args.trackIndex).toBe(2);
	});

	it("支持引号中的 JSON 参数", () => {
		const result = unwrapParsedCommand(
			parseShellCommand(
				`timeline.element.add --element '{"id":"clip-1","type":"VideoClip"}'`,
			),
		);
		expect(typeof result.args.element).toBe("object");
		expect((result.args.element as { id: string }).id).toBe("clip-1");
	});

	it("批量解析会返回错误列表", () => {
		const batch = parseShellCommandBatch(
			`timeline.seek --time 10\nunknown.cmd --x 1`,
		);
		expect(batch.commands).toHaveLength(1);
		expect(batch.errors).toHaveLength(1);
		expect(batch.errors[0]?.error).toContain("未知命令");
	});
});
