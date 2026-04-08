import { EditorApp } from "@synvas/editor";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
	component: RouteComponent,
	ssr: false,
});

function RouteComponent() {
	return <EditorApp />;
}
