import type { CanvasKit, EmbindEnum, EmbindEnumEntity } from "canvaskit-wasm";

import type { SkJSIInstance } from "../types";
import {
	registerTrackedSkiaHostObject,
	unregisterTrackedSkiaHostObject,
} from "./resourceTracker";

const disposedNativeRefs = new WeakSet<object>();
const disposeCleanupSymbol = Symbol("skia-dispose-cleanup");

type DisposeCleanupCarrier = {
	[disposeCleanupSymbol]?: Array<() => void>;
};
const symbolCtor = Symbol as SymbolConstructor & {
	dispose?: typeof Symbol.dispose;
};

export const SKIA_DISPOSE_SYMBOL: typeof Symbol.dispose =
	typeof symbolCtor.dispose === "symbol"
		? symbolCtor.dispose
		: (Symbol.for("Symbol.dispose") as typeof Symbol.dispose);

export const throwNotImplementedOnWeb = <T>(): T => {
	const jestFn = (globalThis as { jest?: { fn: () => unknown } }).jest?.fn;
	if (jestFn) {
		return jestFn() as T;
	}
	throw new Error("Not implemented on web");
};

export abstract class Host {
	readonly CanvasKit: CanvasKit;

	constructor(CanvasKit: CanvasKit) {
		this.CanvasKit = CanvasKit;
	}
}

export const setCurrentCanvasKitContextIfNeeded = (
	CanvasKit: CanvasKit,
	currentRef: unknown,
) => {
	if (!currentRef || typeof currentRef !== "object") return;
	const contextHandle = (currentRef as { _context?: unknown })._context;
	if (contextHandle === undefined || contextHandle === null) return;
	const canvasKitWithContext = CanvasKit as CanvasKit & {
		setCurrentContext?: (context: unknown) => boolean;
	};
	canvasKitWithContext.setCurrentContext?.(contextHandle);
};

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
		registerTrackedSkiaHostObject(this);
	}

	dispose() {
		this[SKIA_DISPOSE_SYMBOL]();
	}

	private setCurrentContextIfNeeded(currentRef: unknown) {
		setCurrentCanvasKitContextIfNeeded(this.CanvasKit, currentRef);
	}

	[SKIA_DISPOSE_SYMBOL](): void {
		const currentRef = this.ref as unknown;
		if (!currentRef || typeof currentRef !== "object") {
			unregisterTrackedSkiaHostObject(this);
			runAttachedDisposeCleanups(this);
			return;
		}
		if (disposedNativeRefs.has(currentRef)) {
			unregisterTrackedSkiaHostObject(this);
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
			unregisterTrackedSkiaHostObject(this);
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
	const e = CanvasKit[name] as unknown as
		| (EmbindEnum & Record<string, unknown>)
		| null;
	if (!e || (typeof e !== "function" && typeof e !== "object")) {
		throw new Error(`${name} is not an number`);
	}
	const enumEntries = [
		...Object.values(e),
		...(typeof e.values === "object" && e.values !== null
			? Object.values(e.values)
			: []),
	].filter(
		(entry): entry is EmbindEnumEntity =>
			typeof entry === "object" && entry !== null && "value" in entry,
	);
	const result = enumEntries.find((entry) => entry.value === v);
	if (!result) {
		throw new Error(`Enum ${name} does not have value ${v} on web`);
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
