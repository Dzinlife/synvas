import type React from "react";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useModelSafe, useModelSelectorSafe } from "@/dsl/model";
import { componentRegistry } from "@/dsl/model/componentRegistry";
import { getTransformSize } from "@/dsl/transform";
import { framesToTimecode } from "@/utils/timecode";
import {
	useElements,
	useFps,
	useSelectedElement,
} from "../contexts/TimelineContext";

const ElementSettingsPanel: React.FC = () => {
	const { selectedElement } = useSelectedElement();
	const { setElements } = useElements();
	const { fps } = useFps();
	const [name, setName] = useState("");
	const nameInputId = useId();

	// 同步选中元素的 name 到本地状态
	useEffect(() => {
		if (selectedElement) {
			setName(selectedElement.name || "");
		}
	}, [selectedElement?.id, selectedElement?.name, selectedElement]);

	const durationFrames = useMemo(() => {
		if (!selectedElement) return 0;
		return selectedElement.timeline.end - selectedElement.timeline.start;
	}, [
		selectedElement?.timeline.end,
		selectedElement?.timeline.start,
		selectedElement,
	]);

	const constraints = useModelSelectorSafe(
		selectedElement?.id,
		(state) => state.constraints,
		{},
	);
	const selectedModel = useModelSafe(selectedElement?.id ?? "");
	const selectedDefinition = useMemo(() => {
		if (!selectedElement) return undefined;
		return componentRegistry.get(selectedElement.component);
	}, [selectedElement?.component, selectedElement]);
	const SettingComponent = selectedDefinition?.Setting;

	const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		if (!selectedElement) return;
		const newName = e.target.value;
		setName(newName);

		// 更新元素的 name
		setElements((prev) =>
			prev.map((el) =>
				el.id === selectedElement.id ? { ...el, name: newName } : el,
			),
		);
	};

	const updateProps = useCallback(
		(partial: Record<string, unknown>) => {
			if (!selectedElement) return;
			const selectedId = selectedElement.id;
			setElements((prev) =>
				prev.map((el) => {
					if (el.id !== selectedId) return el;
					return {
						...el,
						props: {
							...(el.props as Record<string, unknown>),
							...partial,
						},
					};
				}),
			);
		},
		[selectedElement?.id, selectedElement, setElements],
	);

	if (!selectedElement) {
		return <div className="text-xs text-neutral-500">未选中元素</div>;
	}
	const transformSize = getTransformSize(selectedElement.transform);

	return (
		<div className="space-y-3">
			<div>
				<label
					htmlFor={nameInputId}
					className="block text-xs text-neutral-400 mb-1"
				>
					Name
				</label>
				<input
					id={nameInputId}
					type="text"
					value={name}
					onChange={handleNameChange}
					placeholder={selectedElement.type}
					className="w-full bg-neutral-800 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
				/>
			</div>

			{SettingComponent && (
				<SettingComponent
					element={selectedElement}
					updateProps={updateProps}
				/>
			)}

			<div className="pt-2 border-t border-white/10">
				<div className="text-xs text-neutral-500">
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
						<div>PositionX: {selectedElement.transform.position.x}</div>
						<div>PositionY: {selectedElement.transform.position.y}</div>
						<div>AnchorX: {selectedElement.transform.anchor.x}</div>
						<div>AnchorY: {selectedElement.transform.anchor.y}</div>
						<div>BaseWidth: {selectedElement.transform.baseSize.width}</div>
						<div>BaseHeight: {selectedElement.transform.baseSize.height}</div>
						<div>ScaleX: {selectedElement.transform.scale.x}</div>
						<div>ScaleY: {selectedElement.transform.scale.y}</div>
						<div>Width: {transformSize.width}</div>
						<div>Height: {transformSize.height}</div>
						<div>Rotation(deg): {selectedElement.transform.rotation.value}</div>
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
					<div>
						<Button
							onClick={() => {
								console.log(selectedModel?.getState());
							}}
						>
							log internal
						</Button>
					</div>
				</div>
			</div>
		</div>
	);
};

export default ElementSettingsPanel;
