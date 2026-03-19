import React from "react";
import {
	Fill,
	Group,
	Picture,
	RenderTarget,
	Skia,
	getSkiaRenderBackend,
	type SkImage,
	type SkPicture,
} from "react-skia-lite";
import type {
	ComponentModelStore,
	RenderFrameChannel,
	RendererPrepareFrameContext,
} from "../../element/model/types";
import { transformPositionToCanvasPoint } from "../../element/position";
import type { TimelineElement } from "../../element/types";
import type { TimelineTrack } from "../timeline/types";
import { createDisposeScope, type DisposeScope } from "./disposeScope";
import {
	type ActiveTransitionFrameState,
	resolveTransitionFrameState as resolveTransitionFrameStateCore,
	type TransitionFrameState,
} from "./transitionFrameState";

type RenderPlan = {
	node: React.ReactNode | null;
	ready: Promise<void>;
};

type RenderPrepareOptions = {
	isExporting: boolean;
	fps: number;
	canvasSize: { width: number; height: number };
	getModelStore?: (id: string) => ComponentModelStore | undefined;
	prepareTransitionPictures?: boolean;
	forcePrepareFrames?: boolean;
	awaitReady?: boolean;
	compositionPath?: string[];
	maxCompositionDepth?: number;
	frameChannel?: RenderFrameChannel;
};

type ResolvedComponent = {
	Renderer: React.ComponentType<any>;
	prepareRenderFrame?: (
		context: RendererPrepareFrameContext,
	) => Promise<void> | void;
	transitionInputMode?: "node" | "texture";
};

type ResolvedCompositionTimeline = {
	sceneId: string;
	elements: TimelineElement[];
	tracks: TimelineTrack[];
	fps: number;
	canvasSize: { width: number; height: number };
	getModelStore?: (id: string) => ComponentModelStore | undefined;
	wrapRenderNode?: (node: React.ReactNode) => React.ReactNode;
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
	renderNodeToImage?: (
		node: React.ReactNode,
		size: { width: number; height: number },
	) => SkImage | null | Promise<SkImage | null>;
	isTransitionElement?: (element: TimelineElement) => boolean;
	resolveCompositionTimeline?: (
		sceneId: string,
	) => ResolvedCompositionTimeline | null | Promise<ResolvedCompositionTimeline | null>;
};

const defaultIsTransitionElement = (element: TimelineElement): boolean =>
	element.type === "Transition";
const FILTER_ELEMENT_TYPE = "Filter";
const COMPOSITION_ELEMENT_TYPE = "Composition";
const DEFAULT_MAX_COMPOSITION_DEPTH = 16;
const DEFAULT_RENDER_FRAME_CHANNEL: RenderFrameChannel = "current";

const waitForModelReady = async (
	modelStore?: ComponentModelStore,
): Promise<void> => {
	if (!modelStore) return;
	const waitForReady = modelStore.getState().waitForReady;
	if (!waitForReady) return;
	await waitForReady();
};

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

const resolveSafeFps = (value: number, fallback = 30): number => {
	const rounded = Math.round(value);
	if (!Number.isFinite(rounded) || rounded <= 0) {
		return Math.max(1, Math.round(fallback));
	}
	return rounded;
};

const resolveCompositionSceneId = (element: TimelineElement): string | null => {
	if (element.type !== COMPOSITION_ELEMENT_TYPE) return null;
	const sceneId = (element.props as { sceneId?: unknown } | undefined)?.sceneId;
	if (typeof sceneId !== "string") return null;
	const trimmed = sceneId.trim();
	return trimmed.length > 0 ? trimmed : null;
};

const resolveRenderFrameChannel = (
	value: RenderFrameChannel | undefined,
): RenderFrameChannel => {
	return value === "offscreen"
		? "offscreen"
		: DEFAULT_RENDER_FRAME_CHANNEL;
};

