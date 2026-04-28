import { useEffect, useMemo, useRef, useState } from "react";
import type { Mutable, SharedValue } from "./types";
import { Color as normalizeColor } from "../../skia/web/JsiSkColor";

export type EasingFunction = (value: number) => number;

export interface WithTimingConfig {
	duration?: number;
	easing?: EasingFunction;
}

export interface WithSpringConfig {
	stiffness?: number;
	damping?: number;
	mass?: number;
	velocity?: unknown;
	overshootClamping?: boolean;
	restDisplacementThreshold?: number;
	restSpeedThreshold?: number;
}

export type AnimationCallback<Value> = (
	finished?: boolean,
	current?: Value,
) => void;

type AnimationKind = "timing" | "spring";

interface TimingAnimationConfig extends Required<WithTimingConfig> {}

interface SpringAnimationConfig
	extends Required<Omit<WithSpringConfig, "velocity">> {
	velocity?: unknown;
}

interface AnimationDescriptor<Value> {
	kind: AnimationKind;
	toValue: Value;
	config: TimingAnimationConfig | SpringAnimationConfig;
	callback?: AnimationCallback<Value>;
	[ANIMATION_DESCRIPTOR]: true;
}

interface DependencyCollector {
	addDependency(sharedValue: SharedValue<unknown>): void;
}

type Listener<Value> = (value: Value) => void;

interface MutableHandle<Value> {
	current: Value;
	listeners: Map<number, Listener<Value>>;
	animation: RunningAnimation | null;
}

interface RunningAnimation {
	readonly completed: boolean;
	step(nowMs: number): boolean;
	cancel(): void;
}

interface ValueShape<Value> {
	dimension: number;
	read(value: Value, target: number[], offset: number): number;
	write(source: readonly number[], offset: number): [Value, number];
}

interface SharedValueObserver {
	notify(): void;
	run(): void;
	dispose(): void;
}

const ANIMATION_DESCRIPTOR = Symbol("react-skia-lite.animationDescriptor");
const MUTABLE_HANDLE = Symbol("react-skia-lite.mutableHandle");
const EPSILON = 1e-6;
const DEFAULT_TIMING_CONFIG: TimingAnimationConfig = {
	duration: 300,
	easing: (value) => value,
};
const DEFAULT_SPRING_CONFIG: SpringAnimationConfig = {
	stiffness: 900,
	damping: 120,
	mass: 1,
	velocity: undefined,
	overshootClamping: false,
	restDisplacementThreshold: 0.001,
	restSpeedThreshold: 0.001,
};

let nextInternalListenerId = 1;
let activeDependencyCollector: DependencyCollector | null = null;

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

const warnedMessages = new Set<string>();

const warnOnce = (message: string) => {
	if (!isDevelopment() || warnedMessages.has(message)) {
		return;
	}
	warnedMessages.add(message);
	console.warn(message);
};

const isFiniteNumber = (value: unknown): value is number => {
	return typeof value === "number" && Number.isFinite(value);
};

const isTypedArray = (value: unknown): value is Float32Array => {
	return value instanceof Float32Array;
};

const isArrayLike = (
	value: unknown,
): value is readonly unknown[] | Float32Array => {
	return Array.isArray(value) || isTypedArray(value);
};

const isObjectLike = (value: unknown): value is Record<string, unknown> => {
	return typeof value === "object" && value !== null;
};

const isCssColorString = (value: string) => {
	if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
		return CSS.supports("color", value);
	}
	const candidate = value.trim().toLowerCase();
	return (
		candidate.startsWith("#") ||
		candidate.startsWith("rgb(") ||
		candidate.startsWith("rgba(") ||
		candidate.startsWith("hsl(") ||
		candidate.startsWith("hsla(") ||
		candidate.startsWith("hwb(") ||
		candidate.startsWith("lab(") ||
		candidate.startsWith("lch(") ||
		candidate.startsWith("oklab(") ||
		candidate.startsWith("oklch(") ||
		candidate.startsWith("color(")
	);
};

const isColorLike = (value: unknown) => {
	if (typeof value === "number") {
		return Number.isInteger(value);
	}
	if (typeof value === "string") {
		return isCssColorString(value);
	}
	if (isTypedArray(value)) {
		return value.length === 3 || value.length === 4;
	}
	if (Array.isArray(value)) {
		return (
			(value.length === 3 || value.length === 4) &&
			value.every((entry) => isFiniteNumber(entry))
		);
	}
	return false;
};

