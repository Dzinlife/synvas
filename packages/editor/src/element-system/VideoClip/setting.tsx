import { resolveAssetDisplayLabel } from "@/projects/assetLocator";
import { useProjectStore } from "@/projects/projectStore";
import { useProjectAssets } from "@/projects/useProjectAssets";
import type { ElementComponentSettingProps } from "../model/componentRegistry";
import type { VideoClipProps } from "./model";

export const VideoClipSetting = ({
	element,
	updateProps,
}: ElementComponentSettingProps<VideoClipProps>) => {
	const reversed = Boolean(element.props.reversed);
	const { getProjectAssetById } = useProjectAssets();
	const currentProjectId = useProjectStore((state) => state.currentProjectId);
	const source = getProjectAssetById(element.assetId ?? "");
	const sourceLabel = resolveAssetDisplayLabel(source, {
		projectId: currentProjectId,
	});

	return (
		<div className="space-y-3 pt-2 border-t border-white/10">
			<div className="text-xs font-medium text-neutral-300">Video</div>

			<div className="space-y-1.5">
				<div className="text-xs text-neutral-400">Source</div>
				<div className="text-xs text-neutral-200 break-all">
					{sourceLabel ?? "未绑定素材"}
				</div>
			</div>

			<div className="space-y-1.5">
				<div className="text-xs text-neutral-400">Playback</div>
				<div className="grid grid-cols-2 gap-2">
					<button
						type="button"
						onClick={() => {
							if (!reversed) return;
							updateProps({ reversed: false });
						}}
						className={`rounded-md border px-2 py-1 text-xs transition-colors ${
							!reversed
								? "border-blue-500 bg-blue-500/20 text-blue-300"
								: "border-white/10 bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
						}`}
					>
						Forward
					</button>
					<button
						type="button"
						onClick={() => {
							if (reversed) return;
							updateProps({ reversed: true });
						}}
						className={`rounded-md border px-2 py-1 text-xs transition-colors ${
							reversed
								? "border-blue-500 bg-blue-500/20 text-blue-300"
								: "border-white/10 bg-neutral-800 text-neutral-300 hover:bg-neutral-700"
						}`}
					>
						Reverse
					</button>
				</div>
			</div>
		</div>
	);
};
