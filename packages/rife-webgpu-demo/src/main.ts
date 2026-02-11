import * as ort from "onnxruntime-web/webgpu";
import "./style.css";

type MetadataLike = {
	shape?: readonly (number | string | null | undefined)[];
	type?: string;
};

const float32View = new Float32Array(1);
const uint32View = new Uint32Array(float32View.buffer);

const float32ToFloat16Bits = (value: number): number => {
	float32View[0] = value;
	const bits = uint32View[0];
	const sign = (bits >>> 16) & 0x8000;
	const mantissa = bits & 0x007fffff;
	const exponent = (bits >>> 23) & 0xff;

	if (exponent === 0xff) {
		if (mantissa !== 0) return sign | 0x7e00;
		return sign | 0x7c00;
	}

	const halfExponent = exponent - 127 + 15;
	if (halfExponent >= 0x1f) return sign | 0x7c00;
	if (halfExponent <= 0) {
		if (halfExponent < -10) return sign;
		const shifted = (mantissa | 0x00800000) >>> (1 - halfExponent);
		return sign | ((shifted + 0x00001000) >>> 13);
	}

	return sign | (halfExponent << 10) | ((mantissa + 0x00001000) >>> 13);
};

const float16BitsToFloat32 = (bits: number): number => {
	const sign = (bits & 0x8000) !== 0 ? -1 : 1;
	const exponent = (bits >>> 10) & 0x1f;
	const fraction = bits & 0x03ff;
	if (exponent === 0) {
		if (fraction === 0) return sign * 0;
		return sign * 2 ** -14 * (fraction / 1024);
	}
	if (exponent === 0x1f) {
		return fraction === 0 ? sign * Number.POSITIVE_INFINITY : Number.NaN;
	}
	return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
};

const resolveTensorType = (
	metadata: MetadataLike | undefined,
): "float16" | "float32" =>
	metadata?.type === "float16" ? "float16" : "float32";

const createTensorFromFloatData = (
	data: Float32Array,
	dims: readonly number[],
	metadata: MetadataLike | undefined,
): ort.Tensor => {
	const tensorType = resolveTensorType(metadata);
	if (tensorType === "float16") {
		const float16Data = new Uint16Array(data.length);
		for (let i = 0; i < data.length; i += 1) {
			float16Data[i] = float32ToFloat16Bits(data[i]);
		}
		return new ort.Tensor("float16", float16Data, dims);
	}
	return new ort.Tensor("float32", data, dims);
};

const isNativeFloat16Array = (value: unknown): value is ArrayLike<number> => {
	const maybeCtor = (globalThis as { Float16Array?: unknown }).Float16Array;
	if (typeof maybeCtor !== "function") return false;
	return value instanceof (maybeCtor as new (...args: unknown[]) => object);
};

const decodeFloat16BitsArray = (bitsArray: Uint16Array): Float32Array => {
	const out = new Float32Array(bitsArray.length);
	for (let i = 0; i < bitsArray.length; i += 1) {
		out[i] = float16BitsToFloat32(bitsArray[i]);
	}
	return out;
};

const tensorDataToFloat32 = (tensor: ort.Tensor): Float32Array => {
	const rawData = tensor.data as unknown;
	if (rawData instanceof Float32Array) {
		return rawData;
	}
	if (tensor.type === "float16") {
		if (rawData instanceof Uint16Array) {
			return decodeFloat16BitsArray(rawData);
		}
		if (isNativeFloat16Array(rawData)) {
			return Float32Array.from(rawData);
		}
		if (ArrayBuffer.isView(rawData)) {
			const view = rawData as ArrayBufferView;
			if (view.byteLength % 2 === 0) {
				const bits = new Uint16Array(
					view.buffer,
					view.byteOffset,
					view.byteLength / 2,
				);
				return decodeFloat16BitsArray(bits);
			}
		}
		if (Array.isArray(rawData)) {
			return Float32Array.from(rawData);
		}
	}
	const constructorName =
		rawData && typeof rawData === "object"
			? (rawData as { constructor?: { name?: string } }).constructor?.name
			: typeof rawData;
	throw new Error(
		`Unsupported output tensor data type: ${tensor.type}, raw=${constructorName}`,
	);
};

