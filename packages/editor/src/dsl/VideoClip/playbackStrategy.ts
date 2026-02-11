import type { VideoSeekOptions } from "./model";

export const applyPlayingPlaybackStrategy = (options: {
	reversed: boolean;
	videoTime: number;
	seekToTime: (seconds: number, options?: VideoSeekOptions) => Promise<void>;
	stepPlayback: (seconds: number) => Promise<void>;
}): "seek" | "step" => {
	const { reversed, videoTime, seekToTime, stepPlayback } = options;
	if (reversed) {
		void seekToTime(videoTime, { reason: "reverse-playback" });
		return "seek";
	}
	void stepPlayback(videoTime);
	return "step";
};