const toRoundedByte = (value: number) => {
	return Math.min(255, Math.max(0, Math.round(value * 255)));
};

const toRoundedAlpha = (value: number) => {
	return Math.min(1, Math.max(0, Number(value.toFixed(4))));
};

const normalizeColorVector = (value: unknown) => {
	if (!isColorLike(value)) {
		return null;
	}
	const normalized = normalizeColor(
		value as Parameters<typeof normalizeColor>[0],
	);
	const channels = Array.from(normalized);
	if (channels.length === 3) {
		return [channels[0] ?? 0, channels[1] ?? 0, channels[2] ?? 0, 1];
	}
	if (channels.length >= 4) {
		return [
			channels[0] ?? 0,
			channels[1] ?? 0,
			channels[2] ?? 0,
			channels[3] ?? 1,
		];
	}
	return null;
};

const createTemplateObject = (template: unknown) => {
	if (!isObjectLike(template)) {
		return {};
	}
	const prototype = Object.getPrototypeOf(template);
	return Object.create(prototype ?? Object.prototype) as Record<
		string,
		unknown
	>;
};

const createColorShape = (template: unknown): ValueShape<unknown> => {
	return {
		dimension: 4,
		read(value, target, offset) {
			const channels = normalizeColorVector(value) ?? [0, 0, 0, 1];
			target[offset] = channels[0] ?? 0;
			target[offset + 1] = channels[1] ?? 0;
			target[offset + 2] = channels[2] ?? 0;
			target[offset + 3] = channels[3] ?? 1;
			return offset + 4;
		},
		write(source, offset) {
			const channels = [
				source[offset] ?? 0,
				source[offset + 1] ?? 0,
				source[offset + 2] ?? 0,
				source[offset + 3] ?? 1,
			] as const;
			if (typeof template === "string") {
				return [
					`rgba(${toRoundedByte(channels[0])}, ${toRoundedByte(
						channels[1],
					)}, ${toRoundedByte(channels[2])}, ${toRoundedAlpha(channels[3])})`,
					offset + 4,
				];
			}
			if (typeof template === "number") {
				const alpha = toRoundedByte(channels[3]);
				const red = toRoundedByte(channels[0]);
				const green = toRoundedByte(channels[1]);
				const blue = toRoundedByte(channels[2]);
				return [
					((alpha << 24) | (red << 16) | (green << 8) | blue) >>> 0,
					offset + 4,
				];
			}
			if (isTypedArray(template)) {
				return [Float32Array.of(...channels), offset + 4];
			}
			if (Array.isArray(template)) {
				return [[...channels], offset + 4];
			}
			return [Float32Array.of(...channels), offset + 4];
		},
	};
};

const createNumberShape = (): ValueShape<number> => {
	return {
		dimension: 1,
		read(value, target, offset) {
			target[offset] = Number(value);
			return offset + 1;
		},
		write(source, offset) {
			return [source[offset] ?? 0, offset + 1];
		},
	};
};

const createConstantShape = (value: unknown): ValueShape<unknown> => {
	return {
		dimension: 0,
		read(_value, _target, offset) {
			return offset;
		},
		write(_source, offset) {
			return [value, offset];
		},
	};
};

const createArrayShape = (
	template: readonly unknown[] | Float32Array,
	children: ValueShape<unknown>[],
): ValueShape<unknown> => {
	const dimension = children.reduce((sum, child) => sum + child.dimension, 0);
	return {
		dimension,
		read(value, target, offset) {
			const list = Array.from(value as readonly unknown[]);
			let nextOffset = offset;
			for (let index = 0; index < children.length; index += 1) {
				nextOffset = children[index]!.read(list[index], target, nextOffset);
			}
			return nextOffset;
		},
		write(source, offset) {
			let nextOffset = offset;
			const values: unknown[] = [];
			for (const child of children) {
				const [nextValue, resolvedOffset] = child.write(source, nextOffset);
				values.push(nextValue);
				nextOffset = resolvedOffset;
			}
			if (isTypedArray(template)) {
				return [Float32Array.from(values as number[]), nextOffset];
			}
			return [values, nextOffset];
		},
	};
};