const must = <T extends HTMLElement>(id: string): T => {
	const element = document.getElementById(id);
	if (!element) {
		throw new Error(`Missing element: #${id}`);
	}
	return element as T;
};

const runtimeStatus = must<HTMLParagraphElement>("runtime-status");
const modelFileInput = must<HTMLInputElement>("model-file");
const providerModeSelect = must<HTMLSelectElement>("provider-mode");
const loadModelButton = must<HTMLButtonElement>("load-model");
const imageAInput = must<HTMLInputElement>("image-a");
const imageBInput = must<HTMLInputElement>("image-b");
const generateSampleButton = must<HTMLButtonElement>("generate-sample");
const timestepInput = must<HTMLInputElement>("timestep");
const targetWidthInput = must<HTMLInputElement>("target-width");
const targetHeightInput = must<HTMLInputElement>("target-height");
const runInferenceButton = must<HTMLButtonElement>("run-inference");
const canvasA = must<HTMLCanvasElement>("canvas-a");
const canvasB = must<HTMLCanvasElement>("canvas-b");
const canvasOut = must<HTMLCanvasElement>("canvas-out");
const logElement = must<HTMLPreElement>("log");

let session: ort.InferenceSession | null = null;
let frameA: ImageBitmap | null = null;
let frameB: ImageBitmap | null = null;
let latestModelBuffer: ArrayBuffer | null = null;
let latestProviderMode: "webgpu" | "webgpu-wasm" | "wasm" | null = null;

const appendLog = (message: string): void => {
	const time = new Date().toLocaleTimeString();
	logElement.textContent += `[${time}] ${message}\n`;
	logElement.scrollTop = logElement.scrollHeight;
};

const clearLog = (): void => {
	logElement.textContent = "";
};

const isWebGpuAvailable = (): boolean => {
	const nav = navigator as Navigator & { gpu?: unknown };
	return Boolean(nav.gpu);
};

runtimeStatus.textContent = isWebGpuAvailable()
	? "WebGPU 可用，可以执行验证。"
	: "WebGPU 不可用，webgpu provider 会直接失败。";

ort.env.logLevel = "warning";
// 这里显式指定 wasm 资源路径，避免 Vite dev 下 wasm 请求被回退到 index.html。
ort.env.wasm.wasmPaths =
	"https://cdn.jsdelivr.net/npm/onnxruntime-web@1.24.1/dist/";
const webgpuEnv = (
	ort.env as {
		webgpu?: {
			profiling?: {
				mode?: "off" | "default";
			};
		};
	}
).webgpu;
if (webgpuEnv?.profiling) {
	webgpuEnv.profiling.mode = "off";
}

const readTargetSize = (): { width: number; height: number } => {
	const width = Number.parseInt(targetWidthInput.value, 10);
	const height = Number.parseInt(targetHeightInput.value, 10);
	return {
		width: Number.isFinite(width) && width > 0 ? width : 512,
		height: Number.isFinite(height) && height > 0 ? height : 512,
	};
};

const readTimestep = (): number => {
	const raw = Number.parseFloat(timestepInput.value);
	if (!Number.isFinite(raw)) return 0.5;
	return Math.max(0, Math.min(1, raw));
};

const drawBitmapToCanvas = (
	bitmap: ImageBitmap,
	canvas: HTMLCanvasElement,
): void => {
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("Failed to get 2D canvas context.");
	}
	context.clearRect(0, 0, canvas.width, canvas.height);
	context.drawImage(bitmap, 0, 0);
};

const loadBitmapFromFileInput = async (
	input: HTMLInputElement,
	label: string,
): Promise<ImageBitmap | null> => {
	const file = input.files?.[0];
	if (!file) return null;
	const bitmap = await createImageBitmap(file);
	appendLog(`${label} 已加载: ${bitmap.width}x${bitmap.height}`);
	return bitmap;
};

