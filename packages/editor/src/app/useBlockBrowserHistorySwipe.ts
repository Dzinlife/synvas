import { useEffect } from "react";

const HORIZONTAL_WHEEL_THRESHOLD = 0.5;
const SCROLL_EDGE_EPSILON = 1;
const SCROLLABLE_OVERFLOW_VALUES = new Set(["auto", "scroll", "overlay"]);

const isDominantHorizontalWheel = (event: WheelEvent): boolean => {
	const absDeltaX = Math.abs(event.deltaX);
	return (
		absDeltaX > HORIZONTAL_WHEEL_THRESHOLD && absDeltaX > Math.abs(event.deltaY)
	);
};

const canScrollHorizontally = (element: Element, deltaX: number): boolean => {
	if (!(element instanceof HTMLElement)) return false;

	const maxScrollLeft = element.scrollWidth - element.clientWidth;
	if (maxScrollLeft <= SCROLL_EDGE_EPSILON) return false;

	const overflowX = window.getComputedStyle(element).overflowX;
	if (!SCROLLABLE_OVERFLOW_VALUES.has(overflowX)) return false;

	if (deltaX < 0) {
		return element.scrollLeft > SCROLL_EDGE_EPSILON;
	}

	return element.scrollLeft < maxScrollLeft - SCROLL_EDGE_EPSILON;
};

const canAnyAncestorConsumeHorizontalWheel = (event: WheelEvent): boolean => {
	const path = event.composedPath();
	for (const target of path) {
		if (target === document || target === window) break;
		if (!(target instanceof Element)) continue;
		if (canScrollHorizontally(target, event.deltaX)) return true;
	}
	return false;
};

export const useBlockBrowserHistorySwipe = (): void => {
	useEffect(() => {
		const handleWheel = (event: WheelEvent) => {
			if (!event.cancelable) return;
			if (!isDominantHorizontalWheel(event)) return;
			if (canAnyAncestorConsumeHorizontalWheel(event)) return;

			// DOM 区域没有消费横向滚动时，阻止 Chrome 把这次手势升级成历史导航。
			event.preventDefault();
		};

		document.addEventListener("wheel", handleWheel, {
			capture: true,
			passive: false,
		});

		return () => {
			document.removeEventListener("wheel", handleWheel, {
				capture: true,
			});
		};
	}, []);
};
