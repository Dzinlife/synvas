import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import type { DSLComponentSettingProps } from "../model/componentRegistry";
import type { AudioClipProps } from "./model";

export const AudioClipSetting = ({
	element,
	updateProps,
}: DSLComponentSettingProps<AudioClipProps>) => {
	const sourceUri =
		typeof element.props.uri === "string" ? element.props.uri : "";
	const reversed = Boolean(element.props.reversed);
	const [uriDraft, setUriDraft] = useState(sourceUri);

	useEffect(() => {
		setUriDraft(sourceUri);
	}, [sourceUri]);

	const commitUri = () => {
		if (uriDraft === sourceUri) return;
		updateProps({ uri: uriDraft });
	};

	return (
		<div className="space-y-3 pt-2 border-t border-white/10">
			<div className="text-xs font-medium text-neutral-300">Audio</div>

			<div className="space-y-1.5">
				<div className="text-xs text-neutral-400">Source URI</div>
				<Input
					aria-label="Source URI"
					className="h-8 w-full text-xs px-2"
					value={uriDraft}
					onChange={(event) => {
						setUriDraft(event.target.value);
					}}
					onBlur={() => {
						commitUri();
					}}
					onKeyDown={(event) => {
						if (event.key !== "Enter") return;
						commitUri();
						event.currentTarget.blur();
					}}
				/>
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
