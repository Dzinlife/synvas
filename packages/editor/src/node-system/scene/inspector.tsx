import { resolveTimelineEndFrame } from "core/timeline-system/utils/timelineEndFrame";
import {
	getColorSpacePresetKey,
	formatColorSpaceDescriptor,
	type ColorManagementSettings,
	type ColorSpaceDescriptor,
	type PreviewColorSpaceTarget,
} from "core";
import {
	MousePointer2,
	Shapes,
	SlidersHorizontal,
	type LucideIcon,
} from "lucide-react";
import type { SceneDocument, SceneNode } from "@/studio/project/types";
import { useContext, useLayoutEffect, useMemo, useState } from "react";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useProjectStore } from "@/projects/projectStore";
import { framesToTimecode } from "@/utils/timecode";
import ElementSettingsPanel from "@/scene-editor/components/ElementSettingsPanel";
import { useSelectedElement } from "@/scene-editor/contexts/TimelineContext";
import SceneElementLibrary from "@/scene-editor/components/SceneElementLibrary";
import {
	EditorRuntimeContext,
	EditorRuntimeProvider,
} from "@/scene-editor/runtime/EditorRuntimeProvider";
import { createScopedStudioRuntime } from "@/scene-editor/runtime/createScopedStudioRuntime";
import type {
	EditorRuntime,
	StudioRuntimeManager,
} from "@/scene-editor/runtime/types";
import CanvasActiveNodeMetaPanel from "@/studio/canvas/CanvasActiveNodeMetaPanel";
import {
	SCENE_EXPORT_COLOR_OPTIONS,
	SCENE_WORKING_COLOR_OPTIONS,
	resolveSceneColorContext,
} from "@/studio/project/colorManagement";
import { toSceneTimelineRef } from "@/studio/scene/timelineRefAdapter";
import type { CanvasNodeInspectorProps } from "../types";

type SceneInspectorTab = "properties" | "components" | "selected-element";

interface SceneInspectorTabItem {
	id: SceneInspectorTab;
	label: string;
	icon: LucideIcon;
	testId: string;
}

const BASE_TAB_ITEMS: SceneInspectorTabItem[] = [
	{
		id: "properties",
		label: "属性",
		icon: SlidersHorizontal,
		testId: "scene-inspector-tab-properties",
	},
	{
		id: "components",
		label: "元素组件",
		icon: Shapes,
		testId: "scene-inspector-tab-components",
	},
];

const SELECTED_ELEMENT_TAB_ITEM: SceneInspectorTabItem = {
	id: "selected-element",
	label: "选中元素",
	icon: MousePointer2,
	testId: "scene-inspector-tab-selected-element",
};

const Item = ({ label, value }: { label: string; value: React.ReactNode }) => {
	return (
		<div className="grid grid-cols-[92px_1fr] gap-2 rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
			<div className="text-[11px] text-white/60">{label}</div>
			<div className="break-all text-[11px] text-white/90">{value}</div>
		</div>
	);
};

const getDescriptorSelectKey = (
	descriptor: ColorSpaceDescriptor | undefined,
	fallback = "inherit",
) => {
	if (!descriptor) return fallback;
	return getColorSpacePresetKey(descriptor) ?? "custom";
};

const normalizeSceneColorPatch = (
	color: Partial<ColorManagementSettings>,
): Partial<ColorManagementSettings> | undefined =>
	Object.keys(color).length > 0 ? color : undefined;

