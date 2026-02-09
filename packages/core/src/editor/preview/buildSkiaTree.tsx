import React from "react";
import { Fill, Group, Skia, type SkPicture } from "react-skia-lite";
import type {
	ComponentModelStore,
	RendererPrepareFrameContext,
} from "../../dsl/model/types";
import type { TimelineElement } from "../../dsl/types";
import type { TimelineTrack } from "../timeline/types";
import {
	type ActiveTransitionFrameState,
	resolveTransitionFrameState as resolveTransitionFrameStateCore,
	type TransitionFrameState,
} from "./transitionFrameState";

type RenderPlan = {
	node: React.ReactNode | null;
	ready: Promise<void>;
	dispose?: () => void;
};

type RenderPrepareOptions = {
	isExporting: boolean;
	fps: number;
	canvasSize: { width: number; height: number };
	getModelStore?: (id: string) => ComponentModelStore | undefined;
	prepareTransitionPictures?: boolean;
};

type ResolvedComponent = {
	Renderer: React.ComponentType<any>;
	prepareRenderFrame?: (
		context: RendererPrepareFrameContext,
	) => Promise<void> | void;
};

export type { ActiveTransitionFrameState, TransitionFrameState };
export { resolveTransitionFrameState } from "./transitionFrameState";

export type BuildSkiaDeps = {
	resolveComponent: (componentId: string) => ResolvedComponent | undefined;
	listComponentIds?: () => string[];
	renderNodeToPicture: (
		node: React.ReactNode,
		size: { width: number; height: number },
	) => SkPicture | null | Promise<SkPicture | null>;
	isTransitionElement?: (element: TimelineElement) => boolean;
};

const defaultIsTransitionElement = (element: TimelineElement): boolean =>
	element.type === "Transition";
const FILTER_ELEMENT_TYPE = "Filter";

const resolveFiniteNumber = (value: unknown, fallback: number): number => {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return value;
};

const clamp01 = (value: number): number => {
	if (!Number.isFinite(value)) return 0;
	return Math.min(1, Math.max(0, value));
};

const resolveElementVisible = (element: TimelineElement): boolean =>
	element.render?.visible !== false;

const resolveElementOpacity = (element: TimelineElement): number =>
	clamp01(resolveFiniteNumber(element.render?.opacity, 1));

const wrapWithTransform = (
	node: NonNullable<React.ReactNode>,
	target: TimelineElement,
): NonNullable<React.ReactNode> => {
	const transform = target.transform;
	if (!transform) return node;
	const baseWidth = Math.max(
		0,
		resolveFiniteNumber(transform.baseSize.width, 0),
	);
	const baseHeight = Math.max(
		0,
		resolveFiniteNumber(transform.baseSize.height, 0),
	);
	const anchorX =
		clamp01(resolveFiniteNumber(transform.anchor.x, 0.5)) * baseWidth;
	const anchorY =
		clamp01(resolveFiniteNumber(transform.anchor.y, 0.5)) * baseHeight;
	const centerX = baseWidth * 0.5;
	const centerY = baseHeight * 0.5;
	const anchorOffsetX = anchorX - centerX;
	const anchorOffsetY = anchorY - centerY;
	const positionX = resolveFiniteNumber(transform.position.x, 0);
	const positionY = resolveFiniteNumber(transform.position.y, 0);
	const scaleX = resolveFiniteNumber(transform.scale.x, 1);
	const scaleY = resolveFiniteNumber(transform.scale.y, 1);
	const rotate =
		(resolveFiniteNumber(transform.rotation.value, 0) * Math.PI) / 180;
	const matrix = Skia.Matrix();

	// position 定义为元素中心；anchor 的正反位移在渲染阶段抵消，避免修改 anchor 导致元素平移
	matrix.translate(positionX, positionY);
	matrix.translate(-anchorOffsetX, -anchorOffsetY);
	matrix.rotate(rotate);
	matrix.scale(scaleX, scaleY);
	matrix.translate(anchorOffsetX, anchorOffsetY);
	matrix.translate(-centerX, -centerY);

	return <Group matrix={matrix}>{node}</Group>;
};

