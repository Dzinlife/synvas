# Agent 系统初版设计决策记录

日期：2026-04-29

本文记录本轮关于 Synvas agent 系统，尤其是 Image Agent 初版的关键产品与架构决策。目标是让当前实现保持简单，同时给未来 project agent、云端 worker、素材面板和真实模型后端留出稳定演进空间。

## 1. 初版范围

当前只实现 node agent，不实现完整 project agent。

初版只接入 image node 的本地 mock 生图/修图流程：

- 空 image node 走 image generate。
- 已有图片的 image node 走 image edit。
- 模型调用全部 mock，不接真实模型。
- 不做素材面板。
- 不做云端 worker。
- 不做多人协作。
- 不做复杂 collision / auto layout。

这个范围的核心目的不是把完整 AI 工作流一次做完，而是先搭好 agent 协议、run 状态机、artifact/effect 边界和 editor 集成点。后续所有节点都需要可配置 node agent，因此框架优先级高于 image 功能完整度。

## 2. 包结构决策

新增独立 workspace 包 `packages/agent`，包名为 `@synvas/agent`。

原因：

- agent 协议不应该被 editor UI 细节绑定。
- 未来本地 runner、云端 worker、桌面端后台进程都应复用同一套类型。
- project agent 会比 node agent 更复杂，如果一开始放在 editor 内部，后续容易和 React state、project store、canvas history 混在一起。

`@synvas/agent` 负责导出协议与本地 mock client：

- `AgentRun`
- `AgentRunEvent`
- `AgentArtifact`
- `AgentEffect`
- `AgentEffectApplication`
- `AgentClient`
- `LocalMockAgentClient`

editor 侧新增 `agent-system`，只负责把 agent run 接入当前 project：

- `AgentProvider` 注入 `AgentClient`。
- `agentRuntimeStore` 维护当前前端运行态。
- `applyAgentEffects` 在 editor 内把 artifact 持久化为 project asset，再应用 node effects。
- node agent UI 通过 node definition 配置接入。

## 3. Node Agent 配置模型

`CanvasNodeDefinition` 增加可选 `agent` 配置。

决策：

- agent panel 是 node definition 的能力，不写死到 image node 以外的 canvas 逻辑。
- editor 只知道 active node 是否有 agent panel。
- 每种 node 自己决定 agent panel 的 layout、输入项、提交动作和目标 run kind。

image node 当前声明：

- 空 image node 使用 generate layout。
- 已有图片的 image node 使用 edit layout。

这个模型后续可以自然扩展到 video node、scene node、text node，而不需要改 canvas overlay 的核心逻辑。

## 4. Image Agent 产品行为

顶部 canvas toolbar 新增 image generator 按钮。

点击后创建一个 empty image node：

- 位置直接使用当前视口中心。
- 自动设为 active / selected node。
- 第一版不根据 active node 放右侧或下方。
- 第一版不做 board 归属。
- 第一版不做 collision / auto layout 空位查找。

empty image node：

- `assetId` 允许为空。
- renderer 必须显示占位或 loading，不能因为没有 asset 就返回空。
- schema 兼容旧项目：已有 image node 不变，新 empty image node 可通过校验。

generate layout 包含：

- prompt input
- 生图模型选择
- 预计 credit 消耗
- 质量等级
- 图片比例
- variant 数量
- 单张 reference 占位 UI

这些控件第一版只作为 mock 参数和产品骨架，不接真实上传、真实模型 catalog 或真实计费。

已有图片的 image node 使用 edit layout：

- UI 只有输入框，不暴露模型、比例、质量等选项。
- 用户输入先交给 LLM 判断意图并生成 image-edit prompt。
- 再交给特定 image-edit 模型修改。
- 第一版这两步都用 mock。
- 提交后在画布上创建新的 image placeholder node，并在该 node 上 loading。

## 5. Loading 行为

Image Agent 运行期间，目标 image node 不断播放 loading 动画。

当前 mock run 默认拉长到 10 秒，主要用于调试和展示 loading 状态。真实模型接入后，loading 时长由 run 事件驱动，不依赖固定 timeout。

loading 动画由 image node renderer 负责：

- 使用 Skia `RuntimeEffect` shader。
- 用 `useSharedValue + requestAnimationFrame` 更新 uniforms。
- 不在 React 组件里每帧 `setState`。
- shader 失败时回退到静态占位。

## 6. Run 状态机

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

状态含义：

