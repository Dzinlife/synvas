import { lazy, Suspense } from "react";
import Header from "@nle/components/Header";

const Editor = lazy(() => import("@nle/editor/index"));

export default function AiNleEditorApp() {
	return (
		<div className="flex flex-col flex-1 min-h-0">
			<Header />
			<div className="flex flex-col flex-1 min-h-0">
				<Suspense fallback={<div>Loading CanvasKit...</div>}>
					<Editor />
				</Suspense>
			</div>
		</div>
	);
}

