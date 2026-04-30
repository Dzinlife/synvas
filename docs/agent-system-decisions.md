# Agent 系统设计方案

日期：2026-04-30

本文记录 Synvas agent 系统当前设计。当前实现已经从 image-only mock 协议演进为 provider / model / capabilities 驱动的通用 agent 协议，同时保留 Image Agent 作为第一条落地路径。

## 1. 设计目标

Agent 系统的核心目标是让模型 runner、editor project mutation、artifact 持久化和 UI 控件解耦。

关键原则：

- `@synvas/agent` 定义协议，不依赖 editor UI 或 project store。
- editor 只通过 `AgentClient` 创建、取消、订阅 run，并在 `applying_effects` 阶段应用结果。
- runner 不直接修改 project，只输出 artifact 和 effect。
- provider/model catalog 不写死在 UI，UI 根据 `AgentModel.capabilities` 渲染可用参数。
- 同一协议要能覆盖本地 mock、OpenAI BYOK、未来云端 worker 和 project agent。

## 2. 包与职责边界

`packages/agent` 是协议与 client 实现包，包名为 `@synvas/agent`。

它负责：

- `AgentRunRequest`、`AgentRun`、`AgentArtifact`、`AgentEffect` 等协议类型。
- `AgentClient` 接口。
- `LocalMockAgentClient`。
- `OpenAiProviderClient`，并用 `OpenAiImageAgentClient` 作为兼容导出。
- OpenAI provider 的 model catalog 和 image capabilities。

editor 侧 `agent-system` 负责：

- `AgentProvider` 注入 `AgentClient`。
- `agentRuntimeStore` 维护前端运行态。
- `applyAgentEffects` 把 artifacts materialize 成 project assets，再应用 effects。
- `createEditorAgentClient` 从 editor config 创建 OpenAI client，并解析 image edit 的源图文件。

node UI 只负责收集用户输入、读取 model capabilities、提交 `AgentRunRequest`。

## 3. Run 协议

`AgentRunRequest` 必须包含：

- `providerId`：执行 provider，例如 `openai`、`local-mock`。
- `modelId`：provider 内部模型 ID，例如 `gpt-image-2`。
- `kind`：任务类型，例如 `image.generate`、`image.edit`。
- `scope`：project / node 作用域。
- `input`：用户输入或语义输入。
- `params`：模型参数。
- `context`：editor 上下文，例如 source asset、target node。

`params.model` 当前仍保留，用于兼容已有调用和 provider adapter，但执行模型以顶层 `modelId` 为准。

`AgentRun` 记录同样保存 `providerId` 和 `modelId`，让事件流、artifact metadata、失败排查和未来持久化都能明确来源。

## 4. 状态机

当前 run 状态：

- `queued`
- `running`
- `materializing_artifacts`
- `applying_effects`
- `awaiting_input`
- `succeeded`
- `failed`
- `cancelled`

终态：

- `succeeded`
- `failed`
- `cancelled`

关键边界：

- `running` 前后都由 runner 推进。
- `materializing_artifacts` 表示 runner 已产出可描述的 artifacts。
- `applying_effects` 是 runner 与 editor mutation 的分界线。
- editor 应用完 effects 后调用 `completeRunApplication`。
- editor 应用失败时调用 `failRunApplication`。

React 组件不直接模拟 run 状态，也不直接在模型完成后写 project。所有 agent 行为必须经过事件流和 `AgentClient`。

## 5. Model Catalog

`AgentModel` 当前结构：

- `providerId`
- `providerLabel`
- `modelId`
- `label`
- `kind`
- `enabled`
- `capabilities`
- `defaultParams`
- `paramsSchema`

`AgentClient.listModels(filter)` 支持按 `kind` 和 `providerId` 过滤。

capabilities 使用 tagged union：

- `AgentLlmModelCapabilities`：`type: "llm"`
- `AgentImageModelCapabilities`：`type: "image"`
- `AgentAudioModelCapabilities`：`type: "audio"`
- `AgentVideoModelCapabilities`：`type: "video"`

