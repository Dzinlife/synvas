import type { CanvasNode } from "@/studio/project/types";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TILE_CAMERA_EPSILON } from "./tile";

const EMPTY_NODE_ID_SET = new Set<string>();

interface UseInfiniteSkiaCanvasRenderRetentionInput {
	supportsTilePipeline: boolean;
	activeNodeId: string | null;
	latestNodeById: ReadonlyMap<string, CanvasNode>;
	liveNodeIdSet: ReadonlySet<string>;
	frozenNodeIdSet: ReadonlySet<string>;
	forceLiveNodeIdSet: ReadonlySet<string>;
	cameraZoom: number;
}

interface ReleaseRetainedNodesInput {
	releaseRetainedFrozenNodes: boolean;
	dropRetainedFrozenNodesForZoom: boolean;
	releaseRetainedLiveNodes: boolean;
}

export const useInfiniteSkiaCanvasRenderRetention = ({
	supportsTilePipeline,
	activeNodeId,
	latestNodeById,
	liveNodeIdSet,
	frozenNodeIdSet,
	forceLiveNodeIdSet,
	cameraZoom,
}: UseInfiniteSkiaCanvasRenderRetentionInput) => {
	const previousLiveNodeIdSetRef =
		useRef<ReadonlySet<string>>(EMPTY_NODE_ID_SET);
	const [retainedLiveNodeIds, setRetainedLiveNodeIds] = useState<string[]>([]);
	const [liveRetentionVersion, setLiveRetentionVersion] = useState(0);
	const releasedLiveNodeIdSet = useMemo(() => {
		void liveRetentionVersion;
		if (!supportsTilePipeline) return EMPTY_NODE_ID_SET;
		const releasedNodeIds = new Set<string>();
		for (const nodeId of previousLiveNodeIdSetRef.current) {
			if (liveNodeIdSet.has(nodeId)) continue;
			if (nodeId === activeNodeId || forceLiveNodeIdSet.has(nodeId)) continue;
			if (!latestNodeById.has(nodeId)) continue;
			releasedNodeIds.add(nodeId);
		}
		if (releasedNodeIds.size === 0) return EMPTY_NODE_ID_SET;
		return releasedNodeIds;
	}, [
		activeNodeId,
		forceLiveNodeIdSet,
		latestNodeById,
		liveNodeIdSet,
		liveRetentionVersion,
		supportsTilePipeline,
	]);
	const retainedLiveNodeIdSet = useMemo(() => {
		if (!supportsTilePipeline || retainedLiveNodeIds.length === 0) {
			return releasedLiveNodeIdSet;
		}
		const retainedNodeIds = new Set(releasedLiveNodeIdSet);
		for (const nodeId of retainedLiveNodeIds) {
			if (liveNodeIdSet.has(nodeId)) continue;
			if (!latestNodeById.has(nodeId)) continue;
			retainedNodeIds.add(nodeId);
		}
		if (retainedNodeIds.size === 0) return EMPTY_NODE_ID_SET;
		return retainedNodeIds;
	}, [
		latestNodeById,
		liveNodeIdSet,
		releasedLiveNodeIdSet,
		retainedLiveNodeIds,
		supportsTilePipeline,
	]);
	const renderLiveNodeIdSet = useMemo(() => {
		if (retainedLiveNodeIdSet.size === 0) return liveNodeIdSet;
		const nextLiveNodeIds = new Set(liveNodeIdSet);
		for (const nodeId of retainedLiveNodeIdSet) {
			nextLiveNodeIds.add(nodeId);
		}
		return nextLiveNodeIds;
	}, [liveNodeIdSet, retainedLiveNodeIdSet]);
	const effectiveFrozenNodeIdSet = useMemo(() => {
		if (renderLiveNodeIdSet.size === 0) return frozenNodeIdSet;
		const nextFrozenNodeIds = new Set<string>();
		for (const nodeId of frozenNodeIdSet) {
			if (renderLiveNodeIdSet.has(nodeId)) continue;
			nextFrozenNodeIds.add(nodeId);
		}
		return nextFrozenNodeIds;
	}, [frozenNodeIdSet, renderLiveNodeIdSet]);
	const previousEffectiveFrozenNodeIdSetRef =
		useRef<ReadonlySet<string>>(EMPTY_NODE_ID_SET);
	const [retainedFrozenNodeIds, setRetainedFrozenNodeIds] = useState<string[]>(
		[],
	);
	const [frozenRetentionVersion, setFrozenRetentionVersion] = useState(0);
	const retainedFrozenCameraZoomRef = useRef<number | null>(null);
	const releasedFrozenNodeIdSet = useMemo(() => {
		void frozenRetentionVersion;
		if (!supportsTilePipeline) return EMPTY_NODE_ID_SET;
		const releasedNodeIds = new Set<string>();
		for (const nodeId of previousEffectiveFrozenNodeIdSetRef.current) {
			if (effectiveFrozenNodeIdSet.has(nodeId)) continue;
			if (!latestNodeById.has(nodeId)) continue;
			releasedNodeIds.add(nodeId);
		}
		if (releasedNodeIds.size === 0) return EMPTY_NODE_ID_SET;
		return releasedNodeIds;
	}, [
		effectiveFrozenNodeIdSet,
		frozenRetentionVersion,
		latestNodeById,
		supportsTilePipeline,
	]);
	const retainedFrozenNodeIdSet = useMemo(() => {
		if (!supportsTilePipeline || retainedFrozenNodeIds.length === 0) {
			return releasedFrozenNodeIdSet;
		}
		const retainedNodeIds = new Set(releasedFrozenNodeIdSet);
		for (const nodeId of retainedFrozenNodeIds) {
			if (effectiveFrozenNodeIdSet.has(nodeId)) continue;
			if (!latestNodeById.has(nodeId)) continue;
			retainedNodeIds.add(nodeId);
		}
		if (retainedNodeIds.size === 0) return EMPTY_NODE_ID_SET;
		return retainedNodeIds;
	}, [
		effectiveFrozenNodeIdSet,
		latestNodeById,
		releasedFrozenNodeIdSet,
		retainedFrozenNodeIds,
		supportsTilePipeline,
	]);
	const renderFrozenNodeIdSet = useMemo(() => {
		if (retainedFrozenNodeIdSet.size === 0) return effectiveFrozenNodeIdSet;
		const nextFrozenNodeIds = new Set(effectiveFrozenNodeIdSet);
		for (const nodeId of retainedFrozenNodeIdSet) {
			nextFrozenNodeIds.add(nodeId);
		}
		return nextFrozenNodeIds;
	}, [effectiveFrozenNodeIdSet, retainedFrozenNodeIdSet]);
	const staticTileExcludedNodeIdSet = useMemo(() => {
		const excludedNodeIds = new Set(effectiveFrozenNodeIdSet);
		for (const nodeId of liveNodeIdSet) {
			excludedNodeIds.add(nodeId);
		}
		return excludedNodeIds;
	}, [effectiveFrozenNodeIdSet, liveNodeIdSet]);

	useLayoutEffect(() => {
		if (!supportsTilePipeline) {
			previousLiveNodeIdSetRef.current = new Set(liveNodeIdSet);
			setRetainedLiveNodeIds((previous) =>
				previous.length === 0 ? previous : [],
			);
			return;
		}
		if (releasedLiveNodeIdSet.size > 0 || retainedLiveNodeIds.length > 0) {
			setRetainedLiveNodeIds((previous) => {
				const nextNodeIds = new Set(previous);
				for (const nodeId of releasedLiveNodeIdSet) {
					nextNodeIds.add(nodeId);
				}
				for (const nodeId of [...nextNodeIds]) {
					if (liveNodeIdSet.has(nodeId) || !latestNodeById.has(nodeId)) {
						nextNodeIds.delete(nodeId);
					}
				}
				const next = [...nextNodeIds];
				if (
					next.length === previous.length &&
					next.every((nodeId, index) => nodeId === previous[index])
				) {
					return previous;
				}
				return next;
			});
		}
		previousLiveNodeIdSetRef.current = new Set(liveNodeIdSet);
	}, [
		latestNodeById,
		liveNodeIdSet,
		releasedLiveNodeIdSet,
		retainedLiveNodeIds.length,
		supportsTilePipeline,
	]);

	useLayoutEffect(() => {
		if (!supportsTilePipeline) {
			previousEffectiveFrozenNodeIdSetRef.current = new Set(
				effectiveFrozenNodeIdSet,
			);
			retainedFrozenCameraZoomRef.current = null;
			setRetainedFrozenNodeIds((previous) =>
				previous.length === 0 ? previous : [],
			);
			return;
		}
		if (releasedFrozenNodeIdSet.size > 0 || retainedFrozenNodeIds.length > 0) {
			if (
				releasedFrozenNodeIdSet.size > 0 &&
				retainedFrozenCameraZoomRef.current === null
			) {
				retainedFrozenCameraZoomRef.current = Math.max(
					cameraZoom,
					TILE_CAMERA_EPSILON,
				);
			}
			setRetainedFrozenNodeIds((previous) => {
				const nextNodeIds = new Set(previous);
				for (const nodeId of releasedFrozenNodeIdSet) {
					nextNodeIds.add(nodeId);
				}
				for (const nodeId of [...nextNodeIds]) {
					if (
						effectiveFrozenNodeIdSet.has(nodeId) ||
						!latestNodeById.has(nodeId)
					) {
						nextNodeIds.delete(nodeId);
					}
				}
				const next = [...nextNodeIds];
				if (
					next.length === previous.length &&
					next.every((nodeId, index) => nodeId === previous[index])
				) {
					return previous;
				}
				return next;
			});
		}
		previousEffectiveFrozenNodeIdSetRef.current = new Set(
			effectiveFrozenNodeIdSet,
		);
	}, [
		cameraZoom,
		effectiveFrozenNodeIdSet,
		latestNodeById,
		releasedFrozenNodeIdSet,
		retainedFrozenNodeIds.length,
		supportsTilePipeline,
	]);

	const shouldDropRetainedFrozenNodesForZoom = useCallback(
		(currentCameraZoom: number) => {
			const retainedFrozenCameraZoom = retainedFrozenCameraZoomRef.current;
			const safeCurrentCameraZoom = Math.max(
				currentCameraZoom,
				TILE_CAMERA_EPSILON,
			);
			return (
				retainedFrozenNodeIdSet.size > 0 &&
				retainedFrozenCameraZoom !== null &&
				Math.abs(safeCurrentCameraZoom - retainedFrozenCameraZoom) >
					Math.max(TILE_CAMERA_EPSILON, retainedFrozenCameraZoom * 0.001)
			);
		},
		[retainedFrozenNodeIdSet],
	);

	const releaseRetainedNodesAfterRender = useCallback(
		({
			releaseRetainedFrozenNodes,
			dropRetainedFrozenNodesForZoom,
			releaseRetainedLiveNodes,
		}: ReleaseRetainedNodesInput) => {
			if (releaseRetainedFrozenNodes || dropRetainedFrozenNodesForZoom) {
				previousEffectiveFrozenNodeIdSetRef.current = new Set(
					effectiveFrozenNodeIdSet,
				);
				retainedFrozenCameraZoomRef.current = null;
				setFrozenRetentionVersion((previous) => previous + 1);
				setRetainedFrozenNodeIds((previous) => {
					const next = previous.filter((nodeId) => {
						return effectiveFrozenNodeIdSet.has(nodeId);
					});
					if (
						next.length === previous.length &&
						next.every((nodeId, index) => nodeId === previous[index])
					) {
						return previous;
					}
					return next;
				});
			}
			if (releaseRetainedLiveNodes) {
				previousLiveNodeIdSetRef.current = new Set(liveNodeIdSet);
				setLiveRetentionVersion((previous) => previous + 1);
				setRetainedLiveNodeIds((previous) => {
					const next = previous.filter((nodeId) => {
						return liveNodeIdSet.has(nodeId) || frozenNodeIdSet.has(nodeId);
					});
					if (
						next.length === previous.length &&
						next.every((nodeId, index) => nodeId === previous[index])
					) {
						return previous;
					}
					return next;
				});
			}
		},
		[effectiveFrozenNodeIdSet, frozenNodeIdSet, liveNodeIdSet],
	);

	return {
		effectiveFrozenNodeIdSet,
		renderFrozenNodeIdSet,
		renderLiveNodeIdSet,
		retainedFrozenNodeIdSet,
		retainedLiveNodeIdSet,
		staticTileExcludedNodeIdSet,
		releaseRetainedNodesAfterRender,
		shouldDropRetainedFrozenNodesForZoom,
	};
};