const createObjectShape = (
	template: Record<string, unknown>,
	keys: string[],
	children: Record<string, ValueShape<unknown>>,
): ValueShape<unknown> => {
	const dimension = keys.reduce(
		(sum, key) => sum + (children[key]?.dimension ?? 0),
		0,
	);
	return {
		dimension,
		read(value, target, offset) {
			const candidate = value as Record<string, unknown>;
			let nextOffset = offset;
			for (const key of keys) {
				nextOffset = children[key]!.read(candidate[key], target, nextOffset);
			}
			return nextOffset;
		},
		write(source, offset) {
			const result = createTemplateObject(template);
			let nextOffset = offset;
			for (const key of keys) {
				const [nextValue, resolvedOffset] = children[key]!.write(
					source,
					nextOffset,
				);
				result[key] = nextValue;
				nextOffset = resolvedOffset;
			}
			return [result, nextOffset];
		},
	};
};

const buildValueShape = (
	fromValue: unknown,
	toValue: unknown,
	path: string,
): ValueShape<unknown> | null => {
	if (isFiniteNumber(fromValue) && isFiniteNumber(toValue)) {
		return createNumberShape();
	}

	if (isColorLike(fromValue) && isColorLike(toValue)) {
		return createColorShape(toValue);
	}

	if (isArrayLike(fromValue) && isArrayLike(toValue)) {
		const fromEntries = Array.from(fromValue);
		const toEntries = Array.from(toValue);
		if (fromEntries.length !== toEntries.length) {
			return null;
		}
		const children: ValueShape<unknown>[] = [];
		for (let index = 0; index < fromEntries.length; index += 1) {
			const child = buildValueShape(
				fromEntries[index],
				toEntries[index],
				`${path}[${index}]`,
			);
			if (!child) {
				return null;
			}
			children.push(child);
		}
		return createArrayShape(toValue, children);
	}

	if (isObjectLike(fromValue) && isObjectLike(toValue)) {
		const fromKeys = Object.keys(fromValue).sort();
		const toKeys = Object.keys(toValue).sort();
		if (
			fromKeys.length !== toKeys.length ||
			fromKeys.some((key, index) => key !== toKeys[index])
		) {
			return null;
		}
		const children: Record<string, ValueShape<unknown>> = {};
		for (const key of toKeys) {
			const child = buildValueShape(
				fromValue[key],
				toValue[key],
				path ? `${path}.${key}` : key,
			);
			if (!child) {
				return null;
			}
			children[key] = child;
		}
		return createObjectShape(toValue, toKeys, children);
	}

	if (Object.is(fromValue, toValue)) {
		return createConstantShape(toValue);
	}

	return null;
};

const fillVector = (shape: ValueShape<unknown>, value: unknown) => {
	const target = new Array<number>(shape.dimension);
	shape.read(value, target, 0);
	return target;
};

const materializeValue = <Value>(
	shape: ValueShape<unknown>,
	vector: readonly number[],
): Value => {
	const [value] = shape.write(vector, 0);
	return value as Value;
};

const vectorsAlmostEqual = (
	left: readonly number[],
	right: readonly number[],
) => {
	if (left.length !== right.length) {
		return false;
	}
	for (let index = 0; index < left.length; index += 1) {
		if (Math.abs((left[index] ?? 0) - (right[index] ?? 0)) > EPSILON) {
			return false;
		}
	}
	return true;
};

const valuesAlmostEqual = (left: unknown, right: unknown) => {
	if (Object.is(left, right)) {
		return true;
	}
	const shape = buildValueShape(left, right, "");
	if (!shape) {
		return false;
	}
	const leftVector = fillVector(shape, left);
	const rightVector = fillVector(shape, right);
	return vectorsAlmostEqual(leftVector, rightVector);
};

const ensureCompatibleShape = <Value>(
	current: Value,
	target: Value,
	animationName: AnimationKind,
) => {
	const shape = buildValueShape(current, target, "");
	if (!shape) {
		warnOnce(
			`[react-skia-lite] ${animationName} received incompatible value shapes. Falling back to immediate assignment.`,
		);
		return null;
	}
	return shape;
};

