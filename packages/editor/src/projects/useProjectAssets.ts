import type { TimelineAsset } from "core/timeline-system/types";
import { useProjectStore } from "./projectStore";

const EMPTY_ASSETS: TimelineAsset[] = [];

export const useProjectAssets = () => {
	const assets = useProjectStore(
		(state) => state.currentProject?.assets ?? EMPTY_ASSETS,
	);
	const ensureProjectAsset = useProjectStore(
		(state) => state.ensureProjectAsset,
	);
	const getProjectAssetById = useProjectStore(
		(state) => state.getProjectAssetById,
	);
	const updateProjectAssetMeta = useProjectStore(
		(state) => state.updateProjectAssetMeta,
	);

	return {
		assets,
		ensureProjectAsset,
		getProjectAssetById,
		updateProjectAssetMeta,
	};
};
