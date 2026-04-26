# 视频色彩与 HDR 预览决策记录

日期：2026-04-26

本文记录本轮关于视频节点、视频剪辑、Canvas/Skia/WebGPU 色彩链路的关键结论、原因、尝试结果和当前决策，方便后续继续做真正的 NLE 色彩管理。

## 1. 初始问题与基础结论

最初的问题是 HDR 视频在预览中明显发白，并且 WebGL 与 WebGPU 下发白程度不同。后续又发现 P3 JPG 一开始没有正确显示广色域，Chrome WebGPU 下 HLG 视频尤其发白。

当时对链路的判断是：

- 视频节点没有真正处理 HDR 色彩空间。视频帧基本被当作 SDR sRGB 纹理使用。
- `VideoSample -> VideoFrame -> SkImage` 的路径没有读取并使用完整的 `VideoFrame.colorSpace` 做 tone mapping。
- WebGL 主要走 `MakeLazyImageFromTextureSource` / `MakeImageFromCanvasImageSource`，很多色彩转换依赖浏览器和 CanvasKit 的隐式行为。
- WebGPU 直接把外部视频帧 copy 到普通 8-bit texture，再按 sRGB/P3 包装给 Skia，更容易暴露 Chrome WebGPU 对 HLG 转换的问题。
- 只把目标 canvas 或 SkImage 标成 P3/HDR，并不能解决 HLG/PQ 到 SDR 的 tone mapping。HDR 视频需要明确的源色彩空间、传递函数、矩阵、范围和显示目标。

## 2. 色彩管理模型的设计结论

我们曾确定一个 v1 色彩管理模型，用来给后续真实色彩管线打基础：

- Project working space 默认 `display-p3` SDR。
- Preview 默认 `auto`，设备支持 P3 时走 P3，否则回退 sRGB。
- Export 默认 `srgb/rec709` SDR。
- WebGPU 作为正确色彩路径的主要目标。
- WebGL 作为 sRGB 兼容 fallback，不承诺 P3/HDR 正确性。
- 素材、项目、场景都需要有色彩字段，视频素材记录 detected/override。
- scene 嵌套时，子 scene 应按自己的 working space 渲染，再面向父 scene 或 preview target 输出。

这个模型的价值是把“项目工作空间、预览目标、导出目标、素材源色彩”拆开，避免后面所有视频、图片、场景嵌套和导出都只靠浏览器隐式转换。

但对 HDR 视频预览来说，模型本身不够。Rec.2100 HLG 到 Rec.709 SDR 仍然需要真实 tone mapping 或浏览器可靠转换。

## 3. WebGPU HDR 输出层结论

我们做过 HDR Test node 和 HDR 输出层，用来验证“浏览器和 Skia/WebGPU 能不能输出超过 SDR 的亮度”。

关键结论：

- 浏览器 WebGPU HDR presentation 是可行的。
- 正确路径是 `rgba16float` swapchain，加 `GPUCanvasContext.configure({ toneMapping: { mode: "extended" } })`。
- CanvasKit wrapped surface 需要使用 `RGBA_F16`，否则 Skia 侧会过早夹到 SDR。
- `canvaskit-wasm` helper 和 C++ binding 需要同步 patch。只改 JS helper 或只改 wasm binding 都会出问题。
- 当 JS 侧调用签名和 wasm binding 不同步时，出现过 `BindingError: Cannot pass non-string to std::string`。
- 最终 HDR Test node 能显示 HDR 效果，说明浏览器 HDR 输出链路本身不是瓶颈。

这个结论只证明输出层可以 HDR，不等于 HDR 视频输入和 tone mapping 已经正确。

## 4. HLG 视频 raw frame / shader 方案的尝试结论

为了获得完全可控的 HLG 到 SDR，我们曾设计过 raw YUV + shader 的方案：

- 从 mediabunny `VideoSample.copyTo()` 或 WebCodecs `VideoFrame.copyTo()` 拿 YUV planes。
- 上传 Y、UV plane 到 GPU。
- 用 shader 完成 YCbCr limited/full range normalize、BT.2020 matrix、HLG inverse、OOTF、BT.2446 Method A tone mapping、BT.2020 到 Rec.709、gamut compression。

这个方向在架构上是正确的，因为它不依赖浏览器隐式转换，也能支撑未来调色功能。

但当前 Web 环境的能力不稳定：

- Chrome 上 iPhone Rec.2100 HLG 视频的 `VideoFrame.format` 是 `null`。
- Chrome 上 `allocationSize()` 和 `copyTo()` 对 native/I420/NV12 都失败，报 `Operation is not supported when format is null`。
- Safari 上同一个样片可以访问 raw planes。
- 因此纯 Web raw YUV 管线目前被 Chrome WebCodecs 能力卡住，不能作为稳定默认路径。

决策：raw YUV + shader tone mapping 暂时不作为当前实现。保留能力探测，但默认播放链路不再跑 probe，避免性能和日志噪声。

## 5. Chrome WebGPU HLG 发白的判断

跨浏览器对比后，观察结果是：

- Chrome WebGL 下 HLG 视频效果和 Safari 接近。
- Safari WebGL 和 Safari WebGPU 都能比较正常地 tone map 到 SDR。
- Chrome WebGPU 下同一 HLG 视频明显发白。
- `copyExternalImageToTexture(VideoFrame)` 路径发白。
- 后续尝试 `importExternalTexture(VideoFrame)` 也没有解决。