const createSyntheticFrame = async (
	width: number,
	height: number,
	phase: number,
): Promise<ImageBitmap> => {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d");
	if (!context) {
		throw new Error("Failed to build synthetic frame.");
	}

	const gradient = context.createLinearGradient(0, 0, width, height);
	gradient.addColorStop(0, `hsl(${phase * 120}, 80%, 45%)`);
	gradient.addColorStop(1, `hsl(${phase * 120 + 130}, 80%, 40%)`);
	context.fillStyle = gradient;
	context.fillRect(0, 0, width, height);

	context.fillStyle = "rgba(255, 255, 255, 0.8)";
	context.beginPath();
	context.arc(
		width * (0.25 + phase * 0.5),
		height * 0.5,
		height * 0.2,
		0,
		Math.PI * 2,
	);
	context.fill();

	context.fillStyle = "rgba(20, 24, 38, 0.8)";
	context.font = `${Math.max(22, Math.floor(height * 0.07))}px monospace`;
	context.fillText(
		`phase=${phase.toFixed(2)}`,
		18,
		Math.max(40, height * 0.12),
	);

	return createImageBitmap(canvas);
};

const metadataToString = (
	metadataList: readonly ort.InferenceSession.ValueMetadata[] | undefined,
	names: readonly string[],
): string => {
	if (!metadataList) return "(none)";
	return names
		.map((name) => {
			const metadata = metadataList.find((item) => item.name === name);
			if (!metadata) return `${name}: metadata-not-found`;
			if (!metadata.isTensor) return `${name}: non-tensor`;
			const dims = metadata.shape ? `[${metadata.shape.join(", ")}]` : "[]";
			const type = metadata?.type ?? "unknown";
			return `${name}: type=${type}, dims=${dims}`;
		})
		.join(" | ");
};

const normalize4dShape = (
	shape: readonly (number | string | null | undefined)[] | undefined,
	fallback: readonly [number, number, number, number],
): [number, number, number, number] => {
	const resolved = fallback.map((defaultValue, index) => {
		const dim = shape?.[index];
		return typeof dim === "number" && Number.isFinite(dim) && dim > 0
			? Math.floor(dim)
			: defaultValue;
	});
	return [resolved[0], resolved[1], resolved[2], resolved[3]];
};

const bitmapToRgbaPlanar = (
	bitmap: ImageBitmap,
	width: number,
	height: number,
): Float32Array => {
	const canvas = document.createElement("canvas");
	canvas.width = width;
	canvas.height = height;
	const context = canvas.getContext("2d", { willReadFrequently: true });
	if (!context) {
		throw new Error("Failed to create 2D context for image tensor.");
	}

	context.drawImage(bitmap, 0, 0, width, height);
	const rgba = context.getImageData(0, 0, width, height).data;
	const planeSize = width * height;
	const out = new Float32Array(4 * planeSize);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const rgbaIndex = (y * width + x) * 4;
			const base = y * width + x;
			out[base] = rgba[rgbaIndex] / 255;
			out[planeSize + base] = rgba[rgbaIndex + 1] / 255;
			out[2 * planeSize + base] = rgba[rgbaIndex + 2] / 255;
			out[3 * planeSize + base] = rgba[rgbaIndex + 3] / 255;
		}
	}
	return out;
};

const copyChannel = (
	source: Float32Array,
	sourceChannel: number,
	target: Float32Array,
	targetChannel: number,
	planeSize: number,
): void => {
	const sourceStart = sourceChannel * planeSize;
	const sourceEnd = sourceStart + planeSize;
	target.set(
		source.subarray(sourceStart, sourceEnd),
		targetChannel * planeSize,
	);
};

const bitmapToImageTensor = (
	bitmap: ImageBitmap,
	metadata: MetadataLike | undefined,
	targetWidth: number,
	targetHeight: number,
): ort.Tensor => {
	// 这里按 NCHW 组织输入，优先满足常见的 RIFE ONNX 导出格式。
	const [, channelCount, height, width] = normalize4dShape(metadata?.shape, [
		1,
		3,
		targetHeight,
		targetWidth,
	]);

	if (channelCount !== 4 && channelCount !== 3 && channelCount !== 1) {
		throw new Error(`Unsupported image channel count: ${channelCount}`);
	}

	const rgbaPlanar = bitmapToRgbaPlanar(bitmap, width, height);
	const planeSize = width * height;
	const tensorData = new Float32Array(channelCount * height * width);
	for (let channel = 0; channel < channelCount; channel += 1) {
		copyChannel(rgbaPlanar, channel, tensorData, channel, planeSize);
	}

	return createTensorFromFloatData(
		tensorData,
		[1, channelCount, height, width],
		metadata,
	);
};

