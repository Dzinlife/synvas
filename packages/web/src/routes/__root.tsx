import appCss from "@synvas/editor/styles.css?url";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import { lazy, Suspense, useEffect } from "react";

// Lazy load devtools to prevent syntax errors from breaking the app
const TanStackDevtools = lazy(() =>
	import("@tanstack/react-devtools").then((mod) => ({
		default: mod.TanStackDevtools,
	})),
);

const TanStackRouterDevtoolsPanel = lazy(() =>
	import("@tanstack/react-router-devtools").then((mod) => ({
		default: mod.TanStackRouterDevtoolsPanel,
	})),
);

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content:
					"width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
			},
			{
				title: "synvas",
			},
		],
		links: [
			{
				rel: "stylesheet",
				href: appCss,
			},
		],
	}),

	shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
	// 全局禁止浏览器默认的 pinch-to-zoom 行为
	// 注意：touchmove 的阻止通过 CSS touch-action: none 实现，不在这里处理
	// 因为 JS 层面的 preventDefault 会阻止 React 事件处理器正常工作
	useEffect(() => {
		const preventGestureZoom = (e: Event) => {
			e.preventDefault();
		};

		const preventWheelZoom = (e: WheelEvent) => {
			// 阻止 ctrl + 滚轮缩放
			if (e.ctrlKey) {
				e.preventDefault();
			}
		};

		// 阻止 Safari 的 gesturestart/gesturechange/gestureend 缩放
		document.addEventListener("gesturestart", preventGestureZoom);
		document.addEventListener("gesturechange", preventGestureZoom);
		document.addEventListener("gestureend", preventGestureZoom);
		// 阻止 ctrl + 滚轮缩放
		document.addEventListener("wheel", preventWheelZoom, { passive: false });

		return () => {
			document.removeEventListener("gesturestart", preventGestureZoom);
			document.removeEventListener("gesturechange", preventGestureZoom);
			document.removeEventListener("gestureend", preventGestureZoom);
			document.removeEventListener("wheel", preventWheelZoom);
		};
	}, []);

	return (
		<html lang="en" className="dark">
			<head>
				<HeadContent />
				<meta
					name="viewport"
					content="width=device-width, initial-scale=1, user-scalable=no"
				/>
			</head>
			<body
				style={{
					touchAction: "none",
					userSelect: "none",
					WebkitUserSelect: "none",
				}}
			>
				{children}
				{import.meta.env.DEV && (
					<Suspense fallback={null}>
						<TanStackDevtools
							config={{
								position: "bottom-right",
							}}
							plugins={[
								{
									name: "Tanstack Router",
									render: (
										<Suspense fallback={null}>
											<TanStackRouterDevtoolsPanel />
										</Suspense>
									),
								},
							]}
						/>
					</Suspense>
				)}
				<Scripts />
			</body>
		</html>
	);
}
