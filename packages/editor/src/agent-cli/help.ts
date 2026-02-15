import { getCommandDescriptor, listCommands } from "./registry";
import type { CommandDescriptor, CommandHelpDoc } from "./types";

const stringifySchema = (descriptor: CommandDescriptor): string => {
	const required = new Set(descriptor.schema.required ?? []);
	const lines = Object.entries(descriptor.schema.properties).map(
		([name, property]) => {
			const requiredMark = required.has(name) || property.required ? "*" : "";
			return `- ${name}${requiredMark}: ${property.type} (${property.description})`;
		},
	);
	if (lines.length === 0) {
		return "- (无参数)";
	}
	return lines.join("\n");
};

const renderCommandHelp = (descriptor: CommandDescriptor): string => {
	return [
		`命令: ${descriptor.id}`,
		`说明: ${descriptor.summary}`,
		`模式: ${descriptor.mode}`,
		"参数:",
		stringifySchema(descriptor),
		"示例:",
		...descriptor.examples.map((example) => `- ${example}`),
	].join("\n");
};

const renderCommandList = (descriptors: CommandDescriptor[]): string => {
	return [
		"可用命令:",
		...descriptors.map((descriptor) =>
			`- ${descriptor.id}: ${descriptor.summary}`,
		),
		"",
		"提示: 使用 help --id <commandId> 查看详细帮助",
	].join("\n");
};

export const getCommandHelp = (id?: string): CommandHelpDoc => {
	if (!id) {
		const commands = listCommands();
		return {
			text: renderCommandList(commands),
			commands,
		};
	}
	const descriptor = getCommandDescriptor(id);
	if (!descriptor) {
		return {
			commandId: id,
			text: `未找到命令: ${id}`,
		};
	}
	return {
		commandId: id,
		text: renderCommandHelp(descriptor),
		commands: [descriptor],
	};
};

export const getCommandSchemaText = (id: string): string => {
	const descriptor = getCommandDescriptor(id);
	if (!descriptor) return `未找到命令: ${id}`;
	return [
		`Schema for ${id}`,
		JSON.stringify(descriptor.schema, null, 2),
	].join("\n");
};

export const getCommandExamplesText = (id: string): string => {
	const descriptor = getCommandDescriptor(id);
	if (!descriptor) return `未找到命令: ${id}`;
	return [
		`Examples for ${id}`,
		...descriptor.examples.map((example) => `- ${example}`),
	].join("\n");
};
