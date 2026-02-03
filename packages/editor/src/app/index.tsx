import Header from "@/components/Header";
import { lazy, Suspense } from "react";

const Editor = lazy(() => import("@/editor/index"));

export default function EditorApp() {
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
