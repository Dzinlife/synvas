# RIFE WebGPU Demo

这个 package 用于验证两件事：

1. `onnxruntime-web` 在当前机器上是否能成功创建 `webgpu` 推理会话。
2. RIFE ONNX 模型是否能在浏览器内完成“两帧输入 -> 一帧输出”插帧推理。

## 启动

在仓库根目录执行：

```bash
pnpm install
pnpm --filter @synvas/rife-webgpu-demo start
```

打开浏览器访问终端输出地址（默认是 `http://localhost:3011`）。

## 使用步骤

1. 选择 `RIFE .onnx` 模型文件，点击“加载模型”。
2. 上传两张输入图片，或点击“生成测试帧”。
3. 设置 `timestep`（例如 `0.5`）。
4. 点击“运行一次插帧”，查看日志中的输入/输出信息与耗时。

## 验收建议

1. `webgpu only` 模式下模型能成功加载和运行，说明关键算子在 WebGPU 路径可用。
2. 如果 `webgpu only` 失败，再用 `webgpu + wasm fallback` 看是否能跑通，便于定位是否是算子兼容问题。
3. 记录 720p / 1080p 下单次推理耗时，作为预览链路能否落地的基线。

## 已知限制

1. 输入张量按 `NCHW` 假设构造，适配常见 RIFE ONNX 导出；若模型是 `NHWC` 需调整。
2. 未做视频编解码闭环，只做最小推理验证。
3. 对额外模型输入采用补零策略，只用于 PoC 阶段快速验证。
