"use client";

import { Slider as SliderPrimitive } from "@base-ui/react/slider";
import * as React from "react";

import { cn } from "@/lib/utils";

function Slider({
	className,
	defaultValue,
	value,
	thumbAlignment = "edge",
	...props
}: SliderPrimitive.Root.Props) {
	const values = React.useMemo(() => {
		const current = value ?? defaultValue;
		if (Array.isArray(current)) {
			return current;
		}
		if (typeof current === "number") {
			return [current];
		}
		return [0];
	}, [value, defaultValue]);
	const thumbIdsRef = React.useRef<string[]>([]);
	const nextThumbIdRef = React.useRef(0);

	if (thumbIdsRef.current.length < values.length) {
		const missingCount = values.length - thumbIdsRef.current.length;
		for (let i = 0; i < missingCount; i += 1) {
			nextThumbIdRef.current += 1;
			thumbIdsRef.current.push(`thumb-${nextThumbIdRef.current}`);
		}
	} else if (thumbIdsRef.current.length > values.length) {
		thumbIdsRef.current = thumbIdsRef.current.slice(0, values.length);
	}

	return (
		<SliderPrimitive.Root
			defaultValue={defaultValue}
			value={value}
			thumbAlignment={thumbAlignment}
			{...props}
		>
			<SliderPrimitive.Control
				className={cn(
					"group flex w-56 touch-none items-center py-3 select-none",
					className,
				)}
			>
				<SliderPrimitive.Track className="h-1 w-full rounded bg-gray-300  select-none">
					<SliderPrimitive.Indicator className="rounded bg-gray-700 select-none" />
					{thumbIdsRef.current.map((thumbId, index) => (
						<SliderPrimitive.Thumb
							key={thumbId}
							index={index}
							className="w-4 h-3 rounded-full bg-white outline-transparent select-none has-focus-visible:outline-2 has-focus-visible:outline-blue-400 group-hover:scale-115 transition"
						/>
					))}
				</SliderPrimitive.Track>
			</SliderPrimitive.Control>
		</SliderPrimitive.Root>
	);
}

export { Slider };
