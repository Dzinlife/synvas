import { useMemo } from "react";
import { WithSkiaWeb } from "react-skia-lite/bootstrap";
import Header from "../components/Header";
import { createEditorRuntime } from "../scene-editor/runtime/createEditorRuntime";
import { EditorRuntimeProvider } from "../scene-editor/runtime/EditorRuntimeProvider";
import OtLabPanel from "@/studio/history/OtLabPanel";
import { getEditorSkiaBackendPreference } from "./skiaBackendPreference";

export default function EditorApp() {
	const runtime = useMemo(() => createEditorRuntime(), []);
	const skiaBackendPreference = useMemo(
		() => getEditorSkiaBackendPreference(),
		[],
	);

	return (
		<EditorRuntimeProvider runtime={runtime}>
			<div className="flex flex-col flex-1 min-h-0">
				<Header />
				<div className="flex flex-1 min-h-0">
					<div className="flex flex-col flex-1 min-h-0">
						<WithSkiaWeb
							fallback={<div>Loading CanvasKit...</div>}
							getComponent={() => import("../scene-editor/index")}
							opts={{ backendPreference: skiaBackendPreference }}
						/>
					</div>
					<OtLabPanel />
				</div>
			</div>
		</EditorRuntimeProvider>
	);
}
