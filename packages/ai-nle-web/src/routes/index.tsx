import { createFileRoute } from "@tanstack/react-router";
import { AiNleEditorApp } from "ai-nle-editor";
import { type AsrClient, AsrProvider } from "ai-nle-editor/asr";
import { transcribeAudioFile } from "@/asr/asrService";

export const Route = createFileRoute("/")({
	component: RouteComponent,
	ssr: false,
});

const asrClient: AsrClient = {
	transcribeAudioFile,
};

function RouteComponent() {
	return (
		<AsrProvider value={asrClient}>
			<AiNleEditorApp />
		</AsrProvider>
	);
}
