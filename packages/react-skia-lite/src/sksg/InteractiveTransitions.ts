import type { Mutable } from "../react-native-types";
import type { Node } from "./Node";
import type { Container } from "./StaticContainer";

type EasingName = "linear" | "easeInOut" | "easeOutCubic";

interface TransitionSpec {
	duration: number;
	easing: EasingName;
}

interface NumericTrack {
	from: number;
	to: number;
	startMs: number;
	durationMs: number;
	easing: (value: number) => number;
	active: boolean;
}

const NODE_TRANSITION_STATE = Symbol("skia.nodeTransitionState");

const EPSILON = 1e-6;

const DEFAULT_TRANSITION: TransitionSpec = {
	duration: 180,
	easing: "easeOutCubic",
};

const RESERVED_TRANSITION_KEYS = new Set([
	"transition",
	"whileHover",
	"whileActive",
	"animate",
]);

const DEFAULT_VALUE_BY_KEY: Record<string, number> = {
	opacity: 1,
	scale: 1,
	scaleX: 1,
	scaleY: 1,
};

const easingByName: Record<EasingName, (value: number) => number> = {
	linear: (value) => value,
	easeInOut: (value) => {
		if (value <= 0.5) {
			return 2 * value * value;
		}
		return 1 - ((-2 * value + 2) ** 2) / 2;
	},
	easeOutCubic: (value) => 1 - (1 - value) ** 3,
};

const isObjectLike = (value: unknown): value is Record<string, unknown> => {
	return typeof value === "object" && value !== null;
};

const toFiniteNumber = (value: unknown): number | null => {
	const candidate = isObjectLike(value) && "value" in value ? value.value : value;
	if (!Number.isFinite(candidate)) return null;
	return Number(candidate);
};

const resolveNow = (): number => {
	if (typeof performance !== "undefined" && Number.isFinite(performance.now())) {
		return performance.now();
	}
	return Date.now();
};

const parseNumericMap = (value: unknown): Record<string, number> => {
	if (!isObjectLike(value)) return {};
	const result: Record<string, number> = {};
	for (const [key, raw] of Object.entries(value)) {
		const numeric = toFiniteNumber(raw);
		if (numeric === null) continue;
		result[key] = numeric;
	}
	return result;
};

const parseTransitionPartial = (
	value: unknown,
): Partial<TransitionSpec> | null => {
	if (!isObjectLike(value)) return null;
	const next: Partial<TransitionSpec> = {};
	const duration = toFiniteNumber(value.duration);
	if (duration !== null) {
		next.duration = Math.max(0, duration);
	}
	if (
		value.easing === "linear" ||
		value.easing === "easeInOut" ||
		value.easing === "easeOutCubic"
	) {
		next.easing = value.easing;
	}
	if (next.duration === undefined && next.easing === undefined) return null;
	return next;
};

const resolveTransitionSpecForKey = (
	transitionInput: unknown,
	key: string,
): TransitionSpec => {
	const fallback = parseTransitionPartial(transitionInput) ?? {};
	let merged: TransitionSpec = {
		duration: fallback.duration ?? DEFAULT_TRANSITION.duration,
		easing: fallback.easing ?? DEFAULT_TRANSITION.easing,
	};
	if (!isObjectLike(transitionInput)) {
		return merged;
	}
	const propertyInput = transitionInput[key] ?? transitionInput.default;
	const propertyPartial = parseTransitionPartial(propertyInput);
	if (!propertyPartial) {
		return merged;
	}
	merged = {
		duration: propertyPartial.duration ?? merged.duration,
		easing: propertyPartial.easing ?? merged.easing,
	};
	return merged;
};

const createMutableNumber = (value: number): Mutable<number> => {
	return {
		value,
		_isSharedValue: true,
	};
};

const resolveDefaultBaseValue = (key: string): number => {
	return DEFAULT_VALUE_BY_KEY[key] ?? 0;
};

const isAlmostEqual = (left: number, right: number): boolean => {
	return Math.abs(left - right) <= EPSILON;
};

class FrameClock {
	private listeners = new Set<(nowMs: number, dtMs: number) => void>();
	private rafId: number | ReturnType<typeof setTimeout> | null = null;
	private lastNowMs = 0;

	subscribe(listener: (nowMs: number, dtMs: number) => void): () => void {
		this.listeners.add(listener);
		if (this.rafId === null) {
			this.lastNowMs = resolveNow();
			this.rafId = this.scheduleNextFrame();
		}
		return () => {
			this.listeners.delete(listener);
			if (this.listeners.size === 0 && this.rafId !== null) {
				this.cancelFrame(this.rafId);
				this.rafId = null;
			}
		};
	}