class RuntimeCoordinator {
	private dirtyValues = new Set<MutableHandle<unknown>>();
	private dirtyObservers = new Set<SharedValueObserver>();
	private activeAnimations = new Set<RunningAnimation>();
	private frameCallbacks = new Set<() => void>();
	private frameHandle: number | ReturnType<typeof setTimeout> | null = null;
	private isTicking = false;

	markValueDirty(handle: MutableHandle<unknown>) {
		this.dirtyValues.add(handle);
		this.ensureFrame();
	}

	markObserverDirty(observer: SharedValueObserver) {
		this.dirtyObservers.add(observer);
		this.ensureFrame();
	}

	addAnimation(animation: RunningAnimation) {
		this.activeAnimations.add(animation);
		this.ensureFrame();
	}

	removeAnimation(animation: RunningAnimation) {
		this.activeAnimations.delete(animation);
	}

	scheduleFrameCallback(callback: () => void) {
		this.frameCallbacks.add(callback);
		this.ensureFrame();
	}

	private ensureFrame() {
		if (this.frameHandle !== null || this.isTicking) {
			return;
		}
		if (typeof globalThis.requestAnimationFrame === "function") {
			this.frameHandle = globalThis.requestAnimationFrame(this.tick);
			return;
		}
		this.frameHandle = setTimeout(() => {
			this.tick(Date.now());
		}, 16);
	}

	private tick = (now: number) => {
		this.frameHandle = null;
		this.isTicking = true;
		const nowMs = Number.isFinite(now) ? now : Date.now();
		if (this.activeAnimations.size > 0) {
			for (const animation of [...this.activeAnimations]) {
				const done = animation.step(nowMs);
				if (done) {
					this.activeAnimations.delete(animation);
				}
			}
		}
		this.flushPendingWork();
		this.isTicking = false;
		if (
			this.activeAnimations.size > 0 ||
			this.dirtyValues.size > 0 ||
			this.dirtyObservers.size > 0 ||
			this.frameCallbacks.size > 0
		) {
			this.ensureFrame();
		}
	};

	private flushPendingWork() {
		let guard = 0;
		while (
			(this.dirtyValues.size > 0 || this.dirtyObservers.size > 0) &&
			guard < 100
		) {
			guard += 1;
			if (this.dirtyValues.size > 0) {
				const dirtyValues = [...this.dirtyValues];
				this.dirtyValues.clear();
				for (const handle of dirtyValues) {
					for (const listener of handle.listeners.values()) {
						listener(handle.current);
					}
				}
			}
			if (this.dirtyObservers.size > 0) {
				const dirtyObservers = [...this.dirtyObservers];
				this.dirtyObservers.clear();
				for (const observer of dirtyObservers) {
					observer.run();
				}
			}
		}
		if (guard >= 100) {
			warnOnce(
				"[react-skia-lite] animation graph exceeded the maximum flush depth.",
			);
		}
		if (this.frameCallbacks.size === 0) {
			return;
		}
		const callbacks = [...this.frameCallbacks];
		this.frameCallbacks.clear();
		for (const callback of callbacks) {
			callback();
		}
	}
}

const runtimeCoordinator = new RuntimeCoordinator();

export const scheduleAnimationFrameTask = (callback: () => void) => {
	runtimeCoordinator.scheduleFrameCallback(callback);
};

const getMutableHandle = <Value>(sharedValue: SharedValue<Value>) => {
	if (!isObjectLike(sharedValue) || !(MUTABLE_HANDLE in sharedValue)) {
		return null;
	}
	return (
		sharedValue as SharedValue<Value> & {
			[MUTABLE_HANDLE]: MutableHandle<Value>;
		}
	)[MUTABLE_HANDLE];
};

const trackSharedValueRead = (sharedValue: SharedValue<unknown>) => {
	activeDependencyCollector?.addDependency(sharedValue);
};

const cancelMutableAnimation = <Value>(handle: MutableHandle<Value>) => {
	const runningAnimation = handle.animation;
	if (!runningAnimation) {
		return;
	}
	handle.animation = null;
	runtimeCoordinator.removeAnimation(runningAnimation);
	runningAnimation.cancel();
};

