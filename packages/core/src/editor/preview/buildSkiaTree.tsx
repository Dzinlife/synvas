import React from "react";
import { Fill, type SkPicture } from "react-skia-lite";
import type {
	ComponentModelStore,
	RendererPrepareFrameContext,
} from "../../dsl/model/types";
import type { TimelineElement } from "../../dsl/types";
import type { TimelineTrack } from "../timeline/types";

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

export type BuildSkiaDeps = {
	resolveComponent: (componentId: string) => ResolvedComponent | undefined;
	listComponentIds?: () => string[];
	renderNodeToPicture: (
		node: React.ReactNode,
		size: { width: number; height: number },
	) => Promise<SkPicture | null>;
	isTransitionElement?: (element: TimelineElement) => boolean;
};

const defaultIsTransitionElement = (element: TimelineElement): boolean =>
	element.type === "Transition";

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
	return <TargetRenderer id={target.id} {...target.props} />;
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
	const elementsById = new Map(elements.map((el) => [el.id, el] as const));
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

	const isActiveTransition = (element: TimelineElement): boolean => {
		if (!isTransitionElement(element)) return false;
		const trackIndex = getTrackIndexForElement(element);
		if (tracks[trackIndex]?.hidden) return false;
		const transitionStart = element.timeline.start;
		const transitionEnd = element.timeline.end;
		if (displayTime < transitionStart || displayTime >= transitionEnd) {
			return false;
		}
		const { fromId, toId } = element.transition ?? {};
		if (!fromId || !toId) return false;
		const fromElement = elementsById.get(fromId);
		const toElement = elementsById.get(toId);
		if (!fromElement || !toElement) return false;
		if (isTransitionElement(fromElement) || isTransitionElement(toElement)) {
			return false;
		}
		return true;
	};

	const visibleCandidates = elements.filter((el) => {
		const trackIndex = getTrackIndexForElement(el);
		if (tracks[trackIndex]?.hidden) return false;
		const { start = 0, end = Infinity } = el.timeline;
		if (isTransitionElement(el)) {
			return isActiveTransition(el);
		}
		return displayTime >= start && displayTime < end;
	});
	const transitionHiddenIds = new Set<string>();
	for (const element of visibleCandidates) {
		if (!isTransitionElement(element)) continue;
		const { fromId, toId } = element.transition ?? {};
		if (fromId) transitionHiddenIds.add(fromId);
		if (toId) transitionHiddenIds.add(toId);
	}
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
		const content = renderElementNode(target, deps);
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
		const node = (
			<TransitionRenderer
				id={element.id}
				{...element.props}
				fromNode={fromPlan.node}
				toNode={toPlan.node}
				fromPicture={fromPicture}
				toPicture={toPicture}
			/>
		);
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
		<Fill key="background" color="transparent" />,
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
