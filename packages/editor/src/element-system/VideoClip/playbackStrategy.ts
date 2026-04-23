import type { RenderFrameChannel } from "core/timeline-system/model/types";
import type { VideoSeekOptions } from "./model";

export const applyPlayingPlaybackStrategy = (options: {
	reversed: boolean;
	videoTime: number;
	frameChannel: RenderFrameChannel;
	seekToTime: (seconds: number, options?: VideoSeekOptions) => Promise<void>;
	stepPlayback: (
		seconds: number,
		frameChannel?: RenderFrameChannel,
	) => Promise<void>;
}): "seek" | "step" => {
	const { reversed, videoTime, frameChannel, seekToTime, stepPlayback } = options;
	if (reversed) {
		void seekToTime(videoTime, {
			reason: "reverse-playback",
			frameChannel,
		});
		return "seek";
	}
	void stepPlayback(videoTime, frameChannel);
	return "step";
};