const updateMutableValue = <Value>(
	handle: MutableHandle<Value>,
	nextValue: Value,
	forceUpdate = false,
) => {
	if (!forceUpdate && valuesAlmostEqual(handle.current, nextValue)) {
		handle.current = nextValue;
		return;
	}
	handle.current = nextValue;
	runtimeCoordinator.markValueDirty(handle as MutableHandle<unknown>);
};

class TimingAnimation<Value> implements RunningAnimation {
	readonly completed: boolean;
	readonly callback?: AnimationCallback<Value>;
	private readonly shape: ValueShape<unknown>;
	private readonly fromVector: number[];
	private readonly toVector: number[];
	private readonly durationMs: number;
	private readonly easing: EasingFunction;
	private startTimeMs: number | null = null;
	private cancelled = false;

	constructor(
		private handle: MutableHandle<Value>,
		toValue: Value,
		config: TimingAnimationConfig,
		callback?: AnimationCallback<Value>,
	) {
		this.callback = callback;
		const shape = ensureCompatibleShape(handle.current, toValue, "timing");
		if (!shape) {
			updateMutableValue(handle, toValue);
			callback?.(true, toValue);
			this.shape = createConstantShape(toValue);
			this.fromVector = [];
			this.toVector = [];
			this.durationMs = 0;
			this.easing = config.easing;
			this.completed = true;
			return;
		}
		this.shape = shape;
		this.fromVector = fillVector(shape, handle.current);
		this.toVector = fillVector(shape, toValue);
		this.durationMs = Math.max(0, config.duration);
		this.easing = config.easing;
		this.completed =
			vectorsAlmostEqual(this.fromVector, this.toVector) ||
			this.durationMs === 0;
		if (this.completed) {
			updateMutableValue(handle, toValue);
			callback?.(true, toValue);
		}
	}

	step(nowMs: number) {
		if (this.cancelled || this.completed) {
			return true;
		}
		if (this.startTimeMs === null) {
			this.startTimeMs = nowMs;
		}
		const elapsed = Math.max(0, nowMs - this.startTimeMs);
		const progress = Math.min(1, elapsed / this.durationMs);
		const eased = this.easing(progress);
		const nextVector = this.fromVector.map((from, index) => {
			const to = this.toVector[index] ?? from;
			return from + (to - from) * eased;
		});
		const nextValue = materializeValue<Value>(this.shape, nextVector);
		updateMutableValue(this.handle, nextValue);
		if (progress >= 1) {
			this.callback?.(true, nextValue);
			return true;
		}
		return false;
	}

	cancel() {
		this.cancelled = true;
		this.callback?.(false, this.handle.current);
	}
}

class SpringAnimation<Value> implements RunningAnimation {
	readonly completed: boolean;
	readonly callback?: AnimationCallback<Value>;
	private readonly shape: ValueShape<unknown>;
	private readonly targetVector: number[];
	private readonly currentVector: number[];
	private readonly velocityVector: number[];
	private readonly config: SpringAnimationConfig;
	private cancelled = false;
	private lastTimeMs: number | null = null;

	constructor(
		private handle: MutableHandle<Value>,
		toValue: Value,
		config: SpringAnimationConfig,
		callback?: AnimationCallback<Value>,
	) {
		this.callback = callback;
		const shape = ensureCompatibleShape(handle.current, toValue, "spring");
		if (!shape) {
			updateMutableValue(handle, toValue);
			callback?.(true, toValue);
			this.shape = createConstantShape(toValue);
			this.targetVector = [];
			this.currentVector = [];
			this.velocityVector = [];
			this.config = config;
			this.completed = true;
			return;
		}
		this.shape = shape;
		this.targetVector = fillVector(shape, toValue);
		this.currentVector = fillVector(shape, handle.current);
		this.velocityVector = resolveVelocityVector(
			config.velocity,
			this.currentVector.length,
		);
		this.config = config;
		this.completed = vectorsAlmostEqual(this.currentVector, this.targetVector);
		if (this.completed) {
			updateMutableValue(handle, toValue);
			callback?.(true, toValue);
		}
	}

