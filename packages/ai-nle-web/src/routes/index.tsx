import { createFileRoute } from "@tanstack/react-router";
import { AiNleEditorApp } from "ai-nle-editor";

export const Route = createFileRoute("/")({
	component: RouteComponent,
	ssr: false,
});

function RouteComponent() {
	return (
		<AiNleEditorApp />
	);
}
