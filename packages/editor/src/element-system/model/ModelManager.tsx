import type { TimelineAsset, TimelineElement } from "core/timeline-system/types";
import { isAssetBackedElementType } from "core/timeline-system/types";
import { useEffect, useMemo, useRef } from "react";
import { useProjectStore } from "@/projects/projectStore";
import { TimelineAudioMixManager } from "@/scene-editor/audio/TimelineAudioMixManager";
import { TimelineProvider } from "@/scene-editor/contexts/TimelineContext";
import {
	EditorRuntimeProvider,
	useActiveTimelineRuntime,
	useEditorRuntime,
	useStudioRuntimeManager,
} from "@/scene-editor/runtime/EditorRuntimeProvider";
import type {
	EditorRuntime,
	StudioRuntimeManager,
	TimelineRuntime,
} from "@/scene-editor/runtime/types";
import { usePlaybackOwnerStore } from "@/studio/scene/playbackOwnerStore";
import {
	buildTimelineRuntimeIdFromRef,
	listTimelineRefs,
} from "@/studio/scene/timelineRefAdapter";
import { resolveAssetPlayableUri } from "@/projects/assetLocator";
import { componentRegistry } from "./componentRegistry";

const buildSourceById = (
	assets: TimelineAsset[],
): Map<string, TimelineAsset> => {
	return new Map(assets.map((source) => [source.id, source]));
};
const EMPTY_ASSETS: TimelineAsset[] = [];

const resolveModelProps = (
	element: TimelineElement,
	sourceById: ReadonlyMap<string, TimelineAsset>,
	projectId: string | null,
): Record<string, unknown> => {
	const props = (element.props ?? {}) as Record<string, unknown>;
	if (!isAssetBackedElementType(element.type)) return props;
	if (!element.assetId) return props;
	if (!projectId) return props;
	const source = sourceById.get(element.assetId);
	if (!source) return props;
	const uri = resolveAssetPlayableUri(source, { projectId });
	if (!uri) return props;
	return {
		...props,
		uri,
	};
};

const arePropsShallowEqual = (
	left: Record<string, unknown>,
	right: Record<string, unknown>,
): boolean => {
	const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
	for (const key of keys) {
		if (left[key] !== right[key]) {
			return false;
		}
	}
	return true;
};

type RuntimeSyncState = {
	prevElements: TimelineElement[];
	unsubscribers: Array<() => void>;
};

const syncRuntimeModels = (
	rootRuntime: EditorRuntime,
	runtime: TimelineRuntime,
	prevElements: TimelineElement[],
	sourceById: ReadonlyMap<string, TimelineAsset>,
	projectId: string | null,
): TimelineElement[] => {
	const timelineState = runtime.timelineStore.getState();
	const elements = timelineState.elements;
	const modelRegistry = runtime.modelRegistry;
	const scopedRuntime: EditorRuntime = {
		id: `${rootRuntime.id}:${runtime.id}`,
		timelineStore: runtime.timelineStore,
		modelRegistry: runtime.modelRegistry,
	};

	const prevIds = new Set(prevElements.map((item) => item.id));
	const nextIds = new Set(elements.map((item) => item.id));

	for (const element of elements) {
		const id = element.id;
		if (prevIds.has(id) || modelRegistry.has(id)) continue;
		const definition = componentRegistry.get(element.component);
		if (!definition) {
			console.warn(
				`[ModelLifecycleManager] Component not registered: ${element.component} (${id})`,
			);
			continue;
		}
		const store = definition.createModel(
			id,
			resolveModelProps(element, sourceById, projectId),
			scopedRuntime,
		);
		modelRegistry.register(id, store);
		store.getState().init();
	}

	for (const element of prevElements) {
		if (nextIds.has(element.id)) continue;
		modelRegistry.unregister(element.id);
	}

	for (const element of elements) {
		const store = modelRegistry.get(element.id);
		if (!store) continue;
		const state = store.getState();
		const currentProps = state.props as Record<string, unknown>;
		const nextProps = resolveModelProps(element, sourceById, projectId);
		if (arePropsShallowEqual(currentProps, nextProps)) continue;
		state.setProps(nextProps);
	}

	return elements;
};

