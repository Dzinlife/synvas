export const createCopySeed = () =>
	`${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export const cloneValue = <T>(value: T): T => {
	if (value === null || value === undefined) {
		return value;
	}
	if (typeof structuredClone === "function") {
		try {
			return structuredClone(value);
		} catch {
			// fall through to JSON clone
		}
	}
	try {
		return JSON.parse(JSON.stringify(value)) as T;
	} catch {
		return value;
	}
};