- `queued`：任务已创建，runner 尚未开始实际工作。
- `running`：runner 正在理解输入、调用模型或执行工具。
- `materializing_artifacts`：runner 已产出结果，正在准备 artifact 描述。
- `applying_effects`：runner 不再直接改 project，等待 editor 把 artifact/effect 写入当前 project。
- `awaiting_input`：预留给未来需要用户确认、补充信息、选择分支的 agent。
- `succeeded`：所有必要 effect application 已完成。
- `failed`：runner 或 editor application 失败。
- `cancelled`：用户或系统取消。

决策：

- run 通过事件流推进，本地 mock 也必须走事件流。
- React 组件不允许直接 `setTimeout + updateNode` 模拟 agent 行为。
- `awaiting_input` 当前可以不用，但状态机先保留，避免未来 project agent 需要中断确认时重做协议。
- `applying_effects` 是明确的边界：runner 只产出结果和意图，editor 才能写 project。

## 7. Artifact / Effect 分离

这是最重要的架构边界。

runner 输出两类东西：

- `AgentArtifact`：模型产生的资产，例如图片、视频、文本文件、mask、prompt rewrite 等。
- `AgentEffect`：希望 editor 对 project 做的变更意图，例如把某个 artifact 绑定到某个 image node。

editor 在 `applyAgentEffects` 中做两步：

1. 先把 artifact 持久化为 project asset。
2. 再应用 node effect，并把 node create / update 写入 history。

原因：

- runner 可能在本地，也可能在云端，不能直接持有 editor project store。
- artifact 持久化和 project mutation 是 editor 的职责。
- 云端 worker 完成后，即使用户关闭窗口，artifact 仍应能保留下来。
- effect 可能因为目标 node 已不存在而失败或 skipped，但 artifact 不应该丢失。

当前支持的 image effect：

- `image-node.bind-artifact`

后续可以扩展：

- 创建 node
- 批量更新 node
- 创建 scene element
- 修改 prompt/history metadata
- 请求用户确认

## 8. 目标 Node 不存在时的处理

如果 run 完成时目标 node 已被删除：

- artifact 仍然创建并保留。
- node effect 不再写回。
- effect application 标记为 `skipped`，reason 为 `target_missing`。

这个决策对云端 agent 很重要。

用户创建任务后可能关闭窗口，或者任务运行期间 undo / delete 了目标 node。下次打开项目时，即使画布上已经没有目标 node，用户也应能在未来的 assets 面板里找到生成结果。

当前项目 undo 本来不会删除 assets，因此初版不需要额外增加 asset 保留逻辑。

## 9. History / OT / Actor 决策

当前项目已经有简单 OT 模型，但还没有多人编辑。

初版决策：

- agent 对 canvas 的实际修改写入现有 history。
- 使用已有 `canvas.node-create`、`canvas.node-update`、`canvas.node-create.batch`。
- 用户 undo / redo 可以影响 agent 创建或更新的 node。
- asset 创建不进入普通 undo 删除链路。
- agent metadata 暂时保留在 run / effect 记录中，不强行扩展完整 OT metadata。

Actor 语义：

- 初版使用稳定本地 actor：`agent:local`。
- 不为每个 agent session 创建一个 OT actor。
- sessionId 用来表达一次任务会话，不承担 actor 身份。

原因：

- 每个 session 一个 actor 会让 history / audit / collaboration 维度过早膨胀。
- 当前更重要的是区分 user action 与 agent action。
- 未来有云端 worker 时，可以用稳定 runner actor，例如 `agent:cloud:image` 或 `agent:worker:<id>`，session 仍作为 run metadata。

当未来实现多人协作时，agent 应作为 OT actor 接入，但 actor 应表示执行主体，而不是每一次 run。

## 10. 本地 Runner 与云端 Worker

初期 agent 都在本地运行。

但协议必须按未来云端 worker 可替换设计：

- editor 只依赖 `AgentClient`。
- `LocalMockAgentClient` 是本地实现。
- 未来可以新增 `RemoteAgentClient`，通过 HTTP / WebSocket / SSE 订阅 run events。
- run event 是前端和 runner 的同步边界。
- artifact source 可以是 inline bytes、remote URL、云端 asset handle 或临时 signed URL。
- editor 仍负责把 artifact materialize 到 project asset。

云端 worker 需要额外考虑：

- run 需要服务端持久化。
- event log 需要可重放。
- artifact 需要先写入持久存储。
- effect application 需要幂等。
- 用户关闭窗口后，任务仍可完成。
- 下次打开项目时，至少能同步 artifacts；是否自动应用 effects 要根据目标 project/node 状态判断。

当前不实现这些能力，但初版协议不应阻碍这些能力。

## 11. 模型后端设计方向

editor 不直接调用具体模型 API。

