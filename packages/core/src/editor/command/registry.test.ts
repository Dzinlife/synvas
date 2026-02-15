import { describe, expect, it } from "vitest";
import { getCommandDescriptor, listCommands } from "./registry";

describe("command registry", () => {
	it("所有 v1 命令都标记为 requiresShell=false", () => {
		const commands = listCommands();
		expect(commands.length).toBeGreaterThan(0);
		for (const command of commands) {
			expect(command.requiresShell).toBe(false);
		}
	});

	it("应包含 timeline 白名单命令", () => {
		expect(getCommandDescriptor("timeline.element.add")).toBeTruthy();
		expect(getCommandDescriptor("timeline.element.remove")).toBeTruthy();
		expect(getCommandDescriptor("timeline.element.move")).toBeTruthy();
		expect(getCommandDescriptor("timeline.element.trim")).toBeTruthy();
		expect(getCommandDescriptor("timeline.element.split")).toBeTruthy();
		expect(getCommandDescriptor("timeline.track.set-flag")).toBeTruthy();
		expect(getCommandDescriptor("timeline.seek")).toBeTruthy();
		expect(getCommandDescriptor("timeline.undo")).toBeTruthy();
		expect(getCommandDescriptor("timeline.redo")).toBeTruthy();
		expect(getCommandDescriptor("help")).toBeTruthy();
		expect(getCommandDescriptor("schema")).toBeTruthy();
		expect(getCommandDescriptor("examples")).toBeTruthy();
	});

	it("move 命令应保持时长语义", () => {
		const move = getCommandDescriptor("timeline.element.move");
		expect(move).toBeTruthy();
		expect(move?.schema.required).toEqual(["id"]);
		expect(move?.schema.properties.start).toBeTruthy();
		expect(move?.schema.properties.delta).toBeTruthy();
		expect(move?.schema.properties.end).toBeUndefined();
	});
});
