import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogClose = DialogPrimitive.Close;

function DialogContent({
	className,
	backdropClassName,
	children,
	...props
}: DialogPrimitive.Popup.Props & {
	backdropClassName?: string;
}) {
	return (
		<DialogPrimitive.Portal>
			<DialogPrimitive.Backdrop
				className={cn(
					"fixed inset-0 z-999 bg-black/55 backdrop-blur-[1px] transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0",
					backdropClassName,
				)}
			/>
			<div className="fixed inset-0 z-999 flex items-center justify-center p-4">
				<DialogPrimitive.Popup
					className={cn(
						"w-full max-w-lg rounded-xl border border-neutral-700 bg-neutral-900 text-neutral-100 shadow-2xl outline-none transition-[opacity,transform] data-ending-style:translate-y-1 data-ending-style:opacity-0 data-starting-style:translate-y-1 data-starting-style:opacity-0",
						className,
					)}
					{...props}
				>
					{children}
				</DialogPrimitive.Popup>
			</div>
		</DialogPrimitive.Portal>
	);
}

function DialogTitle({
	className,
	...props
}: DialogPrimitive.Title.Props) {
	return (
		<DialogPrimitive.Title
			className={cn("text-base font-semibold text-neutral-100", className)}
			{...props}
		/>
	);
}

function DialogDescription({
	className,
	...props
}: DialogPrimitive.Description.Props) {
	return (
		<DialogPrimitive.Description
			className={cn("text-sm text-neutral-400", className)}
			{...props}
		/>
	);
}

export {
	Dialog,
	DialogTrigger,
	DialogContent,
	DialogTitle,
	DialogDescription,
	DialogClose,
};
