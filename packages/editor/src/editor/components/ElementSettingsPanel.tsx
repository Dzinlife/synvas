import type { TimelineElement } from "core/dsl/types";
import type React from "react";
import { useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useModelSelectorSafe } from "@/dsl/model";
import { componentRegistry } from "@/dsl/model/componentRegistry";
import { getTransformSize } from "@/dsl/transform";
import { framesToTimecode } from "@/utils/timecode";
import {
	useElements,
	useFps,
	useSelectedElement,
} from "../contexts/TimelineContext";
import CommonElementSettingsPanel from "./CommonElementSettingsPanel";

const ElementSettingsPanel: React.FC = () => {
	const { selectedElement, selectedElementId } = useSelectedElement();
	const { setElements } = useElements();
	const { fps } = useFps();

	const durationFrames = useMemo(() => {
		if (!selectedElement) return 0;
		return selectedElement.timeline.end - selectedElement.timeline.start;
	}, [
		selectedElement?.timeline.end,
		selectedElement?.timeline.start,
		selectedElement,
	]);

	const constraints = useModelSelectorSafe(
		selectedElementId ?? undefined,
		(state) => state.constraints,
		{},
	);
	const selectedDefinition = useMemo(() => {
		if (!selectedElement) return undefined;
		return componentRegistry.get(selectedElement.component);
	}, [selectedElement?.component, selectedElement]);
	const SettingComponent = selectedDefinition?.Setting;

	const updateSelectedElement = useCallback(
		(
			updater: (element: TimelineElement) => TimelineElement,
			options?: { history?: boolean },
		) => {
			if (!selectedElementId) return;
			setElements(
				(prev) => {
					let didChange = false;
					const nextElements = prev.map((element) => {
						if (element.id !== selectedElementId) return element;
						const nextElement = updater(element);
						if (nextElement !== element) {
							didChange = true;
						}
						return nextElement;
					});
					return didChange ? nextElements : prev;
				},
				options,
			);
		},
		[selectedElementId, setElements],
	);

	const updateProps = useCallback(
		(partial: Record<string, unknown>) => {
			if (!selectedElementId) return;
			setElements((prev) =>
				prev.map((element) => {
					if (element.id !== selectedElementId) return element;
					return {
						...element,
						props: {
							...(element.props as Record<string, unknown>),
							...partial,
						},
					};
				}),
			);
		},
		[selectedElementId, setElements],
	);

	if (!selectedElement) {
		return <div className="text-xs text-neutral-500">未选中元素</div>;
	}

	const transform = selectedElement.transform;
	const transformSize = transform
		? getTransformSize(transform)
		: { width: 0, height: 0 };

	return (
		<div className="space-y-3">
			<CommonElementSettingsPanel
				element={selectedElement}
				updateElement={updateSelectedElement}
			/>

			{SettingComponent && (
				<SettingComponent element={selectedElement} updateProps={updateProps} />
			)}

			<details className="pt-2 border-t border-white/10">
				<summary className="cursor-pointer text-xs text-neutral-400 select-none">
					调试信息
				</summary>
				<div className="text-xs text-neutral-500 mt-2 space-y-1">
					<div>Type: {selectedElement.type}</div>
					<div>ID: {selectedElement.id}</div>
					<div>Track ID: {selectedElement.timeline.trackId}</div>
					<div>Track Index: {selectedElement.timeline.trackIndex}</div>
					<div>Role: {selectedElement.timeline.role}</div>
					<div>
						Start: {selectedElement.timeline.start}f (
						{selectedElement.timeline.startTimecode})
					</div>
					<div>
						End: {selectedElement.timeline.end}f (
						{selectedElement.timeline.endTimecode})
					</div>
					<div>
						Duration: {durationFrames}f ({framesToTimecode(durationFrames, fps)}
						)
					</div>
					<div>Transform:</div>
					<div>PositionX: {transform?.position.x ?? "-"}</div>
					<div>PositionY: {transform?.position.y ?? "-"}</div>
					<div>AnchorX: {transform?.anchor.x ?? "-"}</div>
					<div>AnchorY: {transform?.anchor.y ?? "-"}</div>
					<div>BaseWidth: {transform?.baseSize.width ?? "-"}</div>
					<div>BaseHeight: {transform?.baseSize.height ?? "-"}</div>
					<div>ScaleX: {transform?.scale.x ?? "-"}</div>
					<div>ScaleY: {transform?.scale.y ?? "-"}</div>
					<div>Width: {transformSize.width}</div>
					<div>Height: {transformSize.height}</div>
					<div>Rotation(deg): {transform?.rotation.value ?? "-"}</div>
					<div>
						Max Duration:{" "}
						{constraints.maxDuration !== undefined
							? `${constraints.maxDuration}f (${framesToTimecode(
									constraints.maxDuration,
									fps,
								)})`
							: "-"}
					</div>
					<div>props: {JSON.stringify(selectedElement.props)}</div>
					<div className="pt-1">
						<Button
							onClick={() => {
								console.log(selectedElement);
							}}
						>
							log internal
						</Button>
					</div>
				</div>
			</details>
		</div>
	);
};

export default ElementSettingsPanel;