const createScalarTensor = (
	value: number,
	metadata: MetadataLike | undefined,
): ort.Tensor => {
	const dims = metadata?.shape;
	if (!dims || dims.length === 0) {
		return createTensorFromFloatData(new Float32Array([value]), [], metadata);
	}
	const resolved = dims.map((dim) =>
		typeof dim === "number" && Number.isFinite(dim) && dim > 0
			? Math.floor(dim)
			: 1,
	);
	const size = resolved.reduce((acc, item) => acc * item, 1);
	const data = new Float32Array(size);
	data.fill(value);
	return createTensorFromFloatData(data, resolved, metadata);
};

const createZeroTensor = (metadata: MetadataLike | undefined): ort.Tensor => {
	const dims = metadata?.shape;
	const resolved =
		dims && dims.length > 0
			? dims.map((dim) =>
					typeof dim === "number" && Number.isFinite(dim) && dim > 0
						? Math.floor(dim)
						: 1,
				)
			: [1];
	const size = resolved.reduce((acc, item) => acc * item, 1);
	return createTensorFromFloatData(new Float32Array(size), resolved, metadata);
};

const getInputMetadata = (
	activeSession: ort.InferenceSession,
	name: string,
): MetadataLike | undefined => {
	const metadata = activeSession.inputMetadata.find(
		(item) => item.name === name,
	);
	if (!metadata?.isTensor) return undefined;
	return { shape: metadata.shape, type: metadata.type };
};

const bitmapPairToPackedTensor = (
	image0: ImageBitmap,
	image1: ImageBitmap,
	metadata: MetadataLike | undefined,
	targetWidth: number,
	targetHeight: number,
	timestep: number,
): ort.Tensor => {
	// 这里处理单输入打包模型：常见是 8 通道（RGB0+RGB1+t+(1-t)）或 6/7 通道。
	const [, channelCount, height, width] = normalize4dShape(metadata?.shape, [
		1,
		8,
		targetHeight,
		targetWidth,
	]);
	if (channelCount < 6) {
		throw new Error(
			`Packed model requires channel >= 6, but got ${channelCount}`,
		);
	}

	const frame0 = bitmapToRgbaPlanar(image0, width, height);
	const frame1 = bitmapToRgbaPlanar(image1, width, height);
	const planeSize = width * height;
	const packed = new Float32Array(channelCount * planeSize);

	copyChannel(frame0, 0, packed, 0, planeSize);
	copyChannel(frame0, 1, packed, 1, planeSize);
	copyChannel(frame0, 2, packed, 2, planeSize);
	copyChannel(frame1, 0, packed, 3, planeSize);
	copyChannel(frame1, 1, packed, 4, planeSize);
	copyChannel(frame1, 2, packed, 5, planeSize);
	if (channelCount > 6) {
		packed.fill(timestep, 6 * planeSize, 7 * planeSize);
	}
	if (channelCount > 7) {
		packed.fill(1 - timestep, 7 * planeSize, 8 * planeSize);
	}
	for (let channel = 8; channel < channelCount; channel += 1) {
		packed.fill(0, channel * planeSize, (channel + 1) * planeSize);
	}

	return createTensorFromFloatData(
		packed,
		[1, channelCount, height, width],
		metadata,
	);
};

const pickImageInputNames = (activeSession: ort.InferenceSession): string[] => {
	const preferred = activeSession.inputNames.filter((name) => {
		const metadata = getInputMetadata(activeSession, name);
		if (!metadata?.shape || metadata.shape.length !== 4) return false;
		const channelDim = metadata.shape[1];
		if (typeof channelDim === "number")
			return channelDim === 3 || channelDim === 1;
		return true;
	});
	if (preferred.length > 0) return preferred;
	const tensor4d = activeSession.inputNames.filter((name) => {
		const metadata = getInputMetadata(activeSession, name);
		return Boolean(metadata?.shape && metadata.shape.length === 4);
	});
	if (tensor4d.length > 0) return tensor4d;
	return activeSession.inputNames.slice(0, 2);
};