	private scheduleNextFrame() {
		if (typeof globalThis.requestAnimationFrame === "function") {
			return globalThis.requestAnimationFrame(this.tick);
		}
		return setTimeout(() => {
			this.tick(resolveNow());
		}, 16);
	}

	private cancelFrame(handle: number | ReturnType<typeof setTimeout>) {
		if (typeof globalThis.cancelAnimationFrame === "function") {
			globalThis.cancelAnimationFrame(handle as number);
			return;
		}
		clearTimeout(handle as ReturnType<typeof setTimeout>);
	}

	private tick = (now: number) => {
		if (this.listeners.size === 0) {
			this.rafId = null;
			return;
		}
		const nowMs = Number.isFinite(now) ? now : resolveNow();
		const dtMs = Math.max(0, nowMs - this.lastNowMs);
		this.lastNowMs = nowMs;
		for (const listener of this.listeners) {
			listener(nowMs, dtMs);
		}
		if (this.listeners.size === 0) {
			this.rafId = null;
			return;
		}
		this.rafId = this.scheduleNextFrame();
	};
}

const sharedFrameClock = new FrameClock();

class ContainerTransitionRuntime {
	private states = new Set<NodeTransitionState>();
	private activeStates = new Set<NodeTransitionState>();
	private unsubscribeClock: (() => void) | null = null;
	private nowMs = resolveNow();

	constructor(private container: Container) {}

	registerState(state: NodeTransitionState) {
		this.states.add(state);
	}

	markStateActive(state: NodeTransitionState) {
		this.activeStates.add(state);
		if (this.unsubscribeClock) return;
		this.unsubscribeClock = sharedFrameClock.subscribe((nowMs) => {
			this.nowMs = nowMs;
			let needsRedraw = false;
			for (const candidate of this.activeStates) {
				const changed = candidate.tick(nowMs);
				if (changed) {
					needsRedraw = true;
				}
				if (!candidate.hasActiveTracks()) {
					this.activeStates.delete(candidate);
				}
			}
			if (needsRedraw && !this.container.isUnmounted()) {
				this.container.redraw();
			}
			if (this.activeStates.size !== 0 || !this.unsubscribeClock) {
				return;
			}
			this.unsubscribeClock();
			this.unsubscribeClock = null;
		});
	}

	getNowMs() {
		return this.nowMs;
	}

	pruneByRoot(root: Node[]) {
		const liveStates = new Set<NodeTransitionState>();
		const visitNode = (node: Node) => {
			const state = getNodeTransitionState(node);
			if (state) {
				liveStates.add(state);
			}
			for (const child of node.children) {
				visitNode(child);
			}
		};
		for (const node of root) {
			visitNode(node);
		}
		for (const state of liveStates) {
			this.states.add(state);
			if (state.hasActiveTracks()) {
				this.markStateActive(state);
			}
		}
		for (const state of this.states) {
			if (liveStates.has(state)) continue;
			this.states.delete(state);
			this.activeStates.delete(state);
		}
		if (this.activeStates.size === 0 && this.unsubscribeClock) {
			this.unsubscribeClock();
			this.unsubscribeClock = null;
		}
	}

	dispose() {
		for (const state of this.states) {
			state.dispose();
		}
		this.states.clear();
		this.activeStates.clear();
		if (this.unsubscribeClock) {
			this.unsubscribeClock();
			this.unsubscribeClock = null;
		}
	}
}

const runtimeByContainer = new WeakMap<Container, ContainerTransitionRuntime>();

const getContainerRuntime = (container: Container): ContainerTransitionRuntime => {
	const existing = runtimeByContainer.get(container);
	if (existing) return existing;
	const next = new ContainerTransitionRuntime(container);
	runtimeByContainer.set(container, next);
	return next;
};

class NodeTransitionState {
	private transitionInput: unknown = null;
	private managedKeys = new Set<string>();
	private sharedValues = new Map<string, Mutable<number>>();
	private tracks = new Map<string, NumericTrack>();
	private baseTargets = new Map<string, number>();
	private hoverTargets = new Map<string, number>();
	private activeTargets = new Map<string, number>();
	private animateTargets = new Map<string, number>();
	private hovered = false;
	private active = false;
	private disposed = false;

	constructor(private runtime: ContainerTransitionRuntime) {}

	getRuntime(): ContainerTransitionRuntime {
		return this.runtime;
	}

