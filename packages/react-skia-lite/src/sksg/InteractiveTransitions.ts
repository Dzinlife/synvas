import {
	cancelAnimation,
	makeMutable,
	withSpring,
	withTiming,
	type AnimationCallback,
	type EasingFunction,
	type WithSpringConfig,
	type WithTimingConfig,
} from "../animation/runtime";
import type { Mutable } from "../react-native-types";
import type { Node } from "./Node";
import type { Container } from "./StaticContainer";

type AnimationKind = "timing" | "spring";

interface ParsedAnimationDescriptor {
	kind: AnimationKind;
	toValue: number;
	config: unknown;
	callback?: AnimationCallback<number>;
	signature: string;
}

type MotionTarget =
	| {
			kind: "immediate";
			value: number;
	  }
	| {
			kind: "animation";
			descriptor: ParsedAnimationDescriptor;
	  };

interface RunningMotionMeta {
	signature: string;
	generation: number;
	active: boolean;
}

const NODE_TRANSITION_STATE = Symbol("skia.nodeTransitionState");
const EPSILON = 1e-6;

const RESERVED_TRANSITION_KEYS = new Set([
	"motion",
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

const warnedMessages = new Set<string>();
const functionIds = new WeakMap<Function, number>();
let nextFunctionId = 1;

const isDevelopment = () => {
	const candidate = globalThis as {
		process?: {
			env?: {
				NODE_ENV?: string;
			};
		};
	};
	return candidate.process?.env?.NODE_ENV !== "production";
};

const warnOnce = (message: string) => {
	if (!isDevelopment() || warnedMessages.has(message)) {
		return;
	}
	warnedMessages.add(message);
	console.warn(message);
};

const isObjectLike = (value: unknown): value is Record<string, unknown> => {
	return typeof value === "object" && value !== null;
};

const toFiniteNumber = (value: unknown): number | null => {
	const candidate = isObjectLike(value) && "value" in value ? value.value : value;
	if (!Number.isFinite(candidate)) return null;
	return Number(candidate);
};

const resolveDefaultBaseValue = (key: string): number => {
	return DEFAULT_VALUE_BY_KEY[key] ?? 0;
};

const isAlmostEqual = (left: number, right: number): boolean => {
	return Math.abs(left - right) <= EPSILON;
};

const resolveFunctionId = (value: Function) => {
	const existing = functionIds.get(value);
	if (existing !== undefined) {
		return existing;
	}
	const nextId = nextFunctionId++;
	functionIds.set(value, nextId);
	return nextId;
};

const serializeForSignature = (
	value: unknown,
	depth = 0,
	visited?: WeakSet<object>,
): string => {
	if (depth > 5) {
		return "depth";
	}
	if (value === null) {
		return "null";
	}
	const valueType = typeof value;
	if (valueType === "number") {
		return Number.isFinite(value) ? `n:${value}` : "n:NaN";
	}
	if (valueType === "string") {
		return `s:${value}`;
	}
	if (valueType === "boolean") {
		return `b:${value}`;
	}
	if (valueType === "function") {
		return `f:${resolveFunctionId(value as Function)}`;
	}
	if (Array.isArray(value)) {
		return `[${value
			.map((entry) => serializeForSignature(entry, depth + 1, visited))
			.join(",")}]`;
	}
	if (!isObjectLike(value)) {
		return valueType;
	}
	const nextVisited = visited ?? new WeakSet<object>();
	if (nextVisited.has(value)) {
		return "cycle";
	}
	nextVisited.add(value);
	const keys = Object.keys(value).sort();
	const serialized = keys
		.filter((key) => key !== "callback")
		.map((key) => {
			return `${key}:${serializeForSignature(
				(value as Record<string, unknown>)[key],
				depth + 1,
				nextVisited,
			)}`;
		});
	nextVisited.delete(value);
	return `{${serialized.join("|")}}`;
};

const parseAnimationDescriptor = (
	value: unknown,
): ParsedAnimationDescriptor | null => {
	if (!isObjectLike(value)) {
		return null;
	}
	const kind = value.kind;
	if (kind !== "timing" && kind !== "spring") {
		return null;
	}
	const toValue = toFiniteNumber(value.toValue);
	if (toValue === null) {
		return null;
	}
	const callback =
		typeof value.callback === "function"
			? (value.callback as AnimationCallback<number>)
			: undefined;
	const config = value.config;
	return {
		kind,
		toValue,
		config,
		callback,
		signature: `${kind}:${toValue}:${serializeForSignature(config)}`,
	};
};

const parseMotionTarget = (
	value: unknown,
	contextPath: string,
): MotionTarget | null => {
	const numeric = toFiniteNumber(value);
	if (numeric !== null) {
		return {
			kind: "immediate",
			value: numeric,
		};
	}
	const descriptor = parseAnimationDescriptor(value);
	if (descriptor) {
		return {
			kind: "animation",
			descriptor,
		};
	}
	warnOnce(
		`[react-skia-lite] ${contextPath} must be a number or a withTiming/withSpring descriptor.`,
	);
	return null;
};

const parseMotionMap = (value: unknown, contextPath: string) => {
	const result = new Map<string, MotionTarget>();
	if (!isObjectLike(value)) {
		return result;
	}
	for (const [key, raw] of Object.entries(value)) {
		const target = parseMotionTarget(raw, `${contextPath}.${key}`);
		if (!target) {
			continue;
		}
		result.set(key, target);
	}
	return result;
};

const resolveTimingConfig = (config: unknown): WithTimingConfig | undefined => {
	if (!isObjectLike(config)) {
		return undefined;
	}
	const nextConfig: WithTimingConfig = {};
	const duration = toFiniteNumber(config.duration);
	if (duration !== null) {
		nextConfig.duration = Math.max(0, duration);
	}
	if (typeof config.easing === "function") {
		nextConfig.easing = config.easing as EasingFunction;
	}
	return Object.keys(nextConfig).length === 0 ? undefined : nextConfig;
};

const resolveSpringConfig = (config: unknown): WithSpringConfig | undefined => {
	if (!isObjectLike(config)) {
		return undefined;
	}
	const nextConfig: WithSpringConfig = {};
	const stiffness = toFiniteNumber(config.stiffness);
	if (stiffness !== null) {
		nextConfig.stiffness = stiffness;
	}
	const damping = toFiniteNumber(config.damping);
	if (damping !== null) {
		nextConfig.damping = damping;
	}
	const mass = toFiniteNumber(config.mass);
	if (mass !== null) {
		nextConfig.mass = mass;
	}
	if (config.velocity !== undefined) {
		nextConfig.velocity = config.velocity;
	}
	if (typeof config.overshootClamping === "boolean") {
		nextConfig.overshootClamping = config.overshootClamping;
	}
	const restDisplacementThreshold = toFiniteNumber(
		config.restDisplacementThreshold,
	);
	if (restDisplacementThreshold !== null) {
		nextConfig.restDisplacementThreshold = restDisplacementThreshold;
	}
	const restSpeedThreshold = toFiniteNumber(config.restSpeedThreshold);
	if (restSpeedThreshold !== null) {
		nextConfig.restSpeedThreshold = restSpeedThreshold;
	}
	return Object.keys(nextConfig).length === 0 ? undefined : nextConfig;
};

class ContainerTransitionRuntime {
	private states = new Set<NodeTransitionState>();

	registerState(state: NodeTransitionState) {
		this.states.add(state);
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
		}
		for (const state of [...this.states]) {
			if (liveStates.has(state)) {
				continue;
			}
			state.dispose();
			this.states.delete(state);
		}
	}

	dispose() {
		for (const state of this.states) {
			state.dispose();
		}
		this.states.clear();
	}
}

const runtimeByContainer = new WeakMap<Container, ContainerTransitionRuntime>();

const getContainerRuntime = (container: Container): ContainerTransitionRuntime => {
	const existing = runtimeByContainer.get(container);
	if (existing) return existing;
	const next = new ContainerTransitionRuntime();
	runtimeByContainer.set(container, next);
	return next;
};

class NodeTransitionState {
	private managedKeys = new Set<string>();
	private sharedValues = new Map<string, Mutable<number>>();
	private runningMotions = new Map<string, RunningMotionMeta>();
	private baseTargets = new Map<string, number>();
	private hoverTargets = new Map<string, MotionTarget>();
	private activeTargets = new Map<string, MotionTarget>();
	private animateTargets = new Map<string, MotionTarget>();
	private hovered = false;
	private active = false;
	private disposed = false;

	constructor(private runtime: ContainerTransitionRuntime) {}

	getRuntime(): ContainerTransitionRuntime {
		return this.runtime;
	}

	configure(params: {
		props: Record<string, unknown>;
		motionInput: unknown;
	}) {
		if (this.disposed) return;
		const { props, motionInput } = params;

		const numericProps: Record<string, number> = {};
		for (const [key, value] of Object.entries(props)) {
			if (RESERVED_TRANSITION_KEYS.has(key)) continue;
			const numeric = toFiniteNumber(value);
			if (numeric === null) continue;
			numericProps[key] = numeric;
		}

		const animateTargets = parseMotionMap(
			isObjectLike(motionInput) ? motionInput.animate : undefined,
			"motion.animate",
		);
		const hoverTargets = parseMotionMap(
			isObjectLike(motionInput) ? motionInput.hover : undefined,
			"motion.hover",
		);
		const activeTargets = parseMotionMap(
			isObjectLike(motionInput) ? motionInput.active : undefined,
			"motion.active",
		);

		const nextManagedKeys = new Set<string>();
		for (const key of animateTargets.keys()) {
			nextManagedKeys.add(key);
		}
		for (const key of hoverTargets.keys()) {
			nextManagedKeys.add(key);
		}
		for (const key of activeTargets.keys()) {
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
		this.hoverTargets = hoverTargets;
		this.activeTargets = activeTargets;
		this.animateTargets = animateTargets;

		for (const key of this.managedKeys) {
			const shared = this.sharedValues.get(key);
			if (shared) continue;
			const initialValue = this.resolveInitialValueForKey(key);
			this.sharedValues.set(key, makeMutable(initialValue));
		}

		for (const key of [...this.sharedValues.keys()]) {
			if (this.managedKeys.has(key)) continue;
			const shared = this.sharedValues.get(key);
			if (shared) {
				cancelAnimation(shared);
			}
			this.sharedValues.delete(key);
			this.runningMotions.delete(key);
		}

		this.syncTargets();
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

	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		for (const shared of this.sharedValues.values()) {
			cancelAnimation(shared);
		}
		this.runningMotions.clear();
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
			this.applyTargetForKey(key, target);
		}
	}

	private resolveTargetForKey(key: string): MotionTarget {
		if (this.active) {
			const activeTarget = this.activeTargets.get(key);
			if (activeTarget) {
				return activeTarget;
			}
		}
		if (this.hovered) {
			const hoverTarget = this.hoverTargets.get(key);
			if (hoverTarget) {
				return hoverTarget;
			}
		}
		const animateTarget = this.animateTargets.get(key);
		if (animateTarget) {
			return animateTarget;
		}
		return {
			kind: "immediate",
			value: this.baseTargets.get(key) ?? resolveDefaultBaseValue(key),
		};
	}

	private resolveInitialValueForKey(key: string): number {
		if (this.baseTargets.has(key)) {
			return this.baseTargets.get(key) as number;
		}
		return resolveDefaultBaseValue(key);
	}

	private applyTargetForKey(key: string, target: MotionTarget) {
		const shared = this.sharedValues.get(key);
		if (!shared) {
			return;
		}
		if (target.kind === "immediate") {
			cancelAnimation(shared);
			if (!isAlmostEqual(shared.value, target.value)) {
				shared.value = target.value;
			}
			const meta = this.runningMotions.get(key);
			if (meta) {
				meta.active = false;
				meta.signature = `immediate:${target.value}`;
			}
			return;
		}

		const { descriptor } = target;
		const existingMeta = this.runningMotions.get(key);
		if (existingMeta?.active && existingMeta.signature === descriptor.signature) {
			return;
		}
		const generation = (existingMeta?.generation ?? 0) + 1;
		this.runningMotions.set(key, {
			signature: descriptor.signature,
			generation,
			active: true,
		});

		const callback: AnimationCallback<number> = (finished, current) => {
			descriptor.callback?.(finished, current);
			const latest = this.runningMotions.get(key);
			if (!latest || latest.generation !== generation) {
				return;
			}
			latest.active = false;
		};

		if (descriptor.kind === "timing") {
			shared.value = withTiming(
				descriptor.toValue,
				resolveTimingConfig(descriptor.config),
				callback,
			) as number;
			return;
		}
		shared.value = withSpring(
			descriptor.toValue,
			resolveSpringConfig(descriptor.config),
			callback,
		) as number;
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
	const motionInput = nextProps.motion;

	delete nextProps.motion;
	delete nextProps.transition;
	delete nextProps.whileHover;
	delete nextProps.whileActive;
	delete nextProps.animate;

	const previousState = previousNode ? getNodeTransitionState(previousNode) : null;
	const hasMotionConfig = motionInput !== undefined && motionInput !== null;

	if (!hasMotionConfig) {
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
		motionInput,
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
