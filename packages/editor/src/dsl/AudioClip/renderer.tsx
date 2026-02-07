import { useTimelineAudioPlayback } from "../hooks/useTimelineAudioPlayback";
import { createModelSelector } from "../model/registry";
import type { AudioClipInternal, AudioClipProps } from "./model";

interface AudioClipRendererProps extends AudioClipProps {
	id: string;
}

const useAudioClipSelector = createModelSelector<
	AudioClipProps,
	AudioClipInternal
>();

const AudioClipRenderer: React.FC<AudioClipRendererProps> = ({ id }) => {
	const uri = useAudioClipSelector(id, (state) => state.props.uri);
	const isLoading = useAudioClipSelector(
		id,
		(state) => state.constraints.isLoading ?? false,
	);
	const hasError = useAudioClipSelector(
		id,
		(state) => state.constraints.hasError ?? false,
	);
	const audioDuration = useAudioClipSelector(
		id,
		(state) => state.internal.audioDuration,
	);
	const stepPlayback = useAudioClipSelector(
		id,
		(state) => state.internal.stepPlayback,
	);
	const stopPlayback = useAudioClipSelector(
		id,
		(state) => state.internal.stopPlayback,
	);

	useTimelineAudioPlayback({
		id,
		uri,
		isLoading,
		hasError,
		audioDuration,
		stepPlayback,
		stopPlayback,
	});

	return null;
};

export default AudioClipRenderer;