const pickTimestepInputName = (
	activeSession: ort.InferenceSession,
	imageInputs: string[],
): string | null => {
	for (const name of activeSession.inputNames) {
		if (imageInputs.includes(name)) continue;
		const lowered = name.toLowerCase();
		if (!/(time|timestep|ratio|dt|step)/.test(lowered)) continue;
		return name;
	}
	return null;
};

const buildFeeds = (
	activeSession: ort.InferenceSession,
	image0: ImageBitmap,
	image1: ImageBitmap,
	timestep: number,
	targetWidth: number,
	targetHeight: number,
): {
	feeds: Record<string, ort.Tensor>;
	imageInputNames: string[];
	timestepInput: string | null;
	inputMode: "single-packed" | "dual-image";
} => {
	const feeds: Record<string, ort.Tensor> = {};
	const imageInputNames = pickImageInputNames(activeSession);
	if (imageInputNames.length === 0) {
		throw new Error("Cannot infer image input names from current model.");
	}

	if (imageInputNames.length === 1) {
		const packedInput = imageInputNames[0];
		const packedMeta = getInputMetadata(activeSession, packedInput);
		feeds[packedInput] = bitmapPairToPackedTensor(
			image0,
			image1,
			packedMeta,
			targetWidth,
			targetHeight,
			timestep,
		);

		const timestepInput = pickTimestepInputName(activeSession, [packedInput]);
		if (timestepInput) {
			const timestepMeta = getInputMetadata(activeSession, timestepInput);
			feeds[timestepInput] = createScalarTensor(timestep, timestepMeta);
		}

		for (const inputName of activeSession.inputNames) {
			if (feeds[inputName]) continue;
			const metadata = getInputMetadata(activeSession, inputName);
			feeds[inputName] = createZeroTensor(metadata);
		}
		return {
			feeds,
			imageInputNames,
			timestepInput,
			inputMode: "single-packed",
		};
	}

	const imageInputA = imageInputNames[0];
	const imageInputB = imageInputNames[1];
	const metadataA = getInputMetadata(activeSession, imageInputA);
	const metadataB = getInputMetadata(activeSession, imageInputB);

	feeds[imageInputA] = bitmapToImageTensor(
		image0,
		metadataA,
		targetWidth,
		targetHeight,
	);
	feeds[imageInputB] = bitmapToImageTensor(
		image1,
		metadataB,
		targetWidth,
		targetHeight,
	);

	const timestepInput = pickTimestepInputName(activeSession, imageInputNames);
	if (timestepInput) {
		const timestepMeta = getInputMetadata(activeSession, timestepInput);
		feeds[timestepInput] = createScalarTensor(timestep, timestepMeta);
	}

	// 对模型里未识别到的输入补零，便于快速确认算子兼容性。
	for (const inputName of activeSession.inputNames) {
		if (feeds[inputName]) continue;
		const metadata = getInputMetadata(activeSession, inputName);
		feeds[inputName] = createZeroTensor(metadata);
	}

	return {
		feeds,
		imageInputNames,
		timestepInput,
		inputMode: "dual-image",
	};
};

const tensorToImageData = (tensor: ort.Tensor): ImageData => {
	const floatData = tensorDataToFloat32(tensor);

	const dims = tensor.dims;
	let channels = 0;
	let height = 0;
	let width = 0;
	let indexFn: (channel: number, y: number, x: number) => number;

	if (dims.length === 4) {
		channels = dims[1] ?? 3;
		height = dims[2] ?? 0;
		width = dims[3] ?? 0;
		indexFn = (channel, y, x) => (channel * height + y) * width + x;
	} else if (dims.length === 3) {
		channels = dims[0] ?? 3;
		height = dims[1] ?? 0;
		width = dims[2] ?? 0;
		indexFn = (channel, y, x) => (channel * height + y) * width + x;
	} else {
		throw new Error(`Unsupported output dims: [${dims.join(", ")}]`);
	}

	if (channels < 1 || height <= 0 || width <= 0) {
		throw new Error(`Invalid output shape: [${dims.join(", ")}]`);
	}

	let minValue = Number.POSITIVE_INFINITY;
	let maxValue = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < floatData.length; i += 1) {
		const value = floatData[i];
		if (!Number.isFinite(value)) continue;
		if (value < minValue) minValue = value;
		if (value > maxValue) maxValue = value;
	}
	const hasNegative = Number.isFinite(minValue) && minValue < 0;
	const likely255Scale = Number.isFinite(maxValue) && maxValue > 1.5;

	const rgba = new Uint8ClampedArray(width * height * 4);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const outIndex = (y * width + x) * 4;
			for (let channel = 0; channel < 3; channel += 1) {
				const sourceChannel = Math.min(channel, channels - 1);
				const tensorIndex = indexFn(sourceChannel, y, x);
				let value = floatData[tensorIndex] ?? 0;

				// 这里兼容常见的输出范围：[-1,1] / [0,1] / [0,255]。
				if (hasNegative) value = (value + 1) * 0.5;
				else if (likely255Scale) value /= 255;
				value = Math.max(0, Math.min(1, value));

				rgba[outIndex + channel] = Math.round(value * 255);
			}
			rgba[outIndex + 3] = 255;
		}
	}
	return new ImageData(rgba, width, height);
};

