import { lazy, Suspense, useMemo } from "react";
import Header from "@/components/Header";
import { createEditorRuntime } from "@/editor/runtime/createEditorRuntime";
import { EditorRuntimeProvider } from "@/editor/runtime/EditorRuntimeProvider";

const Editor = lazy(() => import("@/editor/index"));

export default function EditorApp() {
	const runtime = useMemo(() => createEditorRuntime(), []);

	return (
		<EditorRuntimeProvider runtime={runtime}>
			<div className="flex flex-col flex-1 min-h-0">
				<Header />
				<div className="flex flex-col flex-1 min-h-0">
					<Suspense fallback={<div>Loading CanvasKit...</div>}>
						<Editor />
					</Suspense>
				</div>
			</div>
		</EditorRuntimeProvider>
	);
}
