import { Menu, Menu as MenuPrimitive } from "@base-ui/react/menu";

import { cn } from "@/lib/utils";

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
	return <MenuPrimitive.Root {...props} />;
}

function DropdownMenuTrigger({
	className,
	children,
	chevron,
	...props
}: MenuPrimitive.Trigger.Props & {
	chevron?: React.ReactNode | boolean;
}) {
	return (
		<MenuPrimitive.Trigger
			className={cn(
				"flex h-10 items-center justify-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-3.5 text-base font-medium text-gray-900 select-none hover:bg-gray-100 focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-blue-800 active:bg-gray-100 data-popup-open:bg-gray-100",
				className,
			)}
			{...props}
		>
			{children}
			{typeof chevron === "boolean" || chevron === undefined ? (
				chevron ? (
					<ChevronDownIcon className="-mr-1" />
				) : null
			) : (
				chevron
			)}
		</MenuPrimitive.Trigger>
	);
}

function ChevronDownIcon(props: React.ComponentProps<"svg">) {
	return (
		<svg
			width="10"
			height="10"
			viewBox="0 0 10 10"
			fill="none"
			aria-hidden="true"
			{...props}
		>
			<path d="M1 3.5L5 7.5L9 3.5" stroke="currentcolor" strokeWidth="1.5" />
		</svg>
	);
}

function DropdownMenuContent({
	className,
	side = "bottom",
	align = "start",
	alignOffset = 0,
	sideOffset = 8,
	children,
	...props
}: MenuPrimitive.Popup.Props &
	Pick<
		MenuPrimitive.Positioner.Props,
		"side" | "align" | "alignOffset" | "sideOffset"
	>) {
	return (
		<MenuPrimitive.Portal>
			<MenuPrimitive.Positioner
				className="outline-none"
				side={side}
				align={align}
				alignOffset={alignOffset}
				sideOffset={sideOffset}
			>
				<MenuPrimitive.Popup
					className={cn(
						"origin-(--transform-origin) rounded-md bg-[canvas] py-1 text-gray-900 shadow-lg shadow-gray-200 outline outline-gray-200 transition-[transform,scale,opacity] data-ending-style:scale-90 data-ending-style:opacity-0 data-starting-style:scale-90 data-starting-style:opacity-0 dark:shadow-none dark:-outline-offset-1 dark:outline-gray-300",
						className,
					)}
					{...props}
				>
					<Menu.Arrow className="data-[side=bottom]:top-[-8px] data-[side=left]:right-[-13px] data-[side=left]:rotate-90 data-[side=right]:left-[-13px] data-[side=right]:-rotate-90 data-[side=top]:bottom-[-8px] data-[side=top]:rotate-180">
						<ArrowSvg />
					</Menu.Arrow>
					{children}
				</MenuPrimitive.Popup>
			</MenuPrimitive.Positioner>
		</MenuPrimitive.Portal>
	);
}

function ArrowSvg(props: React.ComponentProps<"svg">) {
	return (
		<svg
			width="20"
			height="10"
			viewBox="0 0 20 10"
			fill="none"
			aria-hidden="true"
			{...props}
		>
			<path
				d="M9.66437 2.60207L4.80758 6.97318C4.07308 7.63423 3.11989 8 2.13172 8H0V10H20V8H18.5349C17.5468 8 16.5936 7.63423 15.8591 6.97318L11.0023 2.60207C10.622 2.2598 10.0447 2.25979 9.66437 2.60207Z"
				className="fill-[canvas]"
			/>
			<path
				d="M8.99542 1.85876C9.75604 1.17425 10.9106 1.17422 11.6713 1.85878L16.5281 6.22989C17.0789 6.72568 17.7938 7.00001 18.5349 7.00001L15.89 7L11.0023 2.60207C10.622 2.2598 10.0447 2.2598 9.66436 2.60207L4.77734 7L2.13171 7.00001C2.87284 7.00001 3.58774 6.72568 4.13861 6.22989L8.99542 1.85876Z"
				className="fill-gray-200 dark:fill-none"
			/>
			<path
				d="M10.3333 3.34539L5.47654 7.71648C4.55842 8.54279 3.36693 9 2.13172 9H0V8H2.13172C3.11989 8 4.07308 7.63423 4.80758 6.97318L9.66437 2.60207C10.0447 2.25979 10.622 2.2598 11.0023 2.60207L15.8591 6.97318C16.5936 7.63423 17.5468 8 18.5349 8H20V9H18.5349C17.2998 9 16.1083 8.54278 15.1901 7.71648L10.3333 3.34539Z"
				className="dark:fill-gray-300"
			/>
		</svg>
	);
}

function DropdownMenuItem({ className, ...props }: MenuPrimitive.Item.Props) {
	return (
		<MenuPrimitive.Item
			className={cn(
				"flex cursor-default py-2 pr-8 pl-4 text-sm leading-4 outline-none select-none data-highlighted:relative data-highlighted:z-0 data-highlighted:text-gray-50 data-highlighted:before:absolute data-highlighted:before:inset-x-1 data-highlighted:before:inset-y-0 data-highlighted:before:z-[-1] data-highlighted:before:rounded-sm data-highlighted:before:bg-gray-900",
				className,
			)}
			{...props}
		/>
	);
}

function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
	return <MenuPrimitive.Group {...props} />;
}

function DropdownMenuLabel({
	className,
	...props
}: MenuPrimitive.GroupLabel.Props) {
	return (
		<MenuPrimitive.GroupLabel
			className={cn("px-4 py-1.5 text-xs font-medium text-gray-600", className)}
			{...props}
		/>
	);
}

function DropdownMenuSeparator({
	className,
	...props
}: MenuPrimitive.Separator.Props) {
	return (
		<MenuPrimitive.Separator
			className={cn("mx-4 my-1.5 h-px bg-gray-200", className)}
			{...props}
		/>
	);
}

export {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
};