const wrapElementNode = ({
	target,
	node,
	isTransitionElement,
}: {
	target: TimelineElement;
	node: React.ReactNode | null;
	isTransitionElement: (element: TimelineElement) => boolean;
}): React.ReactNode | null => {
	if (node === null || node === undefined || node === false) return null;

	let wrapped: NonNullable<React.ReactNode> = node;
	if (!isTransitionElement(target) && target.type !== FILTER_ELEMENT_TYPE) {
		wrapped = wrapWithTransform(wrapped, target);
	}

	const opacity = resolveElementOpacity(target);
	if (opacity !== 1) {
		wrapped = <Group opacity={opacity}>{wrapped}</Group>;
	}
	return wrapped;
};

const renderElementNode = (
	target: TimelineElement,
	deps: BuildSkiaDeps,
): React.ReactNode | null => {
	const componentDef = deps.resolveComponent(target.component);
	if (!componentDef) {
		console.warn(
			`[PreviewEditor] Component "${target.component}" not registered`,
		);
		if (deps.listComponentIds) {
			console.warn(
				"[PreviewEditor] Available components:",
				deps.listComponentIds(),
			);
		}
		return null;
	}
	const TargetRenderer = componentDef.Renderer;
	return <TargetRenderer key={target.id} id={target.id} {...target.props} />;
};

