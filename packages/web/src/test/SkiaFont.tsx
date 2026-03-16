import { useEffect, useMemo, useState } from "react";
import {
	Canvas,
	Fill,
	Path,
	Paragraph,
	Skia,
	Text,
	TextAlign,
	useFont,
} from "react-skia-lite";

// 扩展 Window 接口以支持 queryLocalFonts API
declare global {
	interface Window {
		queryLocalFonts?: () => Promise<
			Array<{
				postscriptName: string;
				fullName: string;
				family: string;
				style: string;
				blob: () => Promise<Blob>;
			}>
		>;
	}
}

async function logFontData() {
	try {
		if (!window.queryLocalFonts) {
			throw new Error("queryLocalFonts API is not available");
		}
		const availableFonts = await window.queryLocalFonts();
		return availableFonts;
	} catch (err) {
		const error = err as Error;
		console.error(error.name, error.message);
		return [];
	}
}

// 自定义 hook 用于从本地字体 Uint8Array 创建 Skia 字体
function useLocalFont(fontData: Uint8Array | null, fontSize: number) {
	return useMemo(() => {
		if (!fontData) {
			return null;
		}
		try {
			const skData = Skia.Data.fromBytes(fontData);
			const typeface = Skia.Typeface.MakeFreeTypeFaceFromData(skData);
			if (typeface) {
				return Skia.Font(typeface, fontSize);
			}
			return null;
		} catch (err) {
			console.error("Failed to create font:", err);
			return null;
		}
	}, [fontData, fontSize]);
}

