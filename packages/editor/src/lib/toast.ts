import { Toast } from "@base-ui/react/toast";

const toastManager = Toast.createToastManager();

const toast = {
	error: (message: string) =>
		toastManager.add({ title: message, type: "error" }),
};

export { toast, toastManager };