	configure(params: {
		props: Record<string, unknown>;
		transitionInput: unknown;
		whileHoverInput: unknown;
		whileActiveInput: unknown;
		animateInput: unknown;
	}) {
		if (this.disposed) return;
		const {
			props,
			transitionInput,
			whileHoverInput,
			whileActiveInput,
			animateInput,
		} = params;
		this.transitionInput = transitionInput;

		const numericProps: Record<string, number> = {};
		for (const [key, value] of Object.entries(props)) {
			if (RESERVED_TRANSITION_KEYS.has(key)) continue;
			const numeric = toFiniteNumber(value);
			if (numeric === null) continue;
			numericProps[key] = numeric;
		}
		const hoverTargets = parseNumericMap(whileHoverInput);
		const activeTargets = parseNumericMap(whileActiveInput);
		const animateTargets = parseNumericMap(animateInput);

		const nextManagedKeys = new Set<string>();
		if (transitionInput !== undefined && transitionInput !== null) {
			for (const key of Object.keys(numericProps)) {
				nextManagedKeys.add(key);
			}
		}
		for (const key of this.managedKeys) {
			nextManagedKeys.add(key);
		}
		for (const key of Object.keys(hoverTargets)) {
			nextManagedKeys.add(key);
		}
		for (const key of Object.keys(activeTargets)) {
			nextManagedKeys.add(key);
		}
		for (const key of Object.keys(animateTargets)) {
			nextManagedKeys.add(key);
		}

		const nextBaseTargets = new Map<string, number>();
		for (const key of nextManagedKeys) {
			if (Object.prototype.hasOwnProperty.call(numericProps, key)) {
				nextBaseTargets.set(key, numericProps[key] as number);
				continue;
			}
			if (this.baseTargets.has(key)) {
				nextBaseTargets.set(key, this.baseTargets.get(key) as number);
				continue;
			}
			nextBaseTargets.set(key, resolveDefaultBaseValue(key));
		}

		this.managedKeys = nextManagedKeys;
		this.baseTargets = nextBaseTargets;
		this.hoverTargets = new Map(Object.entries(hoverTargets));
		this.activeTargets = new Map(Object.entries(activeTargets));
		this.animateTargets = new Map(Object.entries(animateTargets));

		for (const key of this.managedKeys) {
			const shared = this.sharedValues.get(key);
			if (shared) continue;
			// 首次挂载时若声明 animate，先以 base 作为初值，再自动过渡到 animate 目标。
			const initialValue = this.resolveInitialValueForKey(key);
			this.sharedValues.set(key, createMutableNumber(initialValue));
		}

		for (const key of this.sharedValues.keys()) {
			if (this.managedKeys.has(key)) continue;
			this.sharedValues.delete(key);
			this.tracks.delete(key);
		}

		for (const key of this.managedKeys) {
			const target = this.resolveTargetForKey(key);
			this.startTrackToTarget(key, target);
		}
	}

	attachSharedProps(props: Record<string, unknown>): Record<string, unknown> {
		if (this.disposed) return props;
		const nextProps = { ...props };
		for (const key of this.managedKeys) {
			const shared = this.sharedValues.get(key);
			if (!shared) continue;
			nextProps[key] = shared;
		}
		return nextProps;
	}

	setHovered(nextHovered: boolean) {
		if (this.disposed) return;
		if (this.hovered === nextHovered) return;
		this.hovered = nextHovered;
		this.syncTargets();
	}

	setActive(nextActive: boolean) {
		if (this.disposed) return;
		if (this.active === nextActive) return;
		this.active = nextActive;
		this.syncTargets();
	}

	hasActiveTracks(): boolean {
		for (const track of this.tracks.values()) {
			if (track.active) return true;
		}
		return false;
	}

