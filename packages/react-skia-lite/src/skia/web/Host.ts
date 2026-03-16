import type { CanvasKit, EmbindEnumEntity } from "canvaskit-wasm";

import type { SkJSIInstance } from "../types";

const disposedNativeRefs = new WeakSet<object>();

export const throwNotImplementedOnRNWeb = <T>(): T => {
	const jestFn = (globalThis as { jest?: { fn: () => unknown } }).jest?.fn;
	if (jestFn) {
		return jestFn() as T;
	}
	throw new Error("Not implemented on React Native Web");
};

export abstract class Host {
	readonly CanvasKit: CanvasKit;

	constructor(CanvasKit: CanvasKit) {
		this.CanvasKit = CanvasKit;
	}
}

export abstract class BaseHostObject<T, N extends string>
	extends Host
	implements SkJSIInstance<N>
{
	readonly __typename__: N;
	ref: T;

	constructor(CanvasKit: CanvasKit, ref: T, typename: N) {
		super(CanvasKit);
		this.ref = ref;
		this.__typename__ = typename;
	}

	dispose() {
		this[Symbol.dispose]();
	}

	[Symbol.dispose](): void {
		const currentRef = this.ref as unknown;
		if (!currentRef || typeof currentRef !== "object") return;
		if (disposedNativeRefs.has(currentRef)) return;
		if (!("delete" in currentRef) || typeof currentRef.delete !== "function") {
			return;
		}
		disposedNativeRefs.add(currentRef);
		this.ref = null as unknown as T;
		try {
			currentRef.delete();
		} catch {}
	}
}

export abstract class HostObject<T, N extends string> extends BaseHostObject<
	T,
	N
> {
	static fromValue<T>(value: SkJSIInstance<string>) {
		return (value as HostObject<T, string>).ref;
	}
}

export const getEnum = (
	CanvasKit: CanvasKit,
	name: keyof CanvasKit,
	v: number,
): EmbindEnumEntity => {
	const e = CanvasKit[name];
	if (typeof e !== "function") {
		throw new Error(`${name} is not an number`);
	}
	const enumEntries = [
		...Object.values(e),
		...((typeof e.values === "object" && e.values !== null)
			? Object.values(e.values)
			: []),
	].filter(
		(entry): entry is EmbindEnumEntity =>
			typeof entry === "object" && entry !== null && "value" in entry,
	);
	const result = enumEntries.find((entry) => entry.value === v);
	if (!result) {
		throw new Error(
			`Enum ${name} does not have value ${v} on React Native Web`,
		);
	}
	return result;
};

export const optEnum = (
	CanvasKit: CanvasKit,
	name: keyof CanvasKit,
	v: number | undefined,
): EmbindEnumEntity | undefined => {
	return v === undefined ? undefined : getEnum(CanvasKit, name, v);
};