因此问题更像是 Chrome WebGPU 视频输入路径对 HLG 的处理不可靠，而不是素材 metadata 不够。Chrome 可能拿到了足够信息，但在 WebGPU external video conversion 或 presentation 前后的某个环节没有做出和 Canvas2D/WebGL/Safari 一致的 HLG 到 SDR tone mapping。

我们也看过 Chrome HDR canvas demo。结论是浏览器具备部分 HDR 输出能力，但一些能力依赖实验性 flag 或特定 WebGPU 路径，不能直接说明 WebGPU 视频输入路径已经能可靠处理 HLG。

## 6. mediabunny CanvasSink / Canvas2D 结论

查看 mediabunny 源码后确认：

- `CanvasSink` 最终也是把 `VideoSample` draw 到 Canvas2D。
- `VideoSample.draw(context, ...)` 会处理视频 rotation metadata。
- `VideoSample.drawWithFit(...)` 也会处理 fit、crop、rotation。
- `VideoSample.toCanvasImageSource()` 要立即使用，因为内部可能临时创建 `VideoFrame` 并在下一个 microtask 自动关闭。

这解释了为什么 Canvas2D 路径更适合当前阶段：

- 浏览器已经在 Canvas2D draw 阶段对 HLG 做了可接受的 SDR tone mapping。
- Chrome WebGL 和 Safari 的效果与 Canvas2D/播放器更接近。
- 不需要我们再对 `VideoFrame` 做额外旋转修正。
- 避开 Chrome WebGPU 直接消费 HLG `VideoFrame` 的问题。

## 7. 当前实现决策：视频统一走 Canvas2D 转换

当前最终决策是：

- 所有 `VideoSample -> SkImage` 预览转换先走 Canvas2D。
- 不只限制在 Chrome、WebGPU 或 HLG，默认所有视频样本都走该路径。
- 统一入口仍是 `videoSampleToColorManagedSkImage(...)` 和 `videoSampleToSkImage(...)`。
- video node 和 video clip 都通过统一 helper 生效。
- FreezeFrame 也复用统一 helper，因此同步走 Canvas2D。
- 低层 `react-skia-lite` 只负责把 canvas 作为普通 `CanvasImageSource` 上传，不做视频专用色彩逻辑。

实现后的关键行为：

- `VideoSample.draw(ctx, 0, 0, displayWidth, displayHeight)` 先画到 `OffscreenCanvas`。
- 如果 `OffscreenCanvas` 不可用或拿不到 2D context，再尝试 `HTMLCanvasElement`。
- Canvas2D context 请求 `colorSpace: targetColorSpace ?? "srgb"`。
- 然后把 canvas 传给 `makeImageFromTextureSourceDirect(...)`。
- source color metadata 从 `VideoSample.colorSpace` 归一化，不再为了 metadata 创建 `VideoFrame`。
- `sample.close()` 仍在 finally 中执行。
- raw frame probe 默认关闭，通过 `localStorage.setItem("synvas.videoRawProbe", "1")` 才启用。

选择直接 `VideoSample.draw` 而不是重构成字面意义上的 `CanvasSink`，原因是当前 video node 和 video clip 的播放链路已经拿到 `VideoSample`。直接 draw 走的是 mediabunny 同一套 Canvas2D 绘制语义，改动更小，也避免重写 session/sink 架构。

## 8. 当前方案的限制

Canvas2D 路径是当前预览正确性的折中方案，不是最终 NLE 色彩管线。

限制包括：

- Tone mapping 仍由浏览器实现，不可控，不同浏览器仍可能有差异。
- 无法做真正可控的 HLG/PQ 到 Rec.709/Display P3/HDR preview transform。
- 无法支撑精确调色、OCIO/ACES、per-scene look transform。
- 不能替代 HDR/P3 导出 metadata 和编码链路。
- 未来如果要做专业预览和导出，仍需要 raw YUV/float pipeline 或 native decoder。

## 9. 后续方向

后续建议按能力解锁顺序推进：

1. 继续使用 Canvas2D 作为 Web 预览默认 fallback，保证 Chrome WebGPU 下 HLG 不再发白。
2. 保留 raw frame probe，用于跟踪 Chrome WebCodecs 是否开始支持 `format: null` HLG frame 的 `copyTo()`。
3. 一旦 WebCodecs 能稳定拿到 YUV planes，再恢复 raw YUV + shader tone mapping 方案。
4. shader 方案中优先实现 Rec.2100 HLG 到 Rec.709 SDR，再扩展 PQ、P3 SDR、HDR preview。
5. 长期目标是完整色彩管理：素材 override、project/scene working space、preview transform、export transform、调色 look、HDR/P3 metadata 写入。

## 10. 当前排查结论摘要

- HDR 输出层已经验证可行。
- Chrome WebGPU 直接上传 HLG `VideoFrame` 是当前发白的主要风险点。
- Chrome WebGL 和 Safari 表现正常，说明浏览器存在可用的 tone mapping 路径。
- Chrome WebCodecs raw YUV 访问当前不可靠，不能默认上 shader tone mapping。
- Canvas2D 是当前最稳的 Web fallback。
- 当前实现已把 video node、video clip、FreezeFrame 的视频预览转换统一切到 Canvas2D。