	step(nowMs: number) {
		if (this.cancelled) {
			return true;
		}
		if (this.lastTimeMs === null) {
			this.lastTimeMs = nowMs;
		}
		const dtSeconds = Math.max(
			0.001,
			Math.min(0.064, (nowMs - this.lastTimeMs) / 1000),
		);
		this.lastTimeMs = nowMs;
		let finished = true;
		for (let index = 0; index < this.currentVector.length; index += 1) {
			const position = this.currentVector[index] ?? 0;
			const target = this.targetVector[index] ?? 0;
			const velocity = this.velocityVector[index] ?? 0;
			const displacement = position - target;
			const springForce = -this.config.stiffness * displacement;
			const dampingForce = -this.config.damping * velocity;
			const acceleration = (springForce + dampingForce) / this.config.mass;
			let nextVelocity = velocity + acceleration * dtSeconds;
			let nextPosition = position + nextVelocity * dtSeconds;

			if (
				this.config.overshootClamping &&
				(position - target) * (nextPosition - target) <= 0
			) {
				nextPosition = target;
				nextVelocity = 0;
			}

			this.currentVector[index] = nextPosition;
			this.velocityVector[index] = nextVelocity;

			const withinDisplacement =
				Math.abs(nextPosition - target) <=
				this.config.restDisplacementThreshold;
			const withinSpeed =
				Math.abs(nextVelocity) <= this.config.restSpeedThreshold;
			if (!withinDisplacement || !withinSpeed) {
				finished = false;
			}
		}

		if (finished) {
			for (let index = 0; index < this.currentVector.length; index += 1) {
				this.currentVector[index] = this.targetVector[index] ?? 0;
				this.velocityVector[index] = 0;
			}
		}

		const nextValue = materializeValue<Value>(this.shape, this.currentVector);
		updateMutableValue(this.handle, nextValue, finished);
		if (finished) {
			this.callback?.(true, nextValue);
		}
		return finished;
	}

	cancel() {
		this.cancelled = true;
		this.callback?.(false, this.handle.current);
	}
}

const resolveVelocityVector = (velocity: unknown, dimension: number) => {
	if (velocity === undefined) {
		return new Array<number>(dimension).fill(0);
	}
	if (isFiniteNumber(velocity)) {
		return new Array<number>(dimension).fill(velocity);
	}
	const velocityShape = buildValueShape(velocity, velocity, "");
	if (!velocityShape || velocityShape.dimension !== dimension) {
		return new Array<number>(dimension).fill(0);
	}
	return fillVector(velocityShape, velocity);
};

const isAnimationDescriptor = <Value>(
	value: unknown,
): value is AnimationDescriptor<Value> => {
	return (
		isObjectLike(value) &&
		ANIMATION_DESCRIPTOR in value &&
		value[ANIMATION_DESCRIPTOR] === true
	);
};

const startAnimation = <Value>(
	handle: MutableHandle<Value>,
	descriptor: AnimationDescriptor<Value>,
) => {
	cancelMutableAnimation(handle);
	if (descriptor.kind === "timing") {
		const animation = new TimingAnimation(
			handle,
			descriptor.toValue,
			descriptor.config as TimingAnimationConfig,
			descriptor.callback,
		);
		if (animation.completed) {
			return;
		}
		handle.animation = animation;
		runtimeCoordinator.addAnimation(animation);
		return;
	}
	const animation = new SpringAnimation(
		handle,
		descriptor.toValue,
		descriptor.config as SpringAnimationConfig,
		descriptor.callback,
	);
	if (animation.completed) {
		return;
	}
	handle.animation = animation;
	runtimeCoordinator.addAnimation(animation);
};

const assignMutable = <Value>(
	handle: MutableHandle<Value>,
	nextValue: Value | AnimationDescriptor<Value>,
	forceUpdate = false,
) => {
	if (isAnimationDescriptor<Value>(nextValue)) {
		startAnimation(handle, nextValue);
		return;
	}
	cancelMutableAnimation(handle);
	updateMutableValue(handle, nextValue, forceUpdate);
};

