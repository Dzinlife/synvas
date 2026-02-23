import type { TimelineAsset } from "core/dsl/types";
import { useProjectStore } from "./projectStore";

const EMPTY_ASSETS: TimelineAsset[] = [];

export const useProjectAssets = () => {
	const assets = useProjectStore(
		(state) => state.currentProject?.assets ?? EMPTY_ASSETS,
	);
	const ensureProjectAssetByUri = useProjectStore(
		(state) => state.ensureProjectAssetByUri,
	);
	const getProjectAssetById = useProjectStore(
		(state) => state.getProjectAssetById,
	);
	const findProjectAssetByUri = useProjectStore(
		(state) => state.findProjectAssetByUri,
	);
	const updateProjectAssetMeta = useProjectStore(
		(state) => state.updateProjectAssetMeta,
	);

	return {
		assets,
		ensureProjectAssetByUri,
		getProjectAssetById,
		findProjectAssetByUri,
		updateProjectAssetMeta,
	};
};