const drawOutputTensor = (tensor: ort.Tensor): void => {
	const imageData = tensorToImageData(tensor);
	canvasOut.width = imageData.width;
	canvasOut.height = imageData.height;
	const context = canvasOut.getContext("2d");
	if (!context) {
		throw new Error("Failed to get output canvas context.");
	}
	context.putImageData(imageData, 0, 0);
};

const loadModel = async (): Promise<void> => {
	const file = modelFileInput.files?.[0];
	if (!file) {
		appendLog("请先选择 .onnx 模型文件。");
		return;
	}

	const providerMode = providerModeSelect.value as
		| "webgpu"
		| "webgpu-wasm"
		| "wasm";
	const executionProviders: readonly ort.InferenceSession.ExecutionProviderConfig[] =
		providerMode === "webgpu"
			? [
					{
						name: "webgpu",
						preferredLayout: "NCHW",
						validationMode: "disabled",
					},
				]
			: providerMode === "webgpu-wasm"
				? [
						{
							name: "webgpu",
							preferredLayout: "NCHW",
							validationMode: "disabled",
						},
						"wasm",
					]
				: ["wasm"];

	appendLog(
		`开始加载模型: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB), providers=${executionProviders.join(
			", ",
		)}`,
	);

	const modelBuffer = await file.arrayBuffer();
	latestModelBuffer = modelBuffer.slice(0);
	latestProviderMode = providerMode;
	const start = performance.now();
	session = await ort.InferenceSession.create(modelBuffer, {
		executionProviders,
		// 当前 PoC 使用 CPU tensor 直接喂数，不满足 graph capture 的外部 buffer 要求。
		enableGraphCapture: false,
		// WebGPU 某些驱动组合会在高优化级别触发不稳定，PoC 默认关闭图优化。
		graphOptimizationLevel: "disabled",
		enableMemPattern: false,
	});
	const elapsed = performance.now() - start;

	appendLog(`模型加载完成，用时 ${elapsed.toFixed(2)}ms`);
	appendLog(`inputs: ${session.inputNames.join(", ")}`);
	appendLog(
		`input metadata: ${metadataToString(session.inputMetadata, session.inputNames)}`,
	);
	appendLog(`outputs: ${session.outputNames.join(", ")}`);
	appendLog(
		`output metadata: ${metadataToString(session.outputMetadata, session.outputNames)}`,
	);
};

const runWasmDiagnostic = async (
	feeds: Record<string, ort.Tensor>,
): Promise<void> => {
	if (!latestModelBuffer) {
		appendLog("wasm 诊断跳过：模型缓冲区不可用。");
		return;
	}
	appendLog("开始 wasm 诊断：用于判断是否是 WebGPU 后端问题...");
	const diagSession = await ort.InferenceSession.create(
		latestModelBuffer.slice(0),
		{
			executionProviders: ["wasm"],
			graphOptimizationLevel: "disabled",
			enableMemPattern: false,
		},
	);
	const start = performance.now();
	const outputs = await diagSession.run(feeds);
	const elapsed = performance.now() - start;
	const outputName = diagSession.outputNames[0];
	const outputTensor = outputs[outputName];
	appendLog(
		`wasm 诊断结果: ${outputTensor ? "成功" : "无输出"}, output=${outputName}, ${elapsed.toFixed(2)}ms`,
	);
	void diagSession.release().catch(() => {});
};