const SceneNodeMetaPanel = ({ scene }: { scene: SceneDocument }) => {
	const currentProject = useProjectStore((state) => state.currentProject);
	const updateSceneColor = useProjectStore((state) => state.updateSceneColor);
	const colorContext = useMemo(
		() => resolveSceneColorContext(currentProject, scene),
		[currentProject, scene],
	);
	const durationFrames = useMemo(() => {
		return resolveTimelineEndFrame(scene.timeline.elements);
	}, [scene.timeline.elements]);
	const workingKey = getDescriptorSelectKey(scene.color?.working);
	const previewKey = scene.color?.preview ?? "inherit";
	const exportKey = getDescriptorSelectKey(scene.color?.export);

	const updateWorking = (descriptor: ColorSpaceDescriptor | null) => {
		updateSceneColor(scene.id, (prev) => {
			const next = { ...(prev ?? {}) };
			if (descriptor) {
				next.working = { ...descriptor };
			} else {
				delete next.working;
			}
			return normalizeSceneColorPatch(next);
		});
	};
	const updatePreview = (preview: PreviewColorSpaceTarget | null) => {
		updateSceneColor(scene.id, (prev) => {
			const next = { ...(prev ?? {}) };
			if (preview) {
				next.preview = preview;
			} else {
				delete next.preview;
			}
			return normalizeSceneColorPatch(next);
		});
	};
	const updateExport = (descriptor: ColorSpaceDescriptor | null) => {
		updateSceneColor(scene.id, (prev) => {
			const next = { ...(prev ?? {}) };
			if (descriptor) {
				next.export = { ...descriptor };
			} else {
				delete next.export;
			}
			return normalizeSceneColorPatch(next);
		});
	};

	return (
		<div
			data-testid="canvas-scene-node-meta-panel"
			className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3"
			onChange={(event) => {
				const target = event.target as HTMLSelectElement | null;
				const value = target?.value;
				if (!target || typeof value !== "string") return;
				if (target.dataset.colorField === "working") {
					const option = SCENE_WORKING_COLOR_OPTIONS.find(
						(item) => item.key === value,
					);
					if (option) updateWorking(option.descriptor);
					return;
				}
				if (target.dataset.colorField === "preview") {
					updatePreview(
						value === "inherit" ? null : (value as PreviewColorSpaceTarget),
					);
					return;
				}
				if (target.dataset.colorField === "export") {
					const option = SCENE_EXPORT_COLOR_OPTIONS.find(
						(item) => item.key === value,
					);
					if (option) updateExport(option.descriptor);
				}
			}}
		>
			<Item label="Name" value={scene.name} />
			<Item label="ID" value={scene.id} />
			<Item
				label="Size"
				value={`${scene.timeline.canvas.width} x ${scene.timeline.canvas.height}`}
			/>
			<Item label="FPS" value={scene.timeline.fps} />
			<Item
				label="Duration"
				value={`${durationFrames}f (${framesToTimecode(durationFrames, scene.timeline.fps)})`}
			/>
			<Item label="Elements" value={scene.timeline.elements.length} />
			<label className="grid grid-cols-[92px_1fr] gap-2 rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
				<span className="text-[11px] text-white/60">Working</span>
				<select
					data-color-field="working"
					value={workingKey}
					className="min-w-0 rounded border border-white/10 bg-neutral-950 px-1.5 py-0.5 text-[11px] text-white/90 outline-none"
				>
					{SCENE_WORKING_COLOR_OPTIONS.map((item) => (
						<option key={item.key} value={item.key}>
							{item.label}
						</option>
					))}
					{workingKey === "custom" && <option value="custom">Custom</option>}
				</select>
			</label>
			<label className="grid grid-cols-[92px_1fr] gap-2 rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
				<span className="text-[11px] text-white/60">Preview</span>
				<select
					data-color-field="preview"
					value={previewKey}
					className="min-w-0 rounded border border-white/10 bg-neutral-950 px-1.5 py-0.5 text-[11px] text-white/90 outline-none"
				>
					<option value="inherit">Inherit</option>
					<option value="auto">Auto</option>
					<option value="srgb">sRGB</option>
					<option value="display-p3">Display P3</option>
				</select>
			</label>
			<label className="grid grid-cols-[92px_1fr] gap-2 rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
				<span className="text-[11px] text-white/60">Export</span>
				<select
					data-color-field="export"
					value={exportKey}
					className="min-w-0 rounded border border-white/10 bg-neutral-950 px-1.5 py-0.5 text-[11px] text-white/90 outline-none"
				>
					{SCENE_EXPORT_COLOR_OPTIONS.map((item) => (
						<option key={item.key} value={item.key}>
							{item.label}
						</option>
					))}
					{exportKey === "custom" && <option value="custom">Custom</option>}
				</select>
			</label>
			<Item
				label="Resolved"
				value={`${formatColorSpaceDescriptor(
					colorContext.settings.working,
				)} / ${colorContext.previewTargetColorSpace}`}
			/>
		</div>
	);
};

