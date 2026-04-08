import EditorApp from "@synvas/editor/app";
import { AsrProvider } from "@synvas/editor/asr";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@synvas/editor/styles.css";
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