const wrapWithTransform = (
	node: NonNullable<React.ReactNode>,
	target: TimelineElement,
	canvasSize?: { width: number; height: number },
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
	const rawPositionX = resolveFiniteNumber(transform.position.x, 0);
	const rawPositionY = resolveFiniteNumber(transform.position.y, 0);
	let positionX = rawPositionX;
	let positionY = rawPositionY;
	if (canvasSize && canvasSize.width > 0 && canvasSize.height > 0) {
		const converted = transformPositionToCanvasPoint(
			rawPositionX,
			rawPositionY,
			canvasSize,
			canvasSize,
		);
		positionX = converted.canvasX;
		positionY = converted.canvasY;
	}
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

	return (
		<Group matrix={matrix} key={target.id}>
			{node}
		</Group>
	);
};

const wrapElementNode = ({
	target,
	node,
	isTransitionElement,
	canvasSize,
}: {
	target: TimelineElement;
	node: React.ReactNode | null;
	isTransitionElement: (element: TimelineElement) => boolean;
	canvasSize?: { width: number; height: number };
}): React.ReactNode | null => {
	if (node === null || node === undefined || node === false) return null;

	let wrapped: NonNullable<React.ReactNode> = node;
	if (!isTransitionElement(target) && target.type !== FILTER_ELEMENT_TYPE) {
		wrapped = wrapWithTransform(wrapped, target, canvasSize);
	}

	const opacity = resolveElementOpacity(target);
	if (opacity !== 1) {
		wrapped = (
			<Group opacity={opacity} key={target.id}>
				{wrapped}
			</Group>
		);
	}
	return wrapped;
};

const renderElementNode = (
	target: TimelineElement,
	deps: BuildSkiaDeps,
	options?: {
		disableRuntimePlaybackEffects?: boolean;
		frameChannel?: RenderFrameChannel;
	},
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
	const runtimeProps =
		target.type === "VideoClip"
			? {
					...(options?.disableRuntimePlaybackEffects
						? { __disableRuntimePlaybackEffects: true }
						: {}),
					...(options?.frameChannel
						? { __frameChannel: options.frameChannel }
						: {}),
				}
			: {};
	return (
		<TargetRenderer
			key={target.id}
			id={target.id}
			{...target.props}
			{...runtimeProps}
		/>
	);
};