	tick(nowMs: number): boolean {
		if (this.disposed) return false;
		let changed = false;
		for (const [key, track] of this.tracks.entries()) {
			if (!track.active) continue;
			const shared = this.sharedValues.get(key);
			if (!shared) continue;
			const progress = Math.max(
				0,
				Math.min(1, (nowMs - track.startMs) / Math.max(track.durationMs, EPSILON)),
			);
			const eased = track.easing(progress);
			const nextValue = track.from + (track.to - track.from) * eased;
			if (!isAlmostEqual(shared.value, nextValue)) {
				shared.value = nextValue;
				changed = true;
			}
			if (progress >= 1) {
				track.active = false;
				if (!isAlmostEqual(shared.value, track.to)) {
					shared.value = track.to;
					changed = true;
				}
			}
		}
		return changed;
	}

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.tracks.clear();
		this.sharedValues.clear();
		this.baseTargets.clear();
		this.hoverTargets.clear();
		this.activeTargets.clear();
		this.animateTargets.clear();
		this.managedKeys.clear();
	}

	private syncTargets() {
		for (const key of this.managedKeys) {
			const target = this.resolveTargetForKey(key);
			this.startTrackToTarget(key, target);
		}
	}

	private resolveTargetForKey(key: string): number {
		if (this.active && this.activeTargets.has(key)) {
			return this.activeTargets.get(key) as number;
		}
		if (this.hovered && this.hoverTargets.has(key)) {
			return this.hoverTargets.get(key) as number;
		}
		if (this.animateTargets.has(key)) {
			return this.animateTargets.get(key) as number;
		}
		return this.baseTargets.get(key) ?? resolveDefaultBaseValue(key);
	}

	private resolveInitialValueForKey(key: string): number {
		if (this.baseTargets.has(key)) {
			return this.baseTargets.get(key) as number;
		}
		return resolveDefaultBaseValue(key);
	}

	private startTrackToTarget(key: string, target: number) {
		const shared = this.sharedValues.get(key);
		if (!shared) return;
		const nowMs = resolveNow();
		const currentValue = shared.value;
		if (isAlmostEqual(currentValue, target)) {
			shared.value = target;
			const currentTrack = this.tracks.get(key);
			if (currentTrack) {
				currentTrack.active = false;
			}
			return;
		}

		const spec = resolveTransitionSpecForKey(this.transitionInput, key);
		const durationMs = Math.max(0, spec.duration);
		if (durationMs <= 0) {
			shared.value = target;
			let track = this.tracks.get(key);
			if (!track) {
				track = {
					from: target,
					to: target,
					startMs: nowMs,
					durationMs: 0,
					easing: easingByName[spec.easing],
					active: false,
				};
				this.tracks.set(key, track);
			} else {
				track.from = target;
				track.to = target;
				track.startMs = nowMs;
				track.durationMs = 0;
				track.easing = easingByName[spec.easing];
				track.active = false;
			}
			return;
		}

		const nextTrack: NumericTrack = {
			from: currentValue,
			to: target,
			startMs: nowMs,
			durationMs,
			easing: easingByName[spec.easing],
			active: true,
		};
		this.tracks.set(key, nextTrack);
		this.runtime.markStateActive(this);
	}
}

type NodeWithTransitionState = Node & {
	[NODE_TRANSITION_STATE]?: NodeTransitionState;
};

const getNodeTransitionState = (node: Node): NodeTransitionState | null => {
	const state = (node as NodeWithTransitionState)[NODE_TRANSITION_STATE];
	return state ?? null;
};

const setNodeTransitionState = (
	node: Node,
	state: NodeTransitionState | null,
) => {
	const candidate = node as NodeWithTransitionState;
	if (!state) {
		delete candidate[NODE_TRANSITION_STATE];
		return;
	}
	candidate[NODE_TRANSITION_STATE] = state;
};

export const prepareInteractiveTransitionProps = (params: {
	node: Node;
	previousNode: Node | null;
	props: Record<string, unknown>;
	container?: Container;
}): Record<string, unknown> => {
	const { node, previousNode, props, container } = params;
	const nextProps = { ...props };
	const transitionInput = nextProps.transition;
	const whileHoverInput = nextProps.whileHover;
	const whileActiveInput = nextProps.whileActive;
	const animateInput = nextProps.animate;
	delete nextProps.transition;
	delete nextProps.whileHover;
	delete nextProps.whileActive;
	delete nextProps.animate;

	const previousState = previousNode ? getNodeTransitionState(previousNode) : null;
	const hasTransitionConfig =
		transitionInput !== undefined ||
		whileHoverInput !== undefined ||
		whileActiveInput !== undefined ||
		animateInput !== undefined;

	if (!hasTransitionConfig) {
		if (previousState) {
			previousState.dispose();
		}
		setNodeTransitionState(node, null);
		return nextProps;
	}

	const runtime =
		previousState?.getRuntime() ??
		(container ? getContainerRuntime(container) : null);
	if (!runtime) {
		setNodeTransitionState(node, null);
		return nextProps;
	}
	const state = previousState ?? new NodeTransitionState(runtime);
	runtime.registerState(state);
	state.configure({
		props: nextProps,
		transitionInput,
		whileHoverInput,
		whileActiveInput,
		animateInput,
	});
	setNodeTransitionState(node, state);
	return state.attachSharedProps(nextProps);
};

export const setNodeHoverState = (node: Node, hovered: boolean) => {
	const state = getNodeTransitionState(node);
	if (!state) return;
	state.setHovered(hovered);
};

export const setNodeActiveState = (node: Node, active: boolean) => {
	const state = getNodeTransitionState(node);
	if (!state) return;
	state.setActive(active);
};

export const handleContainerRedraw = (container: Container, root: Node[]) => {
	const runtime = runtimeByContainer.get(container);
	if (!runtime) return;
	runtime.pruneByRoot(root);
};

export const handleContainerUnmount = (container: Container) => {
	const runtime = runtimeByContainer.get(container);
	if (!runtime) return;
	runtime.dispose();
	runtimeByContainer.delete(container);
};
