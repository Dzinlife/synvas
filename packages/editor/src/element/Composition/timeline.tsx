import { useTimelineStore } from "@/scene-editor/contexts/TimelineContext";

interface CompositionTimelineProps {
	id: string;
}

export const CompositionTimeline: React.FC<CompositionTimelineProps> = ({
	id,
}) => {
	const element = useTimelineStore((state) => state.getElementById(id));
	const sceneId =
		(element?.props as { sceneId?: unknown } | undefined)?.sceneId ?? "";
	const displaySceneId =
		typeof sceneId === "string" && sceneId.trim().length > 0
			? sceneId.trim()
			: "unknown";

	return (
		<div className="absolute inset-0 bg-cyan-700/90 px-2 py-1 text-white">
			<div className="truncate text-xs font-medium">
				{element?.name?.trim() || "Composition"}
			</div>
			<div className="truncate text-[10px] text-cyan-100">{displaySceneId}</div>
		</div>
	);
};