export const ModelLifecycleManager: React.FC = () => {
	const rootRuntime = useEditorRuntime();
	const runtimeManager = useStudioRuntimeManager();
	const currentProject = useProjectStore((state) => state.currentProject);
	const projectAssets = useProjectStore(
		(state) => state.currentProject?.assets ?? EMPTY_ASSETS,
	);
	const runtimeSyncRef = useRef<Map<string, RuntimeSyncState>>(new Map());

	const timelineRefs = useMemo(
		() => (currentProject ? listTimelineRefs(currentProject) : []),
		[currentProject],
	);

	useEffect(() => {
		const runtimeSync = runtimeSyncRef.current;
		const expectedRuntimeIds = new Set<string>();
		const sourceById = buildSourceById(projectAssets);
		const projectId = currentProject?.id ?? null;

		for (const ref of timelineRefs) {
			const runtime = runtimeManager.ensureTimelineRuntime(ref);
			const runtimeId = buildTimelineRuntimeIdFromRef(ref);
			expectedRuntimeIds.add(runtimeId);

			const existed = runtimeSync.get(runtimeId);
			if (existed) {
				existed.prevElements = syncRuntimeModels(
					rootRuntime,
					runtime,
					existed.prevElements,
					sourceById,
					projectId,
				);
				continue;
			}

			const syncState: RuntimeSyncState = {
				prevElements: [],
				unsubscribers: [],
			};
			const runSync = () => {
				const runtimeSourceById = buildSourceById(
					useProjectStore.getState().currentProject?.assets ?? EMPTY_ASSETS,
				);
				syncState.prevElements = syncRuntimeModels(
					rootRuntime,
					runtime,
					syncState.prevElements,
					runtimeSourceById,
					useProjectStore.getState().currentProject?.id ?? null,
				);
			};

			syncState.unsubscribers.push(
				runtime.timelineStore.subscribe((state) => state.elements, runSync),
			);
			runSync();
			runtimeSync.set(runtimeId, syncState);
		}

		for (const [runtimeId, syncState] of runtimeSync.entries()) {
			if (expectedRuntimeIds.has(runtimeId)) continue;
			for (const unsubscribe of syncState.unsubscribers) {
				unsubscribe();
			}
			runtimeSync.delete(runtimeId);
		}
	}, [rootRuntime, runtimeManager, projectAssets, timelineRefs, currentProject]);

	useEffect(() => {
		return () => {
			for (const syncState of runtimeSyncRef.current.values()) {
				for (const unsubscribe of syncState.unsubscribers) {
					unsubscribe();
				}
			}
			runtimeSyncRef.current.clear();
		};
	}, []);

	return null;
};

export const TimelineAudioMixBridge: React.FC = () => {
	const rootRuntime = useEditorRuntime();
	const runtimeManager = useStudioRuntimeManager();
	const activeRuntime = useActiveTimelineRuntime();
	const ownerRuntimeId = usePlaybackOwnerStore((state) => state.ownerRuntimeId);
	const ensureTimelineRuntime = runtimeManager.ensureTimelineRuntime;
	const removeTimelineRuntime = runtimeManager.removeTimelineRuntime;
	const getTimelineRuntime = runtimeManager.getTimelineRuntime;
	const listTimelineRuntimes = runtimeManager.listTimelineRuntimes;
	const setActiveEditTimeline = runtimeManager.setActiveEditTimeline;
	const getActiveEditTimelineRef = runtimeManager.getActiveEditTimelineRef;
	const getActiveEditTimelineRuntime =
		runtimeManager.getActiveEditTimelineRuntime;

	const ownerRuntime = useMemo(() => {
		if (!ownerRuntimeId) return null;
		return (
			listTimelineRuntimes().find((runtime) => runtime.id === ownerRuntimeId) ??
			null
		);
	}, [listTimelineRuntimes, ownerRuntimeId]);
	const scopedRuntime = useMemo<
		(EditorRuntime & Partial<StudioRuntimeManager>) | null
	>(() => {
		if (!ownerRuntime) return null;
		return {
			id: `${rootRuntime.id}:${ownerRuntime.id}:audio-mix`,
			timelineStore: ownerRuntime.timelineStore,
			modelRegistry: ownerRuntime.modelRegistry,
			ensureTimelineRuntime,
			removeTimelineRuntime,
			getTimelineRuntime,
			listTimelineRuntimes,
			setActiveEditTimeline,
			getActiveEditTimelineRef,
			getActiveEditTimelineRuntime,
		};
	}, [
		ensureTimelineRuntime,
		getActiveEditTimelineRef,
		getActiveEditTimelineRuntime,
		getTimelineRuntime,
		listTimelineRuntimes,
		ownerRuntime,
		removeTimelineRuntime,
		rootRuntime.id,
		setActiveEditTimeline,
	]);

	if (!ownerRuntime || !scopedRuntime) return null;
	const shouldDriveOwnerPlaybackClock =
		!activeRuntime || activeRuntime.id !== ownerRuntime.id;

	return (
		<EditorRuntimeProvider runtime={scopedRuntime}>
			<TimelineAudioMixManager />
			{shouldDriveOwnerPlaybackClock ? (
				<TimelineProvider>{null}</TimelineProvider>
			) : null}
		</EditorRuntimeProvider>
	);
};

export const ModelManager: React.FC<{ children: React.ReactNode }> = ({
	children,
}) => {
	return (
		<>
			<ModelLifecycleManager />
			<TimelineAudioMixBridge />
			{children}
		</>
	);
};