UI 必须先检查 capability type，例如用 `isAgentImageModelCapabilities`，再读取 image 专属字段。不要再依赖旧的 `model.image` 字段。

## 6. Image Capabilities

Image model capabilities 描述 UI 和 provider adapter 共同需要的约束：

- quality options
- default quality
- aspect ratios
- default aspect ratio
- default size
- size constraint
- max variants

size constraint 分两类：

- fixed：只允许列出的尺寸。
- flexible：允许按像素范围、最大边、倍数和长边比例归一化。

当前 OpenAI catalog：

- provider：`openai`
- provider label：`OpenAI`
- 默认模型：`gpt-image-2`
- 支持模型：`gpt-image-2`、`gpt-image-1.5`、`gpt-image-1`、`gpt-image-1-mini`

`gpt-image-2` 支持 flexible size 和 `custom` ratio。旧 GPT Image 模型使用 fixed size。

## 7. OpenAI Provider Client

`OpenAiProviderClient` 是当前真实 provider 实现。

它负责：

- 读取 editor 中配置的 OpenAI endpoint 和 API key。
- 标准化 endpoint。
- 调用 `/images/generations`。
- 调用 `/images/edits`。
- 把 OpenAI 返回的 `b64_json` 或 URL 转成 `AgentArtifact`。
- 在错误信息中隐藏 API key。
- 支持 abort/cancel。

执行模型解析规则：

- 优先使用 `params.model`。
- 缺失时使用 `request.modelId`。
- 再缺失才退回 `OPENAI_IMAGE_DEFAULT_MODEL`。

这样既兼容旧参数，又让新的 provider/model request contract 成为主路径。

## 8. Local Mock Client

`LocalMockAgentClient` 仍然保留，用于开发、测试和没有真实 provider 时的 fallback。

当前 mock provider：

- providerId：`local-mock`
- providerLabel：`Local Mock`
- generate model：`mock-image-standard`
- edit model：`mock-image-edit`

mock client 也必须遵守 `AgentModel`、`AgentRunRequest` 和 `listModels(filter)` 的新协议。测试 fixture 不应再省略 `providerId` 和 `modelId`。

## 9. Artifact / Effect 分离

runner 输出两类结果：

- `AgentArtifact`：模型产物，例如 image、text、audio、video、file。
- `AgentEffect`：希望 editor 执行的 project 变更意图。

当前 effect 只有：

- `image-node.bind-artifact`

`applyAgentEffects` 的职责：

1. 遍历 run artifacts。
2. 只 materialize `kind === "image"` 的 artifacts。
3. 支持 inline bytes 和 remote URL source。
4. 将 image artifact 持久化为 project asset。
5. 再执行 image node bind effect。
6. 把 effect application 结果返回给 runner client。

artifact 的 `mimeType`、`width`、`height` 现在都是可选字段，因为协议已经面向 text/audio/video/file 扩展。应用 image effect 时必须先收窄和校验尺寸，不可假设所有 artifact 都是图片。

## 10. 目标 Node 缺失

如果 run 完成时目标 node 不存在：

- artifact 仍然 materialize 并保留为 project asset。
- effect application 返回 `skipped`。
- reason 使用 `target_missing`。

原因：

- 云端 run 可能在用户关闭窗口后完成。
- 用户可能在 run 期间 undo/delete 目标 node。
- 模型产物不应因为 effect 目标失效而丢失。

## 11. History 与 Undo

agent 对 canvas node 的实际修改由 editor 应用，因此仍通过现有 project store/history 体系处理。

当前约定：

- artifact 创建为 project asset。
- asset 创建不进入普通 undo 删除链路。
- node bind / resize 进入 editor 可观察状态。
- agent 写入后的 node baseline 使用非撤销方式同步，避免 undo 回滚 agent 结果时误删生成产物。

