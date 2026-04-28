import { useMemo } from "react";
import { WithSkiaWeb } from "react-skia-lite/bootstrap";
import { AgentProvider, createEditorAgentClient } from "@/agent-system";
import Header from "../components/Header";
import { createEditorRuntime } from "../scene-editor/runtime/createEditorRuntime";
import { EditorRuntimeProvider } from "../scene-editor/runtime/EditorRuntimeProvider";
import OtLabPanel from "@/studio/history/OtLabPanel";
import { getEditorSkiaBackendPreference } from "./skiaBackendPreference";
import { useBlockBrowserHistorySwipe } from "./useBlockBrowserHistorySwipe";

export default function EditorApp() {
	useBlockBrowserHistorySwipe();

	const runtime = useMemo(() => createEditorRuntime(), []);
	const agentClient = useMemo(() => createEditorAgentClient(), []);
	const skiaBackendPreference = useMemo(
		() => getEditorSkiaBackendPreference(),
		[],
	);

	return (
		<EditorRuntimeProvider runtime={runtime}>
			<AgentProvider client={agentClient}>
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
			</AgentProvider>
		</EditorRuntimeProvider>
	);
}
