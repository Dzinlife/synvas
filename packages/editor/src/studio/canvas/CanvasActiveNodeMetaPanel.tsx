import {
	formatColorSpaceDescriptor,
	getColorSpacePresetKey,
	type ColorSpaceDescriptor,
	type TimelineAsset,
} from "core";
import type { CanvasNode, SceneDocument } from "@/studio/project/types";
import type React from "react";
import { useMemo } from "react";
import { resolveAssetDisplayLabel } from "@/projects/assetLocator";
import { useProjectStore } from "@/projects/projectStore";
import { ASSET_COLOR_OVERRIDE_OPTIONS } from "@/studio/project/colorManagement";

interface CanvasActiveNodeMetaPanelProps {
	node: CanvasNode;
	scene: SceneDocument | null;
	asset: TimelineAsset | null;
}

const Item = ({ label, value }: { label: string; value: React.ReactNode }) => {
	return (
		<div className="grid grid-cols-[92px_1fr] gap-2 rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
			<div className="text-[11px] text-white/60">{label}</div>
			<div className="break-all text-[11px] text-white/90">{value}</div>
		</div>
	);
};

const getOverrideSelectKey = (
	descriptor: ColorSpaceDescriptor | undefined,
): string => {
	if (!descriptor) return "auto";
	return getColorSpacePresetKey(descriptor) ?? "custom";
};

const normalizeMetaPatch = (
	meta: TimelineAsset["meta"] | undefined,
): TimelineAsset["meta"] | undefined =>
	meta && Object.keys(meta).length > 0 ? meta : undefined;

const CanvasActiveNodeMetaPanel: React.FC<CanvasActiveNodeMetaPanelProps> = ({
	node,
	scene,
	asset,
}) => {
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const updateProjectAssetMeta = useProjectStore(
		(state) => state.updateProjectAssetMeta,
	);
	const sourceUri = resolveAssetDisplayLabel(asset, {
		projectId: currentProjectId,
	});
	const overrideKey = getOverrideSelectKey(asset?.meta?.color?.override);
	const updateAssetOverride = (descriptor: ColorSpaceDescriptor | null) => {
		if (!asset) return;
		updateProjectAssetMeta(asset.id, (prev) => {
			const nextMeta: TimelineAsset["meta"] = { ...(prev ?? {}) };
			const nextColor = { ...(prev?.color ?? {}) };
			if (descriptor) {
				nextColor.override = { ...descriptor };
			} else {
				delete nextColor.override;
			}
			if (nextColor.detected || nextColor.override) {
				nextMeta.color = nextColor;
			} else {
				delete nextMeta.color;
			}
			return normalizeMetaPatch(nextMeta);
		});
	};
	const metaJson = useMemo(() => {
		return JSON.stringify(
			{
				node,
				scene: scene
					? {
							id: scene.id,
							name: scene.name,
						}
					: null,
				asset: asset
					? {
							id: asset.id,
							kind: asset.kind,
							name: asset.name,
							locator: asset.locator,
							sourceUri,
						}
					: null,
			},
			null,
			2,
		);
	}, [asset, node, scene, sourceUri]);

	return (
		<div
			data-testid="canvas-node-inspector"
			className="flex h-full min-h-0 w-full flex-col ring-2 ring-neutral-800/80 bg-neutral-900/90 shadow-2xl backdrop-blur-xl"
			onChange={(event) => {
				const target = event.target as HTMLSelectElement | null;
				if (target?.dataset.colorField !== "asset-override") return;
				const option = ASSET_COLOR_OVERRIDE_OPTIONS.find(
					(item) => item.key === target.value,
				);
				if (!option) return;
				updateAssetOverride(option.descriptor);
			}}
		>
			<div className="border-b border-white/10 px-3 py-2 text-xs font-medium text-white/90">
				Active Node
			</div>
			<div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
				<Item label="Type" value={node.type} />
				<Item label="Name" value={node.name} />
				<Item label="ID" value={node.id} />
				<Item label="X / Y" value={`${node.x} / ${node.y}`} />
				<Item label="Width / Height" value={`${node.width} / ${node.height}`} />
				<Item label="Sibling Order" value={node.siblingOrder} />
				<Item label="Locked" value={String(node.locked)} />
				<Item label="Hidden" value={String(node.hidden)} />
				{scene && <Item label="Scene" value={`${scene.name} (${scene.id})`} />}
				{asset && (
					<Item
						label="Asset"
						value={`${asset.name ?? "Unnamed"} (${asset.kind})`}
					/>
				)}
				{asset?.meta?.color?.detected && (
					<Item
						label="Detected"
						value={formatColorSpaceDescriptor(asset.meta.color.detected)}
					/>
				)}
				{asset && (asset.kind === "video" || asset.kind === "image") && (
					<label className="grid grid-cols-[92px_1fr] gap-2 rounded-md border border-white/10 bg-black/20 px-2 py-1.5">
						<span className="text-[11px] text-white/60">Input</span>
						<select
							data-color-field="asset-override"
							value={overrideKey}
							className="min-w-0 rounded border border-white/10 bg-neutral-950 px-1.5 py-0.5 text-[11px] text-white/90 outline-none"
						>
							{ASSET_COLOR_OVERRIDE_OPTIONS.map((item) => (
								<option key={item.key} value={item.key}>
									{item.label}
								</option>
							))}
							{overrideKey === "custom" && (
								<option value="custom">Custom</option>
							)}
						</select>
					</label>
				)}
				<div className="rounded-md border border-white/10 bg-black/20 p-2">
					<div className="mb-1 text-[11px] text-white/60">JSON</div>
					<pre className="overflow-x-auto text-[11px] leading-4 text-white/85">
						{metaJson}
					</pre>
				</div>
			</div>
		</div>
	);
};

export default CanvasActiveNodeMetaPanel;
