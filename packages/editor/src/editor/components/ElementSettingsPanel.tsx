import { Button } from "@/components/ui/button";
import { useModel, useModelSelectorSafe } from "@/dsl/model";
import { framesToTimecode } from "@/utils/timecode";
import React, { useEffect, useMemo, useState } from "react";
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

	// 同步选中元素的 name 到本地状态
	useEffect(() => {
		if (selectedElement) {
			setName(selectedElement.name || "");
		}
	}, [selectedElement?.id, selectedElement?.name]);

	const durationFrames = useMemo(() => {
		if (!selectedElement) return 0;
		return selectedElement.timeline.end - selectedElement.timeline.start;
	}, [selectedElement?.timeline.end, selectedElement?.timeline.start]);

	const constraints = useModelSelectorSafe(
		selectedElement?.id,
		(state) => state.constraints,
		{},
	);

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

	if (!selectedElement) {
		return <div className="text-xs text-neutral-500">未选中元素</div>;
	}

	return (
		<div className="space-y-3">
			<div>
				<label className="block text-xs text-neutral-400 mb-1">Name</label>
				<input
					type="text"
					value={name}
					onChange={handleNameChange}
					placeholder={selectedElement.type}
					className="w-full bg-neutral-800 border border-white/10 rounded-md px-3 py-2 text-sm text-white placeholder-neutral-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
				/>
			</div>

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
					<div>CenterX: {selectedElement.transform.centerX}</div>
					<div>CenterY: {selectedElement.transform.centerY}</div>
					<div>Width: {selectedElement.transform.width}</div>
					<div>Height: {selectedElement.transform.height}</div>
					<div>Rotation: {selectedElement.transform.rotation}</div>
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
								const model = useModel(selectedElement.id);
								console.log(model.getState());
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
