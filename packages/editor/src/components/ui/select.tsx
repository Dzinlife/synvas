import { Select as SelectPrimitive } from "@base-ui/react/select";
import type * as React from "react";

import { cn } from "@/lib/utils";

const Select = SelectPrimitive.Root;

function SelectTrigger({
	className,
	children,
	...props
}: SelectPrimitive.Trigger.Props) {
	return (
		<SelectPrimitive.Trigger
			className={cn(
				"flex h-10 min-w-40 items-center justify-between gap-3 rounded-md border border-gray-200 pr-3 pl-3.5 text-base bg-[canvas] text-gray-900 select-none hover:bg-gray-100 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-blue-800 data-popup-open:bg-gray-100",
				className,
			)}
			{...props}
		>
			{children}
			<SelectPrimitive.Icon className="flex">
				<ChevronUpDownIcon />
			</SelectPrimitive.Icon>
		</SelectPrimitive.Trigger>
	);
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
	return (
		<SelectPrimitive.Value
			className={cn("data-placeholder:opacity-60", className)}
			{...props}
		/>
	);
}

function SelectContent({
	className,
	sideOffset = 8,
	children,
	...props
}: SelectPrimitive.Popup.Props &
	Pick<SelectPrimitive.Positioner.Props, "sideOffset">) {
	return (
		<SelectPrimitive.Portal>
			<SelectPrimitive.Positioner
				className="outline-none select-none z-999"
				sideOffset={sideOffset}
			>
				<SelectPrimitive.Popup
					className={cn(
						"group min-w-(--anchor-width) origin-(--transform-origin) bg-clip-padding rounded-md bg-[canvas] text-gray-900 shadow-lg shadow-gray-200 outline outline-gray-200 transition-[transform,scale,opacity] data-ending-style:scale-90 data-ending-style:opacity-0 data-[side=none]:min-w-[calc(var(--anchor-width)+1rem)] data-[side=none]:data-ending-style:transition-none data-starting-style:scale-90 data-starting-style:opacity-0 data-[side=none]:data-starting-style:scale-100 data-[side=none]:data-starting-style:opacity-100 data-[side=none]:data-starting-style:transition-none dark:shadow-none dark:outline-gray-300",
						className,
					)}
					{...props}
				>
					<SelectPrimitive.ScrollUpArrow className="top-0 z-1 flex h-4 w-full cursor-default items-center justify-center rounded-md bg-[canvas] text-center text-xs before:absolute data-[side=none]:before:-top-full before:left-0 before:h-full before:w-full before:content-['']" />
					<SelectPrimitive.List className="relative py-1 scroll-py-6 overflow-y-auto max-h-(--available-height)">
						{children}
					</SelectPrimitive.List>
					<SelectPrimitive.ScrollDownArrow className="bottom-0 z-1 flex h-4 w-full cursor-default items-center justify-center rounded-md bg-[canvas] text-center text-xs before:absolute before:left-0 before:h-full before:w-full before:content-[''] data-[side=none]:before:-bottom-full" />
				</SelectPrimitive.Popup>
			</SelectPrimitive.Positioner>
		</SelectPrimitive.Portal>
	);
}

function SelectItem({
	className,
	children,
	...props
}: SelectPrimitive.Item.Props) {
	return (
		<SelectPrimitive.Item
			className={cn(
				"grid cursor-default grid-cols-[0.75rem_1fr] items-center gap-2 py-2 pr-4 pl-2.5 text-sm leading-4 outline-none select-none group-data-[side=none]:pr-12 group-data-[side=none]:text-base group-data-[side=none]:leading-4 data-highlighted:relative data-highlighted:z-0 data-highlighted:text-gray-50 data-highlighted:before:absolute data-highlighted:before:inset-x-1 data-highlighted:before:inset-y-0 data-highlighted:before:z-[-1] data-highlighted:before:rounded-sm data-highlighted:before:bg-gray-900 pointer-coarse:py-2.5 pointer-coarse:text-[0.925rem]",
				className,
			)}
			{...props}
		>
			<SelectPrimitive.ItemIndicator className="col-start-1">
				<CheckIcon className="size-3" />
			</SelectPrimitive.ItemIndicator>
			<SelectPrimitive.ItemText className="col-start-2">
				{children}
			</SelectPrimitive.ItemText>
		</SelectPrimitive.Item>
	);
}

function ChevronUpDownIcon(props: React.ComponentProps<"svg">) {
	return (
		<svg
			width="8"
			height="12"
			viewBox="0 0 8 12"
			fill="none"
			stroke="currentcolor"
			strokeWidth="1.5"
			aria-hidden="true"
			{...props}
		>
			<path d="M0.5 4.5L4 1.5L7.5 4.5" />
			<path d="M0.5 7.5L4 10.5L7.5 7.5" />
		</svg>
	);
}

function CheckIcon(props: React.ComponentProps<"svg">) {
	return (
		<svg
			fill="currentcolor"
			width="10"
			height="10"
			viewBox="0 0 10 10"
			aria-hidden="true"
			{...props}
		>
			<path d="M9.1603 1.12218C9.50684 1.34873 9.60427 1.81354 9.37792 2.16038L5.13603 8.66012C5.01614 8.8438 4.82192 8.96576 4.60451 8.99384C4.3871 9.02194 4.1683 8.95335 4.00574 8.80615L1.24664 6.30769C0.939709 6.02975 0.916013 5.55541 1.19372 5.24822C1.47142 4.94102 1.94536 4.91731 2.2523 5.19524L4.36085 7.10461L8.12299 1.33999C8.34934 0.993152 8.81376 0.895638 9.1603 1.12218Z" />
		</svg>
	);
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