未来多人协作时，agent 应作为 OT actor 接入。但 actor 应表示执行主体，例如 `agent:openai`、`agent:cloud:image`，不应为每次 session 创建新 actor。

## 12. Image Agent UI

image node 的 agent panel 根据节点状态分两种：

- 空 image node：generate。
- 已有 asset 的 image node：edit。

generate 提交：

- 使用当前选中 model 的 `providerId` 和 `modelId`。
- `params` 包含 quality、size、aspectRatio、variants。
- 提交前根据目标生成尺寸更新 placeholder node 的显示比例。

edit 提交：

- 使用当前选中 edit model 的 `providerId` 和 `modelId`。
- 从当前 image node 的 asset 解析源图。
- 在源节点右侧创建新的 placeholder image node 作为 target。
- run context 包含 `sourceAssetId` 和 `targetNodeId`。

模型选择 UI 使用 `${providerId}:${modelId}` 作为 option value，避免不同 provider 出现相同 modelId 时冲突。

## 13. Editor Client 创建

`createEditorAgentClient` 当前返回 OpenAI provider client。

配置来源：

- `useAiProviderConfigStore.getState().config.openai.endpoint`
- `useAiProviderConfigStore.getState().config.openai.apiKey`

image edit source resolver 支持：

- managed asset：从 project OPFS 解析。
- linked file：通过 Electron file bridge 读取。
- linked remote：通过 fetch 读取。

resolver 只返回 `Blob/File` 和文件名，不把 editor project store 暴露给 provider adapter。

## 14. Quote

`AgentClient.quote(request)` 与 `createRun(request)` 使用同一 request contract。

当前：

- OpenAI BYOK 返回外部计费说明。
- Local mock 返回 mock-credit 估算。

后续真实计费不要写死在 UI。UI 只渲染 quote 的结果。

## 15. Project Agent 预留

当前已经为 project agent 预留：

- `AgentRunKind` 包含 `llm.chat`、`audio.generate`、`video.generate`。
- artifact kind 支持 text/image/audio/video/file。
- model capabilities 已经是通用 union。
- `awaiting_input` 支持未来中途等待用户确认。
- `AgentEffect` 可以扩展成 project / scene / batch effects。
- `applying_effects` 保证 runner 不直接写 project。

project agent 不应绕过 `AgentEffect` 直接调用 project store，否则 node agent 和 project agent 会形成两套 mutation 体系。

## 16. 云端 Worker 预留

未来可以新增 `RemoteAgentClient`，通过 HTTP、WebSocket 或 SSE 实现：

- create run
- cancel run
- subscribe run events
- list models
- quote

云端 worker 需要额外保证：

- run 持久化。
- event log 可重放。
- artifact 先写入持久存储。
- effect application 幂等。
- 用户关闭窗口后 run 仍可完成。
- 重新打开项目后可以同步 artifacts 和 effect application 状态。

即使迁移到云端，editor 仍然负责最终 project mutation。

## 17. 不变量

后续改动必须保持这些不变量：

- UI 不直接调用模型 provider API。
- UI 不读取未收窄的 capabilities 专属字段。
- `AgentRunRequest` 必须带 `providerId` 和 `modelId`。
- runner 不直接改 project store。
- artifact 和 effect 必须分离。
- effect 失败不应导致已生成 artifact 丢失。
- `applying_effects` 是 editor mutation 的唯一入口。
- provider/model catalog 通过 `AgentClient.listModels` 暴露。
- quote 通过 `AgentClient.quote` 获取。

## 18. 后续演进顺序

建议按以下顺序推进：

1. 持久化 run 和 run event log。
2. 增加 assets 面板，让 orphan artifact 可见。
3. 增强 OpenAI image edit 的 prompt rewrite / edit plan。
4. 引入 `RemoteAgentClient` 和云端 worker。
5. 扩展 effect 类型，支持 create node、batch update、scene element mutation。
6. 接入视频、音频和文本模型 catalog。
7. 增加完整 OT actor metadata。
8. 实现 project agent。