const runInference = async (): Promise<void> => {
	if (!session) {
		appendLog("请先加载模型。");
		return;
	}
	if (!frameA || !frameB) {
		appendLog("请先加载 Frame A / Frame B，或点击“生成测试帧”。");
		return;
	}

	const { width, height } = readTargetSize();
	const timestep = readTimestep();
	appendLog(
		`准备推理: target=${width}x${height}, timestep=${timestep.toFixed(3)}`,
	);

	const { feeds, imageInputNames, timestepInput, inputMode } = buildFeeds(
		session,
		frameA,
		frameB,
		timestep,
		width,
		height,
	);

	appendLog(`input mode: ${inputMode}`);
	appendLog(`image inputs: ${imageInputNames.join(", ")}`);
	appendLog(`timestep input: ${timestepInput ?? "(none)"}`);
	appendLog(`feeds: ${Object.keys(feeds).join(", ")}`);

	const start = performance.now();
	let outputs: ort.InferenceSession.ReturnType;
	try {
		outputs = await session.run(feeds);
	} catch (error) {
		if (
			latestProviderMode === "webgpu" ||
			latestProviderMode === "webgpu-wasm"
		) {
			await runWasmDiagnostic(feeds).catch((diagError: unknown) => {
				appendLog(
					`wasm 诊断失败: ${diagError instanceof Error ? diagError.message : String(diagError)}`,
				);
			});
		}
		throw error;
	}
	const elapsed = performance.now() - start;

	const outputName = session.outputNames[0];
	const outputTensor = outputs[outputName];
	if (!outputTensor) {
		throw new Error(`Output not found: ${outputName}`);
	}

	drawOutputTensor(outputTensor);
	appendLog(
		`推理完成: output=${outputName}, dims=[${outputTensor.dims.join(", ")}], ${elapsed.toFixed(2)}ms`,
	);
};

const setFrameA = async (): Promise<void> => {
	frameA = await loadBitmapFromFileInput(imageAInput, "Frame A");
	if (frameA) drawBitmapToCanvas(frameA, canvasA);
};

const setFrameB = async (): Promise<void> => {
	frameB = await loadBitmapFromFileInput(imageBInput, "Frame B");
	if (frameB) drawBitmapToCanvas(frameB, canvasB);
};

const generateSampleFrames = async (): Promise<void> => {
	const { width, height } = readTargetSize();
	frameA = await createSyntheticFrame(width, height, 0.15);
	frameB = await createSyntheticFrame(width, height, 0.85);
	drawBitmapToCanvas(frameA, canvasA);
	drawBitmapToCanvas(frameB, canvasB);
	appendLog(`测试帧已生成: ${width}x${height}`);
};

loadModelButton.addEventListener("click", () => {
	clearLog();
	void loadModel().catch((error: unknown) => {
		appendLog(
			`模型加载失败: ${error instanceof Error ? error.message : String(error)}`,
		);
	});
});

imageAInput.addEventListener("change", () => {
	void setFrameA().catch((error: unknown) => {
		appendLog(
			`Frame A 加载失败: ${error instanceof Error ? error.message : String(error)}`,
		);
	});
});

imageBInput.addEventListener("change", () => {
	void setFrameB().catch((error: unknown) => {
		appendLog(
			`Frame B 加载失败: ${error instanceof Error ? error.message : String(error)}`,
		);
	});
});

generateSampleButton.addEventListener("click", () => {
	void generateSampleFrames().catch((error: unknown) => {
		appendLog(
			`生成测试帧失败: ${error instanceof Error ? error.message : String(error)}`,
		);
	});
});

runInferenceButton.addEventListener("click", () => {
	void runInference().catch((error: unknown) => {
		appendLog(
			`推理失败: ${error instanceof Error ? error.message : String(error)}`,
		);
	});
});

appendLog("1) 选择 RIFE ONNX 模型并点击“加载模型”");
appendLog("2) 上传两张图或点击“生成测试帧”");
appendLog("3) 点击“运行一次插帧”观察耗时和输出");
