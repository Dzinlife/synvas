import type { AudioClipProps } from "./model";

interface AudioClipRendererProps extends AudioClipProps {
	id: string;
}

const AudioClipRenderer = ({ id }: AudioClipRendererProps) => {
	// 音频播放由 TimelineAudioMixManager 统一驱动。
	void id;
	return null;
};

export default AudioClipRenderer;
