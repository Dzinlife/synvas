import type { CanvasKit, EmbindEnum, EmbindEnumEntity } from "canvaskit-wasm";

import type { SkJSIInstance } from "../types";

const disposedNativeRefs = new WeakSet<object>();
const disposeCleanupSymbol = Symbol("skia-dispose-cleanup");

type DisposeCleanupCarrier = {
	[disposeCleanupSymbol]?: Array<() => void>;
};

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

	private setCurrentContextIfNeeded(currentRef: unknown) {
		if (!currentRef || typeof currentRef !== "object") return;
		const contextHandle = (currentRef as { _context?: unknown })._context;
		if (contextHandle === undefined || contextHandle === null) return;
		const canvasKitWithContext = this.CanvasKit as CanvasKit & {
			setCurrentContext?: (context: unknown) => boolean;
		};
		canvasKitWithContext.setCurrentContext?.(contextHandle);
	}

	[Symbol.dispose](): void {
		const currentRef = this.ref as unknown;
		if (!currentRef || typeof currentRef !== "object") {
			runAttachedDisposeCleanups(this);
			return;
		}
		if (disposedNativeRefs.has(currentRef)) {
			runAttachedDisposeCleanups(this);
			return;
		}
		this.ref = null as unknown as T;
		try {
			if ("delete" in currentRef && typeof currentRef.delete === "function") {
				disposedNativeRefs.add(currentRef);
				this.setCurrentContextIfNeeded(currentRef);
				currentRef.delete();
			}
		} catch {
		} finally {
			runAttachedDisposeCleanups(this);
		}
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

export const attachDisposeCleanup = (
	target: Disposable,
	cleanup: () => void,
) => {
	const carrier = target as DisposeCleanupCarrier;
	carrier[disposeCleanupSymbol] ??= [];
	carrier[disposeCleanupSymbol]?.push(cleanup);
};

export const runAttachedDisposeCleanups = (target: Disposable) => {
	const carrier = target as DisposeCleanupCarrier;
	const cleanups = carrier[disposeCleanupSymbol];
	if (!cleanups || cleanups.length === 0) {
		return;
	}
	carrier[disposeCleanupSymbol] = [];
	for (const cleanup of cleanups) {
		try {
			cleanup();
		} catch {}
	}
};

export const getEnum = (
	CanvasKit: CanvasKit,
	name: keyof CanvasKit,
	v: number,
): EmbindEnumEntity => {
	const e = CanvasKit[name] as unknown as (EmbindEnum &
		Record<string, unknown>) | null;
	if (!e || (typeof e !== "function" && typeof e !== "object")) {
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
