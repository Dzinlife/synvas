import type { TimelineAsset, TimelineElement } from "core/dsl/types";
import { isAssetBackedElementType } from "core/dsl/types";
import { useEffect, useMemo, useRef } from "react";
import { TimelineAudioMixManager } from "@/editor/audio/TimelineAudioMixManager";
import { TimelineProvider } from "@/editor/contexts/TimelineContext";
import {
	EditorRuntimeProvider,
	useActiveTimelineRuntime,
	useEditorRuntime,
	useStudioRuntimeManager,
} from "@/editor/runtime/EditorRuntimeProvider";
import type { EditorRuntime, TimelineRuntime } from "@/editor/runtime/types";
import { useProjectStore } from "@/projects/projectStore";
import { usePlaybackOwnerStore } from "@/studio/scene/playbackOwnerStore";
import {
	buildTimelineRuntimeIdFromRef,
	listTimelineRefs,
} from "@/studio/scene/timelineRefAdapter";
import { componentRegistry } from "./componentRegistry";

const buildSourceById = (
	assets: TimelineAsset[],
): Map<string, TimelineAsset> => {
	return new Map(assets.map((source) => [source.id, source]));
};

const resolveModelProps = (
	element: TimelineElement,
	sourceById: ReadonlyMap<string, TimelineAsset>,
): Record<string, unknown> => {
	const props = (element.props ?? {}) as Record<string, unknown>;
	if (!isAssetBackedElementType(element.type)) return props;
	if (!element.assetId) return props;
	const source = sourceById.get(element.assetId);
	if (!source) return props;
	return {
		...props,
		uri: source.uri,
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
): TimelineElement[] => {
	const timelineState = runtime.timelineStore.getState();
	const elements = timelineState.elements;
	const sourceById = buildSourceById(timelineState.assets);
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
			resolveModelProps(element, sourceById),
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
		const nextProps = resolveModelProps(element, sourceById);
		if (arePropsShallowEqual(currentProps, nextProps)) continue;
		state.setProps(nextProps);
	}

	return elements;
};

export const ModelLifecycleManager: React.FC = () => {
	const rootRuntime = useEditorRuntime();
	const runtimeManager = useStudioRuntimeManager();
	const currentProject = useProjectStore((state) => state.currentProject);
	const runtimeSyncRef = useRef<Map<string, RuntimeSyncState>>(new Map());

	const timelineRefs = useMemo(
		() => (currentProject ? listTimelineRefs(currentProject) : []),
		[currentProject],
	);

	useEffect(() => {
		const runtimeSync = runtimeSyncRef.current;
		const expectedRuntimeIds = new Set<string>();

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
				);
				continue;
			}

			const syncState: RuntimeSyncState = {
				prevElements: [],
				unsubscribers: [],
			};
			const runSync = () => {
				syncState.prevElements = syncRuntimeModels(
					rootRuntime,
					runtime,
					syncState.prevElements,
				);
			};

			syncState.unsubscribers.push(
				runtime.timelineStore.subscribe((state) => state.elements, runSync),
				runtime.timelineStore.subscribe((state) => state.assets, runSync),
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
	}, [rootRuntime, runtimeManager, timelineRefs]);

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

	const ownerRuntime = useMemo(() => {
		if (!ownerRuntimeId) return null;
		return (
			runtimeManager
				.listTimelineRuntimes()
				.find((runtime) => runtime.id === ownerRuntimeId) ?? null
		);
	}, [ownerRuntimeId, runtimeManager]);

	if (!ownerRuntime) return null;
	if (activeRuntime && activeRuntime.id === ownerRuntime.id) {
		return <TimelineAudioMixManager />;
	}

	const scopedRuntime: EditorRuntime = {
		id: `${rootRuntime.id}:${ownerRuntime.id}:audio-mix`,
		timelineStore: ownerRuntime.timelineStore,
		modelRegistry: ownerRuntime.modelRegistry,
	};

	return (
		<EditorRuntimeProvider runtime={scopedRuntime}>
			<TimelineProvider>
				<TimelineAudioMixManager />
			</TimelineProvider>
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
