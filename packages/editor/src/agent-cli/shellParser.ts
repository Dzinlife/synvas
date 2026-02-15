import { isKnownCommand } from "./registry";
import type { ParsedCommand, ParsedCommandError } from "./types";

const toCamelCase = (input: string): string => {
	return input.replace(/-([a-z])/g, (_match, char: string) => char.toUpperCase());
};

const parseScalar = (value: string): unknown => {
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "null") return null;
	if (/^-?\d+(\.\d+)?$/.test(value)) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	if (
		(value.startsWith("{") && value.endsWith("}")) ||
		(value.startsWith("[") && value.endsWith("]"))
	) {
		try {
			return JSON.parse(value);
		} catch {
			return value;
		}
	}
	return value;
};

const tokenize = (input: string): string[] => {
	const tokens: string[] = [];
	let current = "";
	let inSingleQuote = false;
	let inDoubleQuote = false;
	let escaping = false;

	for (const char of input) {
		if (escaping) {
			current += char;
			escaping = false;
			continue;
		}
		if (char === "\\") {
			escaping = true;
			continue;
		}
		if (char === "'" && !inDoubleQuote) {
			inSingleQuote = !inSingleQuote;
			continue;
		}
		if (char === '"' && !inSingleQuote) {
			inDoubleQuote = !inDoubleQuote;
			continue;
		}
		if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
			if (current.length > 0) {
				tokens.push(current);
				current = "";
			}
			continue;
		}
		current += char;
	}
	if (current.length > 0) {
		tokens.push(current);
	}
	return tokens;
};

const parseArgs = (tokens: string[]): Record<string, unknown> => {
	const args: Record<string, unknown> = {};
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index];
		if (!token.startsWith("--")) {
			continue;
		}
		const rawKey = token.slice(2);
		const key = toCamelCase(rawKey);
		const nextToken = tokens[index + 1];
		if (!nextToken || nextToken.startsWith("--")) {
			args[key] = true;
			continue;
		}
		args[key] = parseScalar(nextToken);
		index += 1;
	}
	return args;
};

const isParsedCommandError = (
	result: ParsedCommand | ParsedCommandError,
): result is ParsedCommandError => {
	return "ok" in result && result.ok === false;
};

export const parseShellCommand = (
	input: string,
): ParsedCommand | ParsedCommandError => {
	const raw = input.trim();
	if (raw.length === 0) {
		return { ok: false, error: "命令为空", raw };
	}
	const tokens = tokenize(raw);
	if (tokens.length === 0) {
		return { ok: false, error: "命令为空", raw };
	}
	const id = tokens[0] ?? "";
	if (!isKnownCommand(id)) {
		return { ok: false, error: `未知命令: ${id}`, raw };
	}
	const args = parseArgs(tokens.slice(1));
	return {
		id,
		args,
		raw,
	};
};

export const parseShellCommandBatch = (input: string): {
	commands: ParsedCommand[];
	errors: ParsedCommandError[];
} => {
	const commands: ParsedCommand[] = [];
	const errors: ParsedCommandError[] = [];
	const lines = input
		.split(/\n+/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	for (const line of lines) {
		const result = parseShellCommand(line);
		if (isParsedCommandError(result)) {
			errors.push(result);
			continue;
		}
		commands.push(result);
	}

	return { commands, errors };
};
