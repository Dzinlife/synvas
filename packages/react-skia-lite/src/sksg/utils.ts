import type { SharedValue } from "../animation/runtime/types";

import { mapKeys } from "../renderer/typeddash";

export const isSharedValue = <T = unknown>(
	value: unknown,
): value is SharedValue<T> => {
	"worklet";
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	if (!("value" in candidate)) {
		return false;
	}
	if (candidate._isSharedValue === true) {
		return true;
	}
	return (
		typeof candidate.get === "function" || typeof candidate.set === "function"
	);
};

export const materialize = <T extends object>(props: T) => {
	"worklet";
	const result: T = Object.assign({}, props);
	mapKeys(result).forEach((key) => {
		const value = result[key];
		if (isSharedValue(value)) {
			result[key] = value.value as never;
		}
	});
	return result;
};

type Composer<T> = (outer: T, inner: T) => T;

export const composeDeclarations = <T>(filters: T[], composer: Composer<T>) => {
	"worklet";
	const len = filters.length;
	if (len <= 1) {
		return filters[0];
	}
	return filters.reduceRight((inner, outer) =>
		inner ? composer(outer, inner) : outer,
	);
};
