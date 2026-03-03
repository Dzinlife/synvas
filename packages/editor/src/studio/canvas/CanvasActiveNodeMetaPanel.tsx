import type { TimelineAsset } from "core/dsl/types";
import type { CanvasNode, SceneDocument } from "core/studio/types";
import type React from "react";
import { useMemo } from "react";

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

const CanvasActiveNodeMetaPanel: React.FC<CanvasActiveNodeMetaPanelProps> = ({
	node,
	scene,
	asset,
}) => {
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
							uri: asset.uri,
						}
					: null,
			},
			null,
			2,
		);
	}, [asset, node, scene]);

	return (
		<div
			data-testid="canvas-active-node-meta-panel"
			className="flex h-full min-h-0 w-full flex-col overflow-auto rounded-xl border border-white/10 bg-neutral-900/90 shadow-2xl backdrop-blur-xl"
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
				<Item label="Z-Index" value={node.zIndex} />
				<Item label="Locked" value={String(node.locked)} />
				<Item label="Hidden" value={String(node.hidden)} />
				{scene && <Item label="Scene" value={`${scene.name} (${scene.id})`} />}
				{asset && (
					<Item
						label="Asset"
						value={`${asset.name ?? "Unnamed"} (${asset.kind})`}
					/>
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