推荐后端层次：

1. `AgentClient`：前端看到的任务接口，负责 create/cancel/subscribe/listModels/quote。
2. agent runner：执行任务状态机，负责编排 LLM、image model、工具和 artifact/effect。
3. model gateway：统一模型 catalog、quote、调用、限流、鉴权、provider adapter。
4. provider adapter：对接具体供应商，例如 OpenAI、Replicate、Fal、内部模型服务等。
5. artifact store：保存模型输出，返回可 materialize 的 artifact source。

image edit 的推荐链路：

1. 用户输入自然语言 instruction。
2. LLM 判断意图、必要时生成结构化 edit plan。
3. LLM 或规则生成 image-edit prompt。
4. image-edit 模型执行修改。
5. runner 输出 image artifact 和 bind/create effect。

generate 的推荐链路：

1. 根据 panel 参数生成 request。
2. quote 返回预计 credit。
3. runner 调用 image generation model。
4. runner 输出 image artifact 和 bind effect。

后端原则：

- model catalog 不写死在 UI。
- quote 通过 `AgentClient.quote` 获取。
- provider 私有参数不要泄漏到 canvas node schema。
- run input / params 可以保留产品语义，provider adapter 再转换为具体 API 参数。
- prompt rewrite、safety、reference image 预处理都属于 runner 或 model gateway，不属于 React component。

## 12. Project Agent 的预留

Project agent 未来会比 node agent 更复杂，可能涉及：

- 多步骤规划。
- 多 node / 多 scene 修改。
- 用户确认。
- 工具调用。
- 分支结果。
- 长时间运行。
- 云端恢复。

当前状态机为 project agent 预留了几个关键点：

- `awaiting_input` 支持中途等待用户输入。
- `AgentEffect` 可以扩展成批量 project effects。
- `AgentArtifact` 可以承载中间文件和最终素材。
- actorId 与 sessionId 分离。
- event stream 可以扩展成持久 event log。
- `applying_effects` 把 runner 与 editor mutation 解耦。

project agent 不应该直接绕过 effect application 去改 project store。否则 node agent 和 project agent 会形成两套 mutation 体系。

## 13. 当前 Mock 行为

当前本地 mock 约定：

- generate：根据 prompt 延迟生成 mock PNG artifact，绑定到当前 empty image node。
- edit：提交文字后先创建右侧结果 placeholder node，再 mock rewrite + mock edit，完成后绑定新 asset。
- run 默认约 10 秒进入 `applying_effects`，用于展示 loading。
- 如果目标 node 已删除，artifact 保留，effect skipped。

mock 图片当前只是协议占位，不代表真实模型输出能力。

## 14. 不做的事情

初版明确不做：

- 真实模型调用。
- 真实 credit 计费。
- 真实 reference 上传 / 选择。
- 素材面板。
- 云端 worker。
- 多人编辑。
- agent run 持久化。
- 完整 OT actor metadata。
- canvas 自动找空位。
- board 自动归属。
- project agent。

这些能力后续都应基于当前协议逐步扩展，而不是在 UI 组件里临时堆逻辑。

## 15. 后续演进顺序建议

建议按以下顺序推进：

1. 完善 `AgentRun` 持久化和 run event log。
2. 接入真实 image generate provider，但保持 `AgentClient` 不变。
3. 接入真实 image edit provider 和 prompt rewrite。
4. 做 assets 面板，让 orphan artifact 可见。
5. 引入 `RemoteAgentClient` 和云端 worker。
6. 增强 effect 类型，支持批量 node / scene 修改。
7. 接入更完整 OT actor metadata。
8. 实现 project agent。
9. 做 collision / auto layout / board 归属。

## 16. 当前决策摘要

- agent 协议放在独立 `@synvas/agent` 包。
- editor 通过 `agent-system` 接入 agent，不让 React component 直接模拟 runner。
- node agent 是 node definition 的可选能力。
- Image Agent 初版只做 mock generate/edit。
- image generator button 第一版直接在当前视口中心创建 empty image node。
- empty image node 是合法状态。
- run 必须走事件流。
- artifact/effect 必须分离。
- editor 在 `applying_effects` 阶段写 project。
- agent canvas 修改进入普通 history，asset 创建不随普通 undo 删除。
- 初版 actor 固定为 `agent:local`，不是每个 session 一个 actor。
- 目标 node 不存在时，artifact 保留，effect skipped。
- 本地 runner 和未来云端 worker 共用 `AgentClient` 协议。
- 模型后端应通过 runner / model gateway / provider adapter 分层，不让 UI 直接调用模型。
