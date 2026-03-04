import type { CanvasNode, StudioProject } from "core/studio/types";
import { useMemo } from "react";
import { Canvas, Group, Rect } from "react-skia-lite";
import { useStudioRuntimeManager } from "@/scene-editor/runtime/EditorRuntimeProvider";
import { getCanvasNodeDefinition } from "./node-system/registry";

interface InfiniteSkiaCanvasProps {
	width: number;
	height: number;
	camera: {
		x: number;
		y: number;
		zoom: number;
	};
	nodes: CanvasNode[];
	scenes: StudioProject["scenes"];
	assets: StudioProject["assets"];
	activeNodeId: string | null;
	focusedNodeId: string | null;
}

const InfiniteSkiaCanvas: React.FC<InfiniteSkiaCanvasProps> = ({
	width,
	height,
	camera,
	nodes,
	scenes,
	assets,
	activeNodeId,
	focusedNodeId,
}) => {
	const runtimeManager = useStudioRuntimeManager();
	const assetById = useMemo(() => {
		return new Map(assets.map((asset) => [asset.id, asset]));
	}, [assets]);

	if (width <= 0 || height <= 0) return null;

	return (
		<div
			data-testid="infinite-skia-canvas"
			className="absolute inset-0 pointer-events-none"
		>
			<Canvas style={{ width, height }}>
				<Group
					transform={[
						{ scale: camera.zoom },
						{ translateX: camera.x },
						{ translateY: camera.y },
					]}
				>
					{nodes.map((node) => {
						const definition = getCanvasNodeDefinition(node.type);
						const Renderer = definition.skiaRenderer;
						const scene =
							node.type === "scene" ? scenes[node.sceneId] ?? null : null;
						const asset =
							"assetId" in node ? assetById.get(node.assetId) ?? null : null;
						const isFocused = node.id === focusedNodeId;
						const isActive = node.id === activeNodeId;
						const isDimmed = Boolean(focusedNodeId) && !isFocused;

						return (
							<Group
								key={`canvas-node-skia-${node.id}`}
								clip={{
									x: node.x,
									y: node.y,
									width: node.width,
									height: node.height,
								}}
							>
								<Group
									transform={[
										{ translateX: node.x },
										{ translateY: node.y },
									]}
									opacity={isDimmed ? 0.35 : 1}
								>
									<Renderer
										node={node}
										scene={scene}
										asset={asset}
										isActive={isActive}
										isFocused={isFocused}
										isDimmed={isDimmed}
										runtimeManager={runtimeManager}
									/>
									<Rect
										x={0}
										y={0}
										width={Math.max(1, node.width)}
										height={Math.max(1, node.height)}
										style="stroke"
										strokeWidth={isActive ? 2 : 1}
										color={
											isActive
												? "rgba(251,146,60,1)"
												: "rgba(255,255,255,0.2)"
										}
									/>
								</Group>
							</Group>
						);
					})}
				</Group>
			</Canvas>
		</div>
	);
};

export default InfiniteSkiaCanvas;