export const buildSkiaRenderStateCore = async (
	{
		elements,
		displayTime,
		tracks,
		getTrackIndexForElement,
		sortByTrackIndex,
		prepare,
	}: {
		elements: TimelineElement[];
		displayTime: number;
		tracks: TimelineTrack[];
		getTrackIndexForElement: (element: TimelineElement) => number;
		sortByTrackIndex: (elements: TimelineElement[]) => TimelineElement[];
		prepare?: RenderPrepareOptions;
	},
	deps: BuildSkiaDeps,
) => {
	const visibleElementsForRender = elements.filter(resolveElementVisible);
	const elementsById = new Map(
		visibleElementsForRender.map((el) => [el.id, el] as const),
	);
	const isExporting = prepare?.isExporting ?? false;
	const fps = prepare?.fps ?? 0;
	const canvasSize = prepare?.canvasSize;
	const getModelStore = prepare?.getModelStore;
	const shouldPrepareTransitionPictures =
		(prepare?.prepareTransitionPictures ?? false) || isExporting;
	const transitionPictureSize =
		shouldPrepareTransitionPictures &&
		canvasSize &&
		canvasSize.width > 0 &&
		canvasSize.height > 0
			? canvasSize
			: null;
	// 只有能生成 picture 时才需要强制准备帧
	const canRenderTransitionPictures = Boolean(transitionPictureSize);
	const isTransitionElement =
		deps.isTransitionElement ?? defaultIsTransitionElement;
	const transitionFrameState = resolveTransitionFrameStateCore({
		elements: visibleElementsForRender,
		displayTime,
		tracks,
		getTrackIndexForElement,
		isTransitionElement,
	});
	const activeTransitionIds = new Set(
		transitionFrameState.activeTransitions.map((item) => item.id),
	);
	const transitionHiddenIds = new Set(transitionFrameState.hiddenElementIds);

	const visibleCandidates = visibleElementsForRender.filter((el) => {
		const trackIndex = getTrackIndexForElement(el);
		if (tracks[trackIndex]?.hidden) return false;
		const { start = 0, end = Infinity } = el.timeline;
		if (isTransitionElement(el)) {
			return activeTransitionIds.has(el.id);
		}
		return displayTime >= start && displayTime < end;
	});
	const visibleElements = visibleCandidates.filter((el) => {
		if (isTransitionElement(el)) return true;
		return !transitionHiddenIds.has(el.id);
	});

	const orderedElements = sortByTrackIndex(visibleElements);

	const runPrepareRenderFrame = async (
		target: TimelineElement,
		extra?: Partial<RendererPrepareFrameContext>,
		force?: boolean,
	): Promise<void> => {
		// 预览态也需要强制执行，确保转场截图前视频帧已准备
		if (!isExporting && !force) return;
		const componentDef = deps.resolveComponent(target.component);
		if (!componentDef?.prepareRenderFrame) return;
		await componentDef.prepareRenderFrame({
			element: target,
			displayTime,
			fps,
			modelStore: getModelStore?.(target.id),
			getModelStore,
			canvasSize,
			...extra,
		});
	};

	const buildPlainElementPlan = (
		target: TimelineElement,
		shouldPrepare: boolean,
	): RenderPlan => {
		const content = wrapElementNode({
			target,
			node: renderElementNode(target, deps),
			isTransitionElement,
		});
		// 转场渲染需要 picture 时，提前准备帧避免画面停在旧帧
		const ready = shouldPrepare
			? runPrepareRenderFrame(target, undefined, !isExporting)
			: Promise.resolve();
		return { node: content, ready };
	};

	const buildElementPlan = async (
		element: TimelineElement,
	): Promise<RenderPlan> => {
		if (!isTransitionElement(element)) {
			return buildPlainElementPlan(element, isExporting);
		}
		const transitionDef = deps.resolveComponent(element.component);
		if (!transitionDef) {
			return { node: null, ready: Promise.resolve() };
		}
		const { fromId, toId } = element.transition ?? {};
		if (!fromId || !toId) {
			return { node: null, ready: Promise.resolve() };
		}
		const fromElement = elementsById.get(fromId);
		const toElement = elementsById.get(toId);
		if (!fromElement || !toElement) {
			return { node: null, ready: Promise.resolve() };
		}
		if (isTransitionElement(fromElement) || isTransitionElement(toElement)) {
			return { node: null, ready: Promise.resolve() };
		}
		const fromPlan = buildPlainElementPlan(
			fromElement,
			canRenderTransitionPictures,
		);
		const toPlan = buildPlainElementPlan(
			toElement,
			canRenderTransitionPictures,
		);
		const elementReady = Promise.all([fromPlan.ready, toPlan.ready]);
		let fromPicture: SkPicture | null = null;
		let toPicture: SkPicture | null = null;
		let dispose: (() => void) | undefined;
		if (transitionPictureSize) {
			await elementReady;
			const [fromRendered, toRendered] = await Promise.all([
				fromPlan.node
					? deps.renderNodeToPicture(fromPlan.node, transitionPictureSize)
					: Promise.resolve(null),
				toPlan.node
					? deps.renderNodeToPicture(toPlan.node, transitionPictureSize)
					: Promise.resolve(null),
			]);
			fromPicture = fromRendered;
			toPicture = toRendered;
			if (fromRendered || toRendered) {
				dispose = () => {
					fromRendered?.dispose();
					toRendered?.dispose();
				};
			}
		}
		const TransitionRenderer = transitionDef.Renderer;
		const transitionNode = (
			<TransitionRenderer
				key={element.id}
				id={element.id}
				{...element.props}
				fromNode={fromPlan.node}
				toNode={toPlan.node}
				fromPicture={fromPicture}
				toPicture={toPicture}
			/>
		);
		const node = wrapElementNode({
			target: element,
			node: transitionNode,
			isTransitionElement,
		});
		const ready = Promise.all([
			elementReady,
			runPrepareRenderFrame(element, {
				fromNode: fromPlan.node,
				toNode: toPlan.node,
			}),
		]).then(() => undefined);
		return { node, ready, dispose };
	};

	const plans = await Promise.all(orderedElements.map(buildElementPlan));

	const children = [
		<Fill key="background" color="black" />,
		...plans.map((plan) => plan.node),
	];

	const ready = isExporting
		? Promise.all(plans.map((plan) => plan.ready)).then(() => undefined)
		: Promise.resolve();
	const dispose = () => {
		for (const plan of plans) {
			plan.dispose?.();
		}
	};

	return {
		children,
		orderedElements,
		visibleElements,
		transitionFrameState,
		ready,
		dispose,
	};
};

export const buildSkiaTreeCore = async (
	args: {
		elements: TimelineElement[];
		displayTime: number;
		tracks: TimelineTrack[];
		getTrackIndexForElement: (element: TimelineElement) => number;
		sortByTrackIndex: (elements: TimelineElement[]) => TimelineElement[];
		prepare?: RenderPrepareOptions;
	},
	deps: BuildSkiaDeps,
) => {
	const { children, orderedElements, dispose } = await buildSkiaRenderStateCore(
		args,
		deps,
	);
	return { children, orderedElements, dispose };
};