const buildSkiaRenderStateWithScopeCore = async (
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
	scope: DisposeScope,
) => {
	const visibleElementsForRender = elements.filter(resolveElementVisible);
	const elementsById = new Map(
		visibleElementsForRender.map((el) => [el.id, el] as const),
	);
	const isExporting = prepare?.isExporting ?? false;
	const forcePrepareFrames = prepare?.forcePrepareFrames ?? false;
	const fps = prepare?.fps ?? 0;
	const canvasSize = prepare?.canvasSize;
	const getModelStore = prepare?.getModelStore;
	const compositionPath = prepare?.compositionPath ?? [];
	const maxCompositionDepth = Math.max(
		1,
		Math.round(
			resolveFiniteNumber(
				prepare?.maxCompositionDepth,
				DEFAULT_MAX_COMPOSITION_DEPTH,
			),
		),
	);
	const shouldAwaitReady = isExporting || (prepare?.awaitReady ?? false);
	const frameChannel = resolveRenderFrameChannel(prepare?.frameChannel);
	const renderBackend = getSkiaRenderBackend();
	const shouldUseLiveComposition = renderBackend.kind === "webgpu";
	const shouldPrepareTransitionPictures =
		(prepare?.prepareTransitionPictures ?? false) || isExporting;
	const transitionPictureSize =
		shouldPrepareTransitionPictures &&
		canvasSize &&
		canvasSize.width > 0 &&
		canvasSize.height > 0
			? canvasSize
			: null;
	// 只有能生成转场纹理时才需要强制准备帧
	const canRenderTransitionTextures = Boolean(transitionPictureSize);
	const isTransitionElement =
		deps.isTransitionElement ?? defaultIsTransitionElement;
	const transitionFrameState = resolveTransitionFrameStateCore({
		elements: visibleElementsForRender,
		displayTime,
		tracks,
		getTrackIndexForElement,
		isTransitionElement,
	});
	const activeTransitionById = new Map(
		transitionFrameState.activeTransitions.map((item) => [item.id, item] as const),
	);
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
		const modelStore = getModelStore?.(target.id);
		if (shouldAwaitReady) {
			// awaitReady 语义优先等待模型就绪，避免首帧提前构图导致黑屏。
			await waitForModelReady(modelStore);
		}
		// 预览态可通过 forcePrepareFrames 触发，确保截图前视频帧已准备
		if (!isExporting && !forcePrepareFrames && !force) return;
		const componentDef = deps.resolveComponent(target.component);
		if (!componentDef?.prepareRenderFrame) return;
		await componentDef.prepareRenderFrame({
			element: target,
			displayTime,
			fps,
			frameChannel,
			modelStore,
			getModelStore,
			canvasSize,
			...extra,
		});
	};

	const buildPlainElementPlan = (
		target: TimelineElement,
		shouldPrepare: boolean,
	): RenderPlan => {
		const shouldRunReadyPipeline =
			shouldPrepare || forcePrepareFrames || shouldAwaitReady;
		const content = wrapElementNode({
			target,
			node: renderElementNode(target, deps, {
				disableRuntimePlaybackEffects: shouldRunReadyPipeline,
				frameChannel,
			}),
			isTransitionElement,
			canvasSize,
		});
		// 转场渲染或强制准备时，提前准备帧避免画面停在旧帧
		const ready = shouldRunReadyPipeline
			? runPrepareRenderFrame(
					target,
					undefined,
					shouldPrepare ? !isExporting : undefined,
				)
			: Promise.resolve();
		return { node: content, ready };
	};

	const buildElementPlan = async (
		element: TimelineElement,
	): Promise<RenderPlan> => {
		if (element.type === COMPOSITION_ELEMENT_TYPE) {
			const sceneId = resolveCompositionSceneId(element);
			if (!sceneId) {
				console.warn(
					`[PreviewEditor] Composition "${element.id}" missing props.sceneId`,
				);
				return { node: null, ready: Promise.resolve() };
			}
			if (compositionPath.includes(sceneId)) {
				console.warn(
					`[PreviewEditor] Skip recursive Composition "${element.id}" -> "${sceneId}"`,
				);
				return { node: null, ready: Promise.resolve() };
			}
			if (compositionPath.length >= maxCompositionDepth) {
				console.warn(
					`[PreviewEditor] Skip Composition "${element.id}" because max depth (${maxCompositionDepth}) is reached`,
				);
				return { node: null, ready: Promise.resolve() };
			}
			if (!deps.resolveCompositionTimeline) {
				return { node: null, ready: Promise.resolve() };
			}
			try {
				const compositionTimeline =
					await deps.resolveCompositionTimeline(sceneId);
				if (!compositionTimeline) {
					return { node: null, ready: Promise.resolve() };
				}
				const compositionDeps: BuildSkiaDeps =
					typeof compositionTimeline.wrapRenderNode === "function"
						? {
								...deps,
								renderNodeToPicture: (node, size) =>
									deps.renderNodeToPicture(
										compositionTimeline.wrapRenderNode?.(node) ?? node,
										size,
									),
							}
						: deps;
				const parentFps = resolveSafeFps(fps);
				const childFps = resolveSafeFps(compositionTimeline.fps, parentFps);
				const compositionStart = resolveFiniteNumber(
					element.timeline.start,
					0,
				);
				const compositionOffset = Math.max(
					0,
					Math.round(resolveFiniteNumber(element.timeline.offset, 0)),
				);
				const localFrames = Math.max(
					0,
					displayTime - compositionStart + compositionOffset,
				);
				const localSeconds = localFrames / parentFps;
				const childDisplayTime = Math.max(
					0,
					Math.round(localSeconds * childFps),
				);
				const childCanvasWidth = Math.max(
					1,
					resolveFiniteNumber(compositionTimeline.canvasSize.width, 1),
				);
				const childCanvasHeight = Math.max(
					1,
					resolveFiniteNumber(compositionTimeline.canvasSize.height, 1),
				);
				const targetWidth = Math.max(
					1,
					resolveFiniteNumber(
						element.transform?.baseSize.width,
						childCanvasWidth,
					),
				);
				const targetHeight = Math.max(
					1,
					resolveFiniteNumber(
						element.transform?.baseSize.height,
						childCanvasHeight,
					),
				);
				const matrix = Skia.Matrix();
				matrix.scale(
					targetWidth / childCanvasWidth,
					targetHeight / childCanvasHeight,
				);
				const childPrepare = {
					isExporting,
					fps: childFps,
					canvasSize: compositionTimeline.canvasSize,
					getModelStore: compositionTimeline.getModelStore,
					prepareTransitionPictures: shouldPrepareTransitionPictures,
					forcePrepareFrames,
					awaitReady: shouldAwaitReady,
					compositionPath: [...compositionPath, sceneId],
					maxCompositionDepth,
					frameChannel: "offscreen" as const,
				};
				let compositionNode: React.ReactNode;
				let compositionReady: Promise<void>;
				if (shouldUseLiveComposition) {
					const childRenderState = await buildSkiaRenderStateWithScopeCore(
						{
							elements: compositionTimeline.elements,
							displayTime: childDisplayTime,
							tracks: compositionTimeline.tracks,
							getTrackIndexForElement,
							sortByTrackIndex,
							prepare: childPrepare,
						},
						compositionDeps,
						scope,
					);
					const childNode = compositionTimeline.wrapRenderNode
						? compositionTimeline.wrapRenderNode(childRenderState.children)
						: childRenderState.children;
					compositionNode = (
						<Group matrix={matrix} key={element.id}>
							<RenderTarget
								width={childCanvasWidth}
								height={childCanvasHeight}
								clearColor="transparent"
								debugLabel={`composition:${element.id}`}
							>
								<Group
									clip={{
										x: 0,
										y: 0,
										width: childCanvasWidth,
										height: childCanvasHeight,
									}}
								>
									{childNode}
								</Group>
							</RenderTarget>
						</Group>
					);
					compositionReady = childRenderState.ready;
				} else {
					const childSnapshot = await buildSkiaFrameSnapshotCore(
						{
							elements: compositionTimeline.elements,
							displayTime: childDisplayTime,
							tracks: compositionTimeline.tracks,
							getTrackIndexForElement,
							sortByTrackIndex,
							prepare: childPrepare,
						},
						compositionDeps,
					);
					scope.add(() => childSnapshot.dispose?.());
					compositionNode = (
						<Group matrix={matrix} key={element.id}>
							<Group
								clip={{
									x: 0,
									y: 0,
									width: childCanvasWidth,
									height: childCanvasHeight,
								}}
							>
								<Picture picture={childSnapshot.picture} />
							</Group>
						</Group>
					);
					compositionReady = childSnapshot.ready;
				}
				const node = wrapElementNode({
					target: element,
					node: compositionNode,
					isTransitionElement,
					canvasSize,
				});
				return {
					node,
					ready: compositionReady,
				};
			} catch (error) {
				console.warn(
					`[PreviewEditor] Skip Composition "${element.id}" due to render error`,
					error,
				);
				return { node: null, ready: Promise.resolve() };
			}
		}
		if (!isTransitionElement(element)) {
			return buildPlainElementPlan(element, isExporting);
		}
		const transitionDef = deps.resolveComponent(element.component);
		if (!transitionDef) {
			return { node: null, ready: Promise.resolve() };
		}
		const transitionInputMode = transitionDef.transitionInputMode ?? "texture";
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
		const buildTransitionInputPlan = async (
			target: TimelineElement,
		): Promise<RenderPlan> => {
			// Composition 的 Renderer 为空，转场输入必须走 Composition 专用构图分支。
			if (target.type === COMPOSITION_ELEMENT_TYPE) {
				return buildElementPlan(target);
			}
			return buildPlainElementPlan(
				target,
				transitionInputMode === "texture" && canRenderTransitionTextures,
			);
		};
		const [fromPlan, toPlan] = await Promise.all([
			buildTransitionInputPlan(fromElement),
			buildTransitionInputPlan(toElement),
		]);
		const elementReady = Promise.all([fromPlan.ready, toPlan.ready]);
		let fromPicture: SkPicture | null = null;
		let toPicture: SkPicture | null = null;
		let fromImage: SkImage | null = null;
		let toImage: SkImage | null = null;
		if (transitionInputMode === "texture" && transitionPictureSize) {
			await elementReady;
			if (renderBackend.kind === "webgpu" && deps.renderNodeToImage) {
				const [fromRendered, toRendered] = await Promise.all([
					fromPlan.node
						? deps.renderNodeToImage(fromPlan.node, transitionPictureSize)
						: Promise.resolve(null),
					toPlan.node
						? deps.renderNodeToImage(toPlan.node, transitionPictureSize)
						: Promise.resolve(null),
				]);
				fromImage = fromRendered;
				toImage = toRendered;
				scope.addDisposable(fromRendered);
				scope.addDisposable(toRendered);
			} else {
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
				scope.addDisposable(fromRendered);
				scope.addDisposable(toRendered);
			}
		}
		const TransitionRenderer = transitionDef.Renderer;
		const activeTransition = activeTransitionById.get(element.id);
		const transitionNode = (
			<TransitionRenderer
				key={element.id}
				id={element.id}
				{...element.props}
				fromNode={fromPlan.node}
				toNode={toPlan.node}
				fromImage={fromImage}
				toImage={toImage}
				fromPicture={fromPicture}
				toPicture={toPicture}
				progress={activeTransition?.progress}
			/>
		);
		const node = wrapElementNode({
			target: element,
			node: transitionNode,
			isTransitionElement,
			canvasSize,
		});
		const ready = Promise.all([
			elementReady,
			runPrepareRenderFrame(element, {
				fromNode: fromPlan.node,
				toNode: toPlan.node,
			}),
		]).then(() => undefined);
		return { node, ready };
	};

	const plans = await Promise.all(orderedElements.map(buildElementPlan));

	const children = [
		<Fill key="background" color="black" />,
		...plans.map((plan) => plan.node),
	];

	const ready = shouldAwaitReady || forcePrepareFrames
		// forcePrepareFrames 的语义也必须等待 prepareRenderFrame 完成，
		// 否则像 VideoClip 这类依赖离屏帧准备的元素会在未就绪时被提前截图成黑帧。
		? Promise.all(plans.map((plan) => plan.ready)).then(() => undefined)
		: Promise.resolve();

	return {
		children,
		orderedElements,
		visibleElements,
		transitionFrameState,
		ready,
	};
};

export const buildSkiaRenderStateCore = async (
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
	const scope = createDisposeScope();
	try {
		const renderState = await buildSkiaRenderStateWithScopeCore(
			args,
			deps,
			scope,
		);
		return {
			...renderState,
			dispose: () => scope.dispose(),
		};
	} catch (error) {
		scope.dispose();
		throw error;
	}
};

export const buildSkiaFrameSnapshotCore = async (
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
	const scope = createDisposeScope();
	try {
		const renderState = await buildSkiaRenderStateWithScopeCore(
			args,
			deps,
			scope,
		);
		await renderState.ready;
		const canvasSize = args.prepare?.canvasSize;
		if (!canvasSize || canvasSize.width <= 0 || canvasSize.height <= 0) {
			throw new Error(
				"Failed to build skia frame snapshot: invalid canvas size",
			);
		}
		const picture = await deps.renderNodeToPicture(
			renderState.children,
			canvasSize,
		);
		if (!picture) {
			throw new Error("Failed to build skia frame snapshot: picture is null");
		}
		scope.addDisposable(picture);
		return {
			...renderState,
			picture,
			dispose: () => scope.dispose(),
		};
	} catch (error) {
		scope.dispose();
		throw error;
	}
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
