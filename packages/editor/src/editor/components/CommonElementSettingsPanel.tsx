import type { TimelineElement } from "core/dsl/types";
import { useCallback } from "react";
import { Input } from "@/components/ui/input";
import {
	clampNumber,
	resolveInputNumber,
	resolveRenderOpacity,
	resolveRenderVisible,
} from "./commonElementSettingUtils";

interface CommonElementSettingsPanelProps {
	element: TimelineElement;
	updateElement: (updater: (element: TimelineElement) => TimelineElement) => void;
}

const CommonElementSettingsPanel: React.FC<CommonElementSettingsPanelProps> = ({
	element,
	updateElement,
}) => {
	const transform = element.transform;
	const hasTransform = Boolean(transform);

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
					resolveInputNumber(rawValue, currentOpacity),
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
			});
		},
		[updateElement],
	);

	const updatePositionX = useCallback(
		(rawValue: string) => {
			updateTransform((currentTransform) => {
				const nextValue = resolveInputNumber(rawValue, currentTransform.position.x);
				if (nextValue === currentTransform.position.x) return currentTransform;
				return {
					...currentTransform,
					position: {
						...currentTransform.position,
						x: nextValue,
					},
				};
			});
		},
		[updateTransform],
	);

	const updatePositionY = useCallback(
		(rawValue: string) => {
			updateTransform((currentTransform) => {
				const nextValue = resolveInputNumber(rawValue, currentTransform.position.y);
				if (nextValue === currentTransform.position.y) return currentTransform;
				return {
					...currentTransform,
					position: {
						...currentTransform.position,
						y: nextValue,
					},
				};
			});
		},
		[updateTransform],
	);

	const updateAnchorX = useCallback(
		(rawValue: string) => {
			updateTransform((currentTransform) => {
				const nextValue = clampNumber(
					resolveInputNumber(rawValue, currentTransform.anchor.x),
					0,
					1,
				);
				if (nextValue === currentTransform.anchor.x) return currentTransform;
				return {
					...currentTransform,
					anchor: {
						...currentTransform.anchor,
						x: nextValue,
					},
				};
			});
		},
		[updateTransform],
	);

	const updateAnchorY = useCallback(
		(rawValue: string) => {
			updateTransform((currentTransform) => {
				const nextValue = clampNumber(
					resolveInputNumber(rawValue, currentTransform.anchor.y),
					0,
					1,
				);
				if (nextValue === currentTransform.anchor.y) return currentTransform;
				return {
					...currentTransform,
					anchor: {
						...currentTransform.anchor,
						y: nextValue,
					},
				};
			});
		},
		[updateTransform],
	);

	const updateScaleX = useCallback(
		(rawValue: string) => {
			updateTransform((currentTransform) => {
				const nextValue = resolveInputNumber(rawValue, currentTransform.scale.x);
				if (nextValue === currentTransform.scale.x) return currentTransform;
				return {
					...currentTransform,
					scale: {
						...currentTransform.scale,
						x: nextValue,
					},
				};
			});
		},
		[updateTransform],
	);

	const updateScaleY = useCallback(
		(rawValue: string) => {
			updateTransform((currentTransform) => {
				const nextValue = resolveInputNumber(rawValue, currentTransform.scale.y);
				if (nextValue === currentTransform.scale.y) return currentTransform;
				return {
					...currentTransform,
					scale: {
						...currentTransform.scale,
						y: nextValue,
					},
				};
			});
		},
		[updateTransform],
	);

	const updateRotation = useCallback(
		(rawValue: string) => {
			updateTransform((currentTransform) => {
				const nextValue = resolveInputNumber(rawValue, currentTransform.rotation.value);
				if (nextValue === currentTransform.rotation.value) return currentTransform;
				return {
					...currentTransform,
					rotation: {
						...currentTransform.rotation,
						value: nextValue,
					},
				};
			});
		},
		[updateTransform],
	);

	return (
		<div className="space-y-3 pt-2 border-t border-white/10">
			<div className="text-xs font-medium text-neutral-300">通用属性</div>

			<div className="space-y-1">
				<label className="block text-xs text-neutral-400 mb-1" htmlFor="common-name">
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
					<label className="block text-xs text-neutral-400" htmlFor="common-visible">
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
				<label className="block text-xs text-neutral-400 mb-1" htmlFor="common-opacity">
					Opacity
				</label>
				<Input
					id="common-opacity"
					aria-label="Opacity"
					type="number"
					min={0}
					max={1}
					step={0.01}
					value={resolveRenderOpacity(element)}
					onChange={(event) => {
						updateRenderOpacity(event.target.value);
					}}
					className="h-8 w-full bg-neutral-800 border-white/10 text-sm text-white placeholder-neutral-500"
				/>
			</div>

			<div className="grid grid-cols-2 gap-2">
				<div className="space-y-1">
					<label className="block text-xs text-neutral-400 mb-1" htmlFor="position-x">
						Position X
					</label>
					<Input
						id="position-x"
						aria-label="Position X"
						type="number"
						step={1}
						disabled={!hasTransform}
						value={transform?.position.x ?? 0}
						onChange={(event) => {
							updatePositionX(event.target.value);
						}}
						className="h-8 w-full bg-neutral-800 border-white/10 text-sm text-white placeholder-neutral-500 disabled:opacity-50"
					/>
				</div>
				<div className="space-y-1">
					<label className="block text-xs text-neutral-400 mb-1" htmlFor="position-y">
						Position Y
					</label>
					<Input
						id="position-y"
						aria-label="Position Y"
						type="number"
						step={1}
						disabled={!hasTransform}
						value={transform?.position.y ?? 0}
						onChange={(event) => {
							updatePositionY(event.target.value);
						}}
						className="h-8 w-full bg-neutral-800 border-white/10 text-sm text-white placeholder-neutral-500 disabled:opacity-50"
					/>
				</div>
				<div className="space-y-1">
					<label className="block text-xs text-neutral-400 mb-1" htmlFor="anchor-x">
						Anchor X
					</label>
					<Input
						id="anchor-x"
						aria-label="Anchor X"
						type="number"
						min={0}
						max={1}
						step={0.01}
						disabled={!hasTransform}
						value={transform?.anchor.x ?? 0}
						onChange={(event) => {
							updateAnchorX(event.target.value);
						}}
						className="h-8 w-full bg-neutral-800 border-white/10 text-sm text-white placeholder-neutral-500 disabled:opacity-50"
					/>
				</div>
				<div className="space-y-1">
					<label className="block text-xs text-neutral-400 mb-1" htmlFor="anchor-y">
						Anchor Y
					</label>
					<Input
						id="anchor-y"
						aria-label="Anchor Y"
						type="number"
						min={0}
						max={1}
						step={0.01}
						disabled={!hasTransform}
						value={transform?.anchor.y ?? 0}
						onChange={(event) => {
							updateAnchorY(event.target.value);
						}}
						className="h-8 w-full bg-neutral-800 border-white/10 text-sm text-white placeholder-neutral-500 disabled:opacity-50"
					/>
				</div>
				<div className="space-y-1">
					<label className="block text-xs text-neutral-400 mb-1" htmlFor="scale-x">
						Scale X
					</label>
					<Input
						id="scale-x"
						aria-label="Scale X"
						type="number"
						step={0.01}
						disabled={!hasTransform}
						value={transform?.scale.x ?? 0}
						onChange={(event) => {
							updateScaleX(event.target.value);
						}}
						className="h-8 w-full bg-neutral-800 border-white/10 text-sm text-white placeholder-neutral-500 disabled:opacity-50"
					/>
				</div>
				<div className="space-y-1">
					<label className="block text-xs text-neutral-400 mb-1" htmlFor="scale-y">
						Scale Y
					</label>
					<Input
						id="scale-y"
						aria-label="Scale Y"
						type="number"
						step={0.01}
						disabled={!hasTransform}
						value={transform?.scale.y ?? 0}
						onChange={(event) => {
							updateScaleY(event.target.value);
						}}
						className="h-8 w-full bg-neutral-800 border-white/10 text-sm text-white placeholder-neutral-500 disabled:opacity-50"
					/>
				</div>
				<div className="space-y-1 col-span-2">
					<label className="block text-xs text-neutral-400 mb-1" htmlFor="rotation">
						Rotation (deg)
					</label>
					<Input
						id="rotation"
						aria-label="Rotation (deg)"
						type="number"
						step={0.1}
						disabled={!hasTransform}
						value={transform?.rotation.value ?? 0}
						onChange={(event) => {
							updateRotation(event.target.value);
						}}
						className="h-8 w-full bg-neutral-800 border-white/10 text-sm text-white placeholder-neutral-500 disabled:opacity-50"
					/>
				</div>
			</div>

			{!hasTransform && (
				<div className="text-xs text-neutral-500">
					当前元素不包含 Transform 数据。
				</div>
			)}
			{element.type === "AudioClip" && (
				<div className="text-xs text-neutral-500">
					当前类型可能无可视效果，Transform 仅保存数据。
				</div>
			)}
		</div>
	);
};

export default CommonElementSettingsPanel;