export default function SkiaFont() {
	const fontSize = 32;

	const robotoFont = useFont("/Roboto-Medium.ttf", fontSize);

	const [availableFonts, setAvailableFonts] = useState<
		{
			postscriptName: string;
			fullName: string;
			family: string;
			style: string;
		}[]
	>([]);

	useEffect(() => {
		logFontData().then((fonts) => setAvailableFonts(fonts));
	}, []);

	const [selectedFontPostscript, setSelectedFontPostscript] =
		useState<string>("");
	const [selectedFontData, setSelectedFontData] = useState<Uint8Array | null>(
		null,
	);
	const [text, setText] = useState<string>("Hello, world!");

	const selectedFontSkia = useLocalFont(selectedFontData, fontSize);

	const handleFontChange = async (postscriptName: string) => {
		setSelectedFontPostscript(postscriptName);
		if (!postscriptName) {
			setSelectedFontData(null);
			return;
		}
		try {
			if (!window.queryLocalFonts) {
				throw new Error("queryLocalFonts API is not available");
			}
			const fonts = await window.queryLocalFonts();
			const selectedFont = fonts.find(
				(f: { postscriptName: string }) => f.postscriptName === postscriptName,
			);
			if (selectedFont) {
				// 获取字体的 blob 并转换为 Uint8Array
				const blob = await selectedFont.blob();
				const arrayBuffer = await blob.arrayBuffer();
				const uint8Array = new Uint8Array(arrayBuffer);
				setSelectedFontData(uint8Array);
			} else {
				setSelectedFontData(null);
			}
		} catch (err) {
			const error = err as Error;
			console.error("Failed to load selected font:", error);
			setSelectedFontData(null);
		}
	};

	const fontModule = useMemo(() => {
		if (!selectedFontData) {
			return null;
		}
		const blob = new Blob([selectedFontData as BlobPart], { type: "font/ttf" });
		const url = URL.createObjectURL(blob);
		return {
			__esModule: true as const,
			default: url,
		};
	}, [selectedFontData]);

	// Cleanup blob URL when component unmounts or font changes
	useEffect(() => {
		return () => {
			if (fontModule?.default) {
				URL.revokeObjectURL(fontModule.default);
			}
		};
	}, [fontModule]);

	// 自定义字体管理器，确保当 fontModule 改变时重新加载
	const [customFontMgr, setCustomFontMgr] = useState<ReturnType<
		typeof Skia.TypefaceFontProvider.Make
	> | null>(null);

	useEffect(() => {
		// 如果没有自定义字体，使用默认的 Roboto 字体
		const fontSource = fontModule?.default || "/Roboto-Medium.ttf";
		console.log("Loading font from:", fontSource);

		// 加载字体数据
		Skia.Data.fromURI(fontSource)
			.then((data) => {
				console.log("Font data loaded, creating typeface...");
				const typeface = Skia.Typeface.MakeFreeTypeFaceFromData(data);
				if (typeface) {
					console.log("Typeface created, creating font manager...");
					const fMgr = Skia.TypefaceFontProvider.Make();
					fMgr.registerFont(typeface, "Roboto");
					setCustomFontMgr(fMgr);
					console.log("Font manager created successfully");
				} else {
					console.error("Failed to create typeface from data");
					setCustomFontMgr(null);
				}
			})
			.catch((err) => {
				console.error("Failed to load font:", err);
				setCustomFontMgr(null);
			});
	}, [fontModule]);

	const paragraph = useMemo(() => {
		// Are the font loaded already?
		if (!customFontMgr) {
			return null;
		}
		const paragraphStyle = {
			textAlign: TextAlign.Center,
		};
		const textStyle = {
			color: Skia.Color("yellow"),
			fontFamilies: ["Roboto"],
			fontSize: fontSize,
		};
		return (
			Skia.ParagraphBuilder.Make(paragraphStyle, customFontMgr)
				.pushStyle(textStyle)
				.addText(text)
				// .pushStyle({ ...textStyle, fontStyle: { weight: 500 } })
				// .addText("Skia 🎨")
				.pop()
				.build()
		);
	}, [customFontMgr, fontSize, text]);

	const outlineApiAvailable = useMemo(() => {
		const canvasKit = (globalThis as {
			CanvasKit?: {
				Path?: {
					MakeFromGlyphs?: unknown;
					MakeFromRSXformGlyphs?: unknown;
					MakeFromText?: unknown;
				};
			};
		}).CanvasKit;
		return Boolean(
			canvasKit?.Path?.MakeFromGlyphs &&
				canvasKit.Path.MakeFromRSXformGlyphs &&
				canvasKit.Path.MakeFromText,
		);
	}, [customFontMgr]);

	const outlinePath = useMemo(() => {
		const activeFont = selectedFontSkia || robotoFont;
		if (!activeFont || !text) {
			return null;
		}
		const glyphIds = activeFont.getGlyphIDs(text);
		if (!glyphIds || glyphIds.length === 0) {
			return null;
		}
		const widths = activeFont.getGlyphWidths(glyphIds);
		let cursor = 12;
		const positions = glyphIds.map((_glyphId, index) => {
			const point = {
				x: cursor,
				y: fontSize + 18,
			};
			cursor += widths[index] ?? 0;
			return point;
		});
		return Skia.Path.MakeFromGlyphs(glyphIds, positions, activeFont);
	}, [fontSize, robotoFont, selectedFontSkia, text]);

	useEffect(() => {
		return () => {
			outlinePath?.dispose();
		};
	}, [outlinePath]);

	console.log("paragraph:", paragraph, "customFontMgr:", customFontMgr);

	const [wrap, setWrap] = useState(false);

	return (
		<>
			<button onClick={logFontData}>Log Font Data</button>
			<select
				value={selectedFontPostscript}
				onChange={(e) => handleFontChange(e.target.value)}
			>
				<option value="">选择字体</option>
				{availableFonts.map((font) => (
					<option key={font.postscriptName} value={font.postscriptName}>
						{font.fullName}
					</option>
				))}
			</select>
			{selectedFontPostscript && <div>已选择: {selectedFontPostscript}</div>}
			<div style={{ marginTop: 10, marginBottom: 10 }}>
				<label
					htmlFor="text-input"
					style={{ display: "block", marginBottom: 5 }}
				>
					输入文字:
				</label>
				<input
					id="text-input"
					type="text"
					value={text}
					onChange={(e) => setText(e.target.value)}
					style={{
						width: "100%",
						maxWidth: 400,
						padding: "8px",
						fontSize: "14px",
						border: "1px solid #ccc",
						borderRadius: "4px",
					}}
					placeholder="输入要显示的文字..."
				/>
				<button onClick={() => setWrap(!wrap)}>切换换行</button>
			</div>
			<div style={{ marginBottom: 10, fontSize: 13 }}>
				<div>Outline API: {outlineApiAvailable ? "available" : "missing"}</div>
				<div>Outline Path: {outlinePath ? "created" : "null"}</div>
			</div>
			<Canvas style={{ width: 400, height: 100 }}>
				<Fill>
					{wrap ? (
						paragraph ? (
							<Paragraph
								x={0}
								y={0}
								width={200}
								paragraph={paragraph}
							></Paragraph>
						) : null
					) : (
						<Text
							x={0}
							y={fontSize}
							text={text}
							font={selectedFontSkia || robotoFont}
							color={Skia.Color("yellow")}
						></Text>
					)}
				</Fill>
			</Canvas>
			<Canvas style={{ width: 400, height: 120 }}>
				<Fill color="#111827" />
				{outlinePath ? <Path path={outlinePath} color="#38bdf8" /> : null}
			</Canvas>
		</>
	);
}
