import type { TimelineElement } from "core/timeline-system/types";
import { useCallback, useRef } from "react";
import { DialSlider } from "@/components/ui/dial-slider";
import { Input } from "@/components/ui/input";
import { ScrubbableNumberInput } from "@/components/ui/scrubbable-number-input";
import {
	clampNumber,
	resolveInputNumber,
	resolveRenderOpacity,
	resolveRenderVisible,
	roundToDecimals,
} from "./commonElementSettingUtils";

interface CommonElementSettingsPanelProps {
	element: TimelineElement;
	updateElement: (
		updater: (element: TimelineElement) => TimelineElement,
		options?: { history?: boolean },
	) => void;
}

const CommonElementSettingsPanel: React.FC<CommonElementSettingsPanelProps> = ({
	element,
	updateElement,
}) => {
	const transform = element.transform;
	const hasTransform = Boolean(transform);
	const isTransformScrubbingRef = useRef(false);

	const updateName = useCallback(
		(value: string) => {
			updateElement((current) => {
				if (current.name === value) return current;
				return {
					...current,
					name: value,
				};
			});
		},
		[updateElement],
	);

	const updateRenderVisible = useCallback(
		(checked: boolean) => {
			updateElement((current) => {
				const currentVisible = resolveRenderVisible(current);
				if (currentVisible === checked) return current;
				return {
					...current,
					render: {
						...(current.render ?? {}),
						visible: checked,
						opacity: resolveRenderOpacity(current),
					},
				};
			});
		},
		[updateElement],
	);

	const updateRenderOpacity = useCallback(
		(rawValue: string) => {
			updateElement((current) => {
				const currentOpacity = resolveRenderOpacity(current);
				const resolved = clampNumber(
					roundToDecimals(resolveInputNumber(rawValue, currentOpacity)),
					0,
					1,
				);
				if (currentOpacity === resolved) return current;
				return {
					...current,
					render: {
						...(current.render ?? {}),
						visible: resolveRenderVisible(current),
						opacity: resolved,
					},
				};
			});
		},
		[updateElement],
	);

	const updateTransform = useCallback(
		(
			updater: (
				transformMeta: NonNullable<TimelineElement["transform"]>,
			) => NonNullable<TimelineElement["transform"]>,
			options?: { history?: boolean },
		) => {
			updateElement((current) => {
				if (!current.transform) return current;
				const nextTransform = updater(current.transform);
				return nextTransform === current.transform
					? current
					: {
							...current,
							transform: nextTransform,
						};
			}, options);
		},
		[updateElement],
	);

	const getTransformUpdateOptions = useCallback(() => {
		return isTransformScrubbingRef.current ? { history: false } : undefined;
	}, []);

	const handleTransformScrubStart = useCallback(() => {
		if (isTransformScrubbingRef.current) return;
		isTransformScrubbingRef.current = true;
		updateElement((current) => ({ ...current }), { history: true });
	}, [updateElement]);

	const handleTransformScrubEnd = useCallback(() => {
		isTransformScrubbingRef.current = false;
	}, []);

	const updatePositionX = useCallback(
		(value: number) => {
			updateTransform((currentTransform) => {
				const nextValue = roundToDecimals(value);
				if (nextValue === currentTransform.position.x) return currentTransform;
				return {
					...currentTransform,
					position: {
						...currentTransform.position,
						x: nextValue,
					},
				};
			}, getTransformUpdateOptions());
		},
		[getTransformUpdateOptions, updateTransform],
	);

	const updatePositionY = useCallback(
		(value: number) => {
			updateTransform((currentTransform) => {
				const nextValue = roundToDecimals(value);
				if (nextValue === currentTransform.position.y) return currentTransform;
				return {
					...currentTransform,
					position: {
						...currentTransform.position,
						y: nextValue,
					},
				};
			}, getTransformUpdateOptions());
		},
		[getTransformUpdateOptions, updateTransform],
	);

	const updateAnchorX = useCallback(
		(value: number) => {
			updateTransform((currentTransform) => {
				const nextValue = clampNumber(roundToDecimals(value), 0, 1);
				if (nextValue === currentTransform.anchor.x) return currentTransform;
				return {
					...currentTransform,
					anchor: {
						...currentTransform.anchor,
						x: nextValue,
					},
				};
			}, getTransformUpdateOptions());
		},
		[getTransformUpdateOptions, updateTransform],
	);

	const updateAnchorY = useCallback(
		(value: number) => {
			updateTransform((currentTransform) => {
				const nextValue = clampNumber(roundToDecimals(value), 0, 1);
				if (nextValue === currentTransform.anchor.y) return currentTransform;
				return {
					...currentTransform,
					anchor: {
						...currentTransform.anchor,
						y: nextValue,
					},
				};
			}, getTransformUpdateOptions());
		},
		[getTransformUpdateOptions, updateTransform],
	);

	const updateScaleX = useCallback(
		(value: number) => {
			updateTransform((currentTransform) => {
				const nextValue = roundToDecimals(value);
				if (nextValue === currentTransform.scale.x) return currentTransform;
				return {
					...currentTransform,
					scale: {
						...currentTransform.scale,
						x: nextValue,
					},
				};
			}, getTransformUpdateOptions());
		},
		[getTransformUpdateOptions, updateTransform],
	);

	const updateScaleY = useCallback(
		(value: number) => {
			updateTransform((currentTransform) => {
				const nextValue = roundToDecimals(value);
				if (nextValue === currentTransform.scale.y) return currentTransform;
				return {
					...currentTransform,
					scale: {
						...currentTransform.scale,
						y: nextValue,
					},
				};
			}, getTransformUpdateOptions());
		},
		[getTransformUpdateOptions, updateTransform],
	);

	const updateRotation = useCallback(
		(value: number) => {
			updateTransform((currentTransform) => {
				const nextValue = roundToDecimals(value);
				if (nextValue === currentTransform.rotation.value)
					return currentTransform;
				return {
					...currentTransform,
					rotation: {
						...currentTransform.rotation,
						value: nextValue,
					},
				};
			}, getTransformUpdateOptions());
		},
		[getTransformUpdateOptions, updateTransform],
	);

	return (
		<div className="space-y-3 pt-2 border-t border-white/10">
			<div className="text-xs font-medium text-neutral-300">通用属性</div>

			<div className="space-y-1">
				<label
					className="block text-xs text-neutral-400 mb-1"
					htmlFor="common-name"
				>
					Name
				</label>
				<Input
					id="common-name"
					aria-label="Name"
					type="text"
					value={element.name}
					onChange={(event) => {
						updateName(event.target.value);
					}}
					className="h-8 w-full bg-neutral-800 border-white/10 text-sm text-white placeholder-neutral-500"
				/>
			</div>

			<div className="space-y-1">
				<div className="flex items-center justify-between">
					<label
						className="block text-xs text-neutral-400"
						htmlFor="common-visible"
					>
						Visible
					</label>
					<input
						id="common-visible"
						aria-label="Visible"
						type="checkbox"
						checked={resolveRenderVisible(element)}
						onChange={(event) => {
							updateRenderVisible(event.target.checked);
						}}
						className="h-4 w-4 rounded border-white/20 bg-neutral-800 text-blue-500"
					/>
				</div>
			</div>

			<div className="space-y-1">
				<DialSlider
					label="Opacity"
					value={resolveRenderOpacity(element)}
					onChange={(value) => updateRenderOpacity(String(value))}
					min={0}
					max={1}
					step={0.01}
				/>
			</div>

			<div className="space-y-2">
				<div className="space-y-1">
					<div className="text-xs text-neutral-400">Position</div>
					<div className="grid grid-cols-2 gap-2">
						<ScrubbableNumberInput
							id="position-x"
							ariaLabel="Position X"
							label="X"
							step={1}
							disabled={!hasTransform}
							value={transform?.position.x ?? 0}
							onValueChange={updatePositionX}
							onScrubStart={handleTransformScrubStart}
							onScrubEnd={handleTransformScrubEnd}
						/>
						<ScrubbableNumberInput
							id="position-y"
							ariaLabel="Position Y"
							label="Y"
							step={1}
							disabled={!hasTransform}
							value={transform?.position.y ?? 0}
							onValueChange={updatePositionY}
							onScrubStart={handleTransformScrubStart}
							onScrubEnd={handleTransformScrubEnd}
						/>
					</div>
				</div>
				<div className="space-y-1">
					<div className="text-xs text-neutral-400">Anchor</div>
					<div className="grid grid-cols-2 gap-2">
						<ScrubbableNumberInput
							id="anchor-x"
							ariaLabel="Anchor X"
							label="X"
							min={0}
							max={1}
							step={0.01}
							disabled={!hasTransform}
							value={transform?.anchor.x ?? 0}
							onValueChange={updateAnchorX}
							onScrubStart={handleTransformScrubStart}
							onScrubEnd={handleTransformScrubEnd}
						/>
						<ScrubbableNumberInput
							id="anchor-y"
							ariaLabel="Anchor Y"
							label="Y"
							min={0}
							max={1}
							step={0.01}
							disabled={!hasTransform}
							value={transform?.anchor.y ?? 0}
							onValueChange={updateAnchorY}
							onScrubStart={handleTransformScrubStart}
							onScrubEnd={handleTransformScrubEnd}
						/>
					</div>
				</div>
				<div className="space-y-1">
					<div className="text-xs text-neutral-400">Scale</div>
					<div className="grid grid-cols-2 gap-2">
						<ScrubbableNumberInput
							id="scale-x"
							ariaLabel="Scale X"
							label="X"
							step={0.01}
							disabled={!hasTransform}
							value={transform?.scale.x ?? 0}
							onValueChange={updateScaleX}
							onScrubStart={handleTransformScrubStart}
							onScrubEnd={handleTransformScrubEnd}
						/>
						<ScrubbableNumberInput
							id="scale-y"
							ariaLabel="Scale Y"
							label="Y"
							step={0.01}
							disabled={!hasTransform}
							value={transform?.scale.y ?? 0}
							onValueChange={updateScaleY}
							onScrubStart={handleTransformScrubStart}
							onScrubEnd={handleTransformScrubEnd}
						/>
					</div>
				</div>
				<div className="space-y-1">
					<div className="text-xs text-neutral-400">Rotation</div>
					<ScrubbableNumberInput
						id="rotation"
						ariaLabel="Rotation (deg)"
						label="R"
						format={{
							style: "unit",
							unit: "degree",
							unitDisplay: "narrow",
						}}
						step={0.1}
						disabled={!hasTransform}
						value={transform?.rotation.value ?? 0}
						onValueChange={updateRotation}
						onScrubStart={handleTransformScrubStart}
						onScrubEnd={handleTransformScrubEnd}
					/>
				</div>
			</div>

			{!hasTransform && (
				<div className="text-xs text-neutral-500">
					当前元素不包含 Transform 数据。
				</div>
			)}
			{(element.type === "AudioClip" ||
				element.type === "CompositionAudioClip") && (
				<div className="text-xs text-neutral-500">
					当前类型可能无可视效果，Transform 仅保存数据。
				</div>
			)}
		</div>
	);
};

export default CommonElementSettingsPanel;