const createMutableObject = <Value>(initialValue: Value) => {
	const handle: MutableHandle<Value> = {
		current: initialValue,
		listeners: new Map(),
		animation: null,
	};

	const sharedValue = {
		_isSharedValue: true,
		get() {
			trackSharedValueRead(sharedValue);
			return handle.current;
		},
		set(value: Value | ((value: Value) => Value)) {
			const nextValue =
				typeof value === "function"
					? (value as (current: Value) => Value)(handle.current)
					: value;
			assignMutable(handle, nextValue as Value);
		},
		addListener(listenerID: number, listener: Listener<Value>) {
			handle.listeners.set(listenerID, listener);
		},
		removeListener(listenerID: number) {
			handle.listeners.delete(listenerID);
		},
		modify(modifier?: <T extends Value>(value: T) => T, forceUpdate?: boolean) {
			const nextValue = modifier
				? modifier(handle.current as Value)
				: handle.current;
			assignMutable(handle, nextValue as Value, forceUpdate === true);
		},
	} as Mutable<Value> & { [MUTABLE_HANDLE]: MutableHandle<Value> };

	Object.defineProperty(sharedValue, MUTABLE_HANDLE, {
		value: handle,
		enumerable: false,
		configurable: false,
		writable: false,
	});

	Object.defineProperty(sharedValue, "value", {
		enumerable: true,
		configurable: false,
		get() {
			trackSharedValueRead(sharedValue);
			return handle.current;
		},
		set(nextValue: Value | AnimationDescriptor<Value>) {
			assignMutable(handle, nextValue);
		},
	});

	return sharedValue;
};

abstract class BaseObserver
	implements SharedValueObserver, DependencyCollector
{
	private dependencyIds = new Map<SharedValue<unknown>, number>();
	private scheduled = false;

	addDependency(sharedValue: SharedValue<unknown>) {
		if (this.dependencyIds.has(sharedValue)) {
			return;
		}
		this.dependencyIds.set(sharedValue, -1);
	}

	notify() {
		if (this.scheduled) {
			return;
		}
		this.scheduled = true;
		runtimeCoordinator.markObserverDirty(this);
	}

	run() {
		this.scheduled = false;
		const nextDependencies = new Set<SharedValue<unknown>>();
		const previousCollector = activeDependencyCollector;
		activeDependencyCollector = {
			addDependency(sharedValue) {
				nextDependencies.add(sharedValue);
			},
		};
		try {
			this.evaluate();
		} finally {
			activeDependencyCollector = previousCollector;
		}
		this.syncDependencies(nextDependencies);
	}

	dispose() {
		for (const [sharedValue, listenerID] of this.dependencyIds) {
			sharedValue.removeListener?.(listenerID);
		}
		this.dependencyIds.clear();
	}

	protected abstract evaluate(): void;

	private syncDependencies(nextDependencies: Set<SharedValue<unknown>>) {
		for (const [sharedValue, listenerID] of [...this.dependencyIds.entries()]) {
			if (nextDependencies.has(sharedValue)) {
				continue;
			}
			sharedValue.removeListener?.(listenerID);
			this.dependencyIds.delete(sharedValue);
		}
		for (const sharedValue of nextDependencies) {
			if (this.dependencyIds.has(sharedValue)) {
				continue;
			}
			const listenerID = nextInternalListenerId++;
			sharedValue.addListener?.(listenerID, () => {
				this.notify();
			});
			this.dependencyIds.set(sharedValue, listenerID);
		}
	}
}

class DerivedValueObserver<Value> extends BaseObserver {
	constructor(
		private readonly updater: () => Value,
		private readonly target: SharedValue<Value>,
	) {
		super();
	}

	protected evaluate() {
		const handle = getMutableHandle(this.target);
		if (!handle) {
			return;
		}
		const nextValue = this.updater();
		cancelMutableAnimation(handle);
		updateMutableValue(handle, nextValue);
	}
}

class AnimatedReactionObserver<Prepared> extends BaseObserver {
	private initialized = false;
	private previousValue: Prepared | null = null;

	constructor(
		private readonly prepare: () => Prepared,
		private readonly reaction: (
			current: Prepared,
			previous: Prepared | null,
		) => void,
	) {
		super();
	}

	protected evaluate() {
		const nextValue = this.prepare();
		if (!this.initialized) {
			this.initialized = true;
			this.previousValue = nextValue;
			return;
		}
		const previousValue = this.previousValue;
		this.previousValue = nextValue;
		this.reaction(nextValue, previousValue);
	}
}

export const makeMutable = <Value>(initialValue: Value) => {
	return createMutableObject(initialValue);
};

