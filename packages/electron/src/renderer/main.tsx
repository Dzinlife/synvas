import EditorApp from "@ai-nle/editor/app";
import { AsrProvider } from "@ai-nle/editor/asr";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@ai-nle/editor/styles.css";
import { electronAsrClient } from "./asr/electronAsrClient";

const container = document.getElementById("root");
if (!container) {
	throw new Error("Root 容器未找到");
}

createRoot(container).render(
	<StrictMode>
		<AsrProvider value={electronAsrClient}>
			<EditorApp />
		</AsrProvider>
	</StrictMode>,
);
