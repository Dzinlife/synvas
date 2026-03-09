# Scene Editor 模块

编辑器核心模块，组合时间线、预览画布、全局侧边栏和元素设置面板。

## 主要能力

- 多轨时间线编辑：拖拽、裁剪、缩放与滚动。
- 预览画布：Skia 渲染 + Konva 交互（选中、变换、框选、缩放/平移）。
- 视图布局：上半区 `Preview/Canvas` 切换，下半区 `TimelineEditor` 常驻。
- 拖拽体系：全局侧边栏元素组件、Timeline、Canvas 之间互拖，包含自动滚动与落点提示。
- 轨道策略：自动轨道分配、吸附、联动、主轨波纹编辑。
- 时间线数据：JSON 校验/加载/保存，支持时间码同步。

## 目录结构

```text
scene-editor/
├── components/           # UI 子组件
│   ├── ElementSettingsPanel.tsx  # 选中元素属性面板
│   ├── TimeIndicatorCanvas.tsx   # 播放头指示线
│   ├── TimelineDragOverlay.tsx   # 拖拽提示层
│   ├── TimelineElement.tsx       # 轨道元素渲染与交互
│   ├── TimelineRuler.tsx         # 时间刻度尺
│   └── TimelineToolbar.tsx       # 播放/吸附/导出/缩放
│
├── contexts/             # React Context 和状态管理
│   ├── TimelineContext.tsx       # 时间线状态与交互（Zustand）
│   └── PreviewProvider.tsx       # 预览画布状态（缩放/平移/尺寸）
│
├── focus-editor/         # Focus Scene 编辑层与交互
│   ├── FocusSceneSkiaLayer.tsx   # Focus Scene Skia 交互层
│   └── useFocusSceneSkiaInteractions.ts # Focus Scene 选择/拖拽/变换
│
├── drag/                 # 拖拽状态（跨组件共享）
│   ├── dragStore.ts              # 全局拖拽状态与自动滚动
│   ├── materialDnd.ts            # 素材拖拽行为封装
│   ├── timelineDropTargets.ts    # 时间线/预览落点计算
│   ├── MaterialDragOverlay.tsx   # 拖拽幽灵与指示
│   └── index.ts
│
├── preview/              # 预览画布交互与坐标
│   ├── usePreviewInteractions.ts # 预览交互（选中/框选/变换）
│   ├── usePreviewCoordinates.ts  # 坐标转换与缩放
│   ├── LabelLayer.tsx            # 预览标注层
│   └── utils.ts                  # 可见元素计算等
│
├── timeline/             # 轨道计算逻辑
│   ├── dragCalculations.ts       # 拖拽轨道与落点计算
│   ├── trackConfig.ts            # 轨道配置与分类
│   ├── types.ts                  # 时间线/拖拽类型定义
│   ├── useElementDrag.ts         # 轨道元素拖拽/裁剪
│   ├── useTimelineElementDnd.ts  # 多选拖拽逻辑
│   └── index.ts
│
├── utils/                # 工具函数
│   ├── attachments.ts            # 联动关系计算
│   ├── mainTrackMagnet.ts        # 主轨波纹编辑与时间重排
│   ├── snap.ts                   # 吸附点计算
│   ├── timelineScale.ts          # 时间线缩放比例
│   ├── timelineTime.ts           # 时间线时间更新
│   └── trackAssignment.ts        # 轨道分配/冲突检测
│
├── TimelineEditor.tsx    # 时间线主视图
├── ViewportHost.tsx      # 编辑器视口容器
├── index.tsx             # 组合入口
├── timeline.json         # 示例时间线数据（assetId 模型）
└── ../studio/canvas/     # Canvas 工作区、节点导航与元素侧边栏
```

## 核心组件

### TimelineEditor.tsx

- 组合时间尺、工具栏、播放头、轨道元素。
- 支持多选、拖拽、裁剪，并在拖拽时自动滚动。
- 根据轨道分配与主轨波纹编辑结果重排时间线。

### CanvasWorkspace.tsx

- 提供全局侧边栏：大画布模式用于 Node 导航，Focus Scene 模式提供 Node/Element 双 tab。
- 元素 tab 的组件卡片可拖拽到时间线或预览画布。
- 支持与 Timeline 双向拖拽（timeline -> canvas / canvas -> timeline）。

### ElementSettingsPanel.tsx

- 展示并编辑选中元素名称与时间信息。
- 读取模型约束并显示可用范围。

### TimelineToolbar.tsx

- 播放控制、吸附/联动/主轨波纹编辑开关。
- 时间线缩放与导出 PNG。

## 状态与数据流

- `TimelineContext`：元素列表、播放时间、选择状态、轨道分配、拖拽状态、
  吸附/联动开关等。
- `PreviewProvider`：预览画布尺寸、缩放、平移与 canvas 引用。
- `studioStore/canvasStore`：主视图切换与 Canvas 资产引用状态。
- `core/editor/timelineLoader`：JSON 校验 + timecode 维护，加载 `timeline.json` 作为示例数据。

## 导出与渲染准备

- 导出流程在每帧构建 Skia 渲染树，同时生成 `ready` Promise，用于等待渲染依赖就绪。
- 需要导出等待的组件，通过 `ElementComponentDefinition.prepareRenderFrame` 提供准备逻辑。
- `prepareRenderFrame` 只负责准备渲染依赖（解码、离屏图片等），不要在 React 组件内等待。
- 典型实现：
  - `VideoClip` 在 `prepareRenderFrame` 中调用 model 的 `prepareFrame`。
  - `Transition` 的 from/to 离屏图片在 `buildSkiaRenderState` 阶段生成并透传给渲染器，由渲染计划级联等待。

## 轨道与时间线策略

- 主轨 (track 0) 固定在底部，按角色分配轨道。
- 吸附、联动、主轨波纹编辑配合减少重叠与空隙。