const SceneInspectorTabButton = ({
	item,
	active,
	onSelect,
}: {
	item: SceneInspectorTabItem;
	active: boolean;
	onSelect: (tab: SceneInspectorTab) => void;
}) => {
	const Icon = item.icon;

	return (
		<Tooltip>
			<TooltipTrigger
				type="button"
				data-testid={item.testId}
				aria-label={item.label}
				aria-pressed={active}
				onClick={() => onSelect(item.id)}
				className={cn(
					"flex h-9 w-9 items-center justify-center rounded-l-md border border-r-0 border-white/10 text-white/75 shadow-lg backdrop-blur transition-colors",
					active
						? "bg-neutral-900 text-white"
						: "bg-neutral-950/80 hover:bg-neutral-900/95 hover:text-white",
				)}
			>
				<Icon className="size-4" />
			</TooltipTrigger>
			<TooltipContent>{item.label}</TooltipContent>
		</Tooltip>
	);
};

const SceneNodeInspectorContent = ({ scene }: { scene: SceneDocument }) => {
	const { selectedElement } = useSelectedElement();
	const selectedElementId = selectedElement?.id ?? null;
	const [activeTab, setActiveTab] = useState<SceneInspectorTab>(() =>
		selectedElementId ? "selected-element" : "properties",
	);
	const tabItems = useMemo(() => {
		return selectedElementId
			? [...BASE_TAB_ITEMS, SELECTED_ELEMENT_TAB_ITEM]
			: BASE_TAB_ITEMS;
	}, [selectedElementId]);
	const visibleActiveTab = tabItems.some((item) => item.id === activeTab)
		? activeTab
		: "properties";
	const activeTabItem =
		tabItems.find((item) => item.id === visibleActiveTab) ?? BASE_TAB_ITEMS[0];

	useLayoutEffect(() => {
		setActiveTab(selectedElementId ? "selected-element" : "properties");
	}, [selectedElementId]);

	return (
		<div className="relative flex h-full min-h-0 w-full flex-col ring-2 ring-neutral-800/80 bg-neutral-900/90 shadow-2xl backdrop-blur-xl">
			<div className="absolute -left-9 top-2 z-20 flex flex-col gap-1">
				{tabItems.map((item) => (
					<SceneInspectorTabButton
						key={item.id}
						item={item}
						active={item.id === visibleActiveTab}
						onSelect={setActiveTab}
					/>
				))}
			</div>
			<div className="border-b border-white/10 px-3 py-2 text-xs font-medium text-white/90">
				{activeTabItem.label}
			</div>
			{visibleActiveTab === "components" ? (
				<div
					data-testid="canvas-scene-element-library-panel"
					className="min-h-0 flex-1 overflow-y-auto p-3"
				>
					<SceneElementLibrary />
				</div>
			) : visibleActiveTab === "selected-element" && selectedElement ? (
				<div
					data-testid="canvas-timeline-element-settings-panel"
					className="min-h-0 flex-1 overflow-y-auto p-3"
				>
					<ElementSettingsPanel />
				</div>
			) : (
				<SceneNodeMetaPanel scene={scene} />
			)}
		</div>
	);
};

export const SceneNodeInspector = ({
	node,
	scene,
	asset,
}: CanvasNodeInspectorProps<SceneNode>) => {
	const runtime = useContext(EditorRuntimeContext);
	const runtimeManager = useMemo(() => {
		const manager = runtime as Partial<StudioRuntimeManager> | null;
		if (
			!manager?.ensureTimelineRuntime ||
			!manager?.getTimelineRuntime ||
			!manager?.listTimelineRuntimes
		) {
			return null;
		}
		return runtime as EditorRuntime & StudioRuntimeManager;
	}, [runtime]);
	const timelineRuntime = useMemo(() => {
		if (!scene || !runtimeManager) return null;
		const sceneRef = toSceneTimelineRef(node.sceneId);
		return (
			runtimeManager.getTimelineRuntime(sceneRef) ??
			runtimeManager.ensureTimelineRuntime(sceneRef)
		);
	}, [node.sceneId, runtimeManager, scene]);
	const scopedRuntime = useMemo(() => {
		if (!timelineRuntime || !runtimeManager) return null;
		return createScopedStudioRuntime({
			runtimeManager,
			activeSceneId: node.sceneId,
		});
	}, [node.sceneId, runtimeManager, timelineRuntime]);

	if (!scene || !timelineRuntime || !scopedRuntime) {
		return (
			<CanvasActiveNodeMetaPanel node={node} scene={scene} asset={asset} />
		);
	}

	return (
		<EditorRuntimeProvider runtime={scopedRuntime}>
			<SceneNodeInspectorContent scene={scene} />
		</EditorRuntimeProvider>
	);
};