export const useSharedValue = <Value>(initialValue: Value) => {
	const [sharedValue] = useState(() => makeMutable(initialValue));
	return sharedValue;
};

export const useDerivedValue = <Value>(updater: () => Value) => {
	const updaterRef = useRef(updater);
	updaterRef.current = updater;
	const target = useMemo(() => makeMutable(updaterRef.current()), []);
	const observerRef = useRef<DerivedValueObserver<Value> | null>(null);
	const hasCommittedRef = useRef(false);

	useEffect(() => {
		const observer = new DerivedValueObserver(
			() => updaterRef.current(),
			target,
		);
		observerRef.current = observer;
		observer.run();
		return () => {
			observer.dispose();
			observerRef.current = null;
		};
	}, [target]);

	useEffect(() => {
		if (!hasCommittedRef.current) {
			hasCommittedRef.current = true;
			return;
		}
		observerRef.current?.run();
	});

	return target;
};

export const useAnimatedReaction = <Prepared>(
	prepare: () => Prepared,
	reaction: (current: Prepared, previous: Prepared | null) => void,
) => {
	const prepareRef = useRef(prepare);
	const reactionRef = useRef(reaction);
	const hasCommittedRef = useRef(false);
	prepareRef.current = prepare;
	reactionRef.current = reaction;
	const observerRef = useRef<AnimatedReactionObserver<Prepared> | null>(null);

	useEffect(() => {
		const observer = new AnimatedReactionObserver(
			() => prepareRef.current(),
			(current, previous) => {
				reactionRef.current(current, previous);
			},
		);
		observerRef.current = observer;
		observer.run();
		return () => {
			observer.dispose();
			observerRef.current = null;
		};
	}, []);

	useEffect(() => {
		if (!hasCommittedRef.current) {
			hasCommittedRef.current = true;
			return;
		}
		observerRef.current?.run();
	});
};

export const cancelAnimation = <Value>(sharedValue: SharedValue<Value>) => {
	const handle = getMutableHandle(sharedValue);
	if (!handle) {
		return;
	}
	cancelMutableAnimation(handle);
};

export const Easing = {
	linear: (value: number) => value,
	quad: (value: number) => value * value,
	cubic: (value: number) => value * value * value,
	ease: (value: number) => value * value * (3 - 2 * value),
	in(easing: EasingFunction) {
		return (value: number) => easing(value);
	},
	out(easing: EasingFunction) {
		return (value: number) => 1 - easing(1 - value);
	},
	inOut(easing: EasingFunction) {
		return (value: number) => {
			if (value < 0.5) {
				return easing(value * 2) / 2;
			}
			return 1 - easing((1 - value) * 2) / 2;
		};
	},
};

export const withTiming = <Value>(
	toValue: Value,
	config?: WithTimingConfig,
	callback?: AnimationCallback<Value>,
) => {
	return {
		kind: "timing",
		toValue,
		config: {
			duration: config?.duration ?? DEFAULT_TIMING_CONFIG.duration,
			easing: config?.easing ?? DEFAULT_TIMING_CONFIG.easing,
		},
		callback,
		[ANIMATION_DESCRIPTOR]: true,
	} as unknown as Value;
};

export const withSpring = <Value>(
	toValue: Value,
	config?: WithSpringConfig,
	callback?: AnimationCallback<Value>,
) => {
	return {
		kind: "spring",
		toValue,
		config: {
			stiffness: config?.stiffness ?? DEFAULT_SPRING_CONFIG.stiffness,
			damping: config?.damping ?? DEFAULT_SPRING_CONFIG.damping,
			mass: config?.mass ?? DEFAULT_SPRING_CONFIG.mass,
			velocity: config?.velocity ?? DEFAULT_SPRING_CONFIG.velocity,
			overshootClamping:
				config?.overshootClamping ?? DEFAULT_SPRING_CONFIG.overshootClamping,
			restDisplacementThreshold:
				config?.restDisplacementThreshold ??
				DEFAULT_SPRING_CONFIG.restDisplacementThreshold,
			restSpeedThreshold:
				config?.restSpeedThreshold ?? DEFAULT_SPRING_CONFIG.restSpeedThreshold,
		},
		callback,
		[ANIMATION_DESCRIPTOR]: true,
	} as unknown as Value;
};
