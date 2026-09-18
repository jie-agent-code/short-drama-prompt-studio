# Architecture

短剧提示词工作台的整体架构。

分四层边界，另有一条**提示词引擎**核心链路（项目的心脏）和一层**验收层**（保证引擎行为不退化）。

---

## 1. 四层边界

```text
UI
  app/page.tsx                            单页工作台（创意输入 / 连续分镜 / 连续性审核 三栏）
  app/components/studio-context.tsx        显式状态容器：场景卡、镜头规划、风格、时长模式、审核报告、覆盖脏标记
  app/components/scene-planner-panel.tsx   场景卡 + 镜头规划的编辑面板
  app/components/continuity-review.tsx     审核评分与修正摘要
  app/components/style-preset-selector.tsx
  app/components/duration-mode-selector.tsx
  app/lib/template-io.ts                   模板库导出/导入（纯函数，浏览器侧，唯一实现处）
        │
        │  显式请求体（不使用 window.fetch 拦截）：
        │    idea / movements / imageReference / stylePresetId / durationModeId
        │    sceneCardOverrides / shotPlanOverrides
        ▼
API routes（Node runtime —— 全项目唯一持有 API Key 的地方）
  app/api/generate/route.ts               主链路：规划 → 审核 → 编译 →（调百炼）→ 回填
  app/api/adapt-template/route.ts         按视频提示词模板改编
  app/api/adapt-image-template/route.ts   按图片提示词模板改写（带一次校验重试）
  app/api/check-key/route.ts              校验百炼 Key 可用性
  app/api/save-config/route.ts            写入项目根目录 .env.local
        │
        ├─► 提示词引擎   app/lib/prompt/*                    纯函数，无 IO、无副作用
        ├─► AI 适配器    app/lib/bailian-config.ts + DashScope /chat/completions
        └─► 仓储         app/lib/server/repositories/*       当前为内存实现，见第 5 节
```

**为什么状态传递必须显式**：编辑器早期用 `window.fetch` 拦截把覆盖注入请求体，
导致「用户改的内容」和「服务端实际收到的内容」无法对账，出现过「界面显示新剧情、成品输出旧剧情」。
现在页面直接构造请求体，覆盖只在用户真的编辑过时才下发（由 `studio-context` 的 `overridesDirty` 管理）。

---

## 2. 提示词引擎（核心链路）

`app/lib/prompt/` 共 10 个模块、约 2445 行，**全部是纯函数**——不读环境变量、不发请求、不碰文件。
正因如此，`.verify/*.unit.mts` 可以直接 import 它们做断言，不需要起服务、不需要 mock。

### 2.1 数据流

```text
剧情文本（一段话）
  │
  ├─① intent-classifier.analyzePlotIntent
  │     剧情 → PlotIntentLabel
  │     6 种意图（神性降临 / 战斗 / 追逐 / 舞蹈 / 情感 / 戏剧推进）
  │     产出：置信度、命中关键词、必须包含项、禁止默认添加项
  │     否定语境清零：「不要跳舞」不会把意图判成 dance
  │
  ├─② scene-card.buildSceneCard
  │     剧情 + 意图 → SceneCard（结构化中间契约）
  │     含：主角、场地、动作、事件节拍 beats、情绪曲线、视觉符号、
  │         对手角色 opponentAction、台词、镜头建议、连续性约束
  │     关键子函数：protagonistFrom / extractNarrativeEvents / inferEmotion
  │                 / extractVisualSymbols / extractOpponentAction
  │
  ├─③ shot-planner.planSceneToShots
  │     ├─ narrative-planner.planFromNarrativeBeats   主路径（节拍 ≥ 2）
  │     │     decideShotCount         节拍数 × 模式系数 → 镜头数（2-12）
  │     │     buildNarrativeBeats     按叙述顺序分配节拍，并决定每个节拍占几镜
  │     │     beat-coverage           多出来的镜头 → 插入镜 / 反应镜 / 情绪镜
  │     │     buildShotSizeSequence   景别节奏（爽点镜强制特写）
  │     └─ expandTemplateShots                        降级路径（节拍 < 2，走意图模板再按模式放大）
  │     → PlannedShot[]（每镜带 objective / timeBlocks / 景别 / 运镜 / 转场 / 首尾锚点 / 台词 / 视觉重点）
  │
  ├─④ continuity-auditor.auditAndRepairContinuity
  │     审核规则按模式生成：镜头编号连续 / 每段严格 N 秒 / 主角身份与代词一致 /
  │       景别明确 / 转场明确 / 上一镜尾帧承接（仅承接模式）/ 动作方向可执行 /
  │       时间轴可执行 / 未添加用户未要求的动作
  │     自动修正：角色归一化、补齐景别与转场、补时长与时间轴、剔除违禁动作、补承接锚点
  │     → ContinuityAuditReport（score / passed / issues / checkedRules）+ 修正后镜头
  │
  └─⑤ prompt-compiler.compilePromptSet
        注入前 3 秒钩子（仅首镜）、情绪标注 + 外化表演指令、视觉符号行
        → CompiledPromptSet（format / compiledText / shots）
```

### 2.2 模块职责

| 模块 | 行数 | 输入 → 输出 | 备注 |
|---|---|---|---|
| `intent-classifier.ts` | 136 | 剧情 → `PlotIntentLabel` | 6 条规则表 + 按意图的否定语境正则 |
| `scene-card.ts` | 484 | 剧情 + 意图 → `SceneCard` | 另含 `mergeSceneCardOverrides`（覆盖白名单合并） |
| `duration-modes.ts` | 167 | 模式 id → `DurationMode` | **时长协议唯一真相源** |
| `narrative-planner.ts` | 320 | `SceneCard` → `PlannedShot[]` | 业务核心 |
| `beat-coverage.ts` | 198 | 上下文 + 额度 → 覆盖镜文案 | 只被规划器调用 |
| `hook-designer.ts` | 171 | `SceneCard` → `HookDesign` | 只被编译器调用 |
| `shot-planner.ts` | 203 | `SceneCard` → `PlannedShot[]` | 规划入口，负责选主路径/降级路径 |
| `continuity-auditor.ts` | 514 | 镜头块 → 审核报告 + 修正后镜头 | **验收层**；`buildShotIds` 是镜头编号唯一来源 |
| `prompt-compiler.ts` | 227 | 全部产物 → `CompiledPromptSet` | 输出给 UI 和 API 的最终文本 |
| `style-presets.ts` | 25 | — → `StylePreset` | 按 10 秒撰写，非 10 秒须换算 |

### 2.3 依赖方向

改上游会影响下游，反之不会：

```text
duration-modes ──────► narrative-planner ──► prompt-compiler
                             ▲   │
intent-classifier ─► scene-card  │        beat-coverage
                             │   ▼
                             │  shot-planner ──► prompt-compiler
                             ▼
                        hook-designer ──────► prompt-compiler
                             │
                             ▼
                     continuity-auditor ───► prompt-compiler
```

### 2.4 两条不可违背的链路约束

1. **镜头顺序必须等于剧情顺序。** 情绪强度只能决定「哪一镜收得更紧」「哪一镜多给画面」，
   不能决定谁先谁后——早期实现按情绪强度排序，把「被泼红酒受辱 → 隐忍退入后台」
   排成了先退场再被泼酒，因果完全颠倒。
2. **所有兜底文案必须是视频模型可直接执行的描述。** 禁止出现「请写清…」「待补充」「如需移动」
   这类元指令——它们会原样进到成片提示词，模型拿不到任何具体信息。

---

## 3. 时长模式

`duration-modes.ts` 是「每镜严格 N 秒」的唯一来源。原先这个数字硬编码在 8 个文件里，
新增第二种时长就必须先收敛成一份数据。

```ts
export type DurationMode = {
  id: 'ten_second' | 'six_second'
  name: string
  description: string
  seconds: number        // 每个镜头的秒数
  slots: TimeSlot[]      // 时间块模板，必须首尾衔接且覆盖 0..seconds
  chained: boolean       // 是否要求镜头之间承接尾帧
  shotRatio: number      // 镜头数相对剧情节拍的放大系数
}
```

| | 时间块 | 承接尾帧 | 镜头数系数 |
|---|---|---|---|
| `ten_second` | 1 秒承接 + 5 秒主体 + 4 秒尾帧 | 是 | 1 |
| `six_second` | 4 秒主体 + 2 秒尾帧（**无承接块**） | 否 | 10/6 |

**新增一种时长模式只需往 `DURATION_MODES` 加一条数据**，规划器 / 审核器 / 编译器 / API / UI 全部自动跟随。

配套工具（注意两者语义不同，不能混用）：

- `rescaleTimelineText` —— 按比例缩放文本里**所有**秒数。用于按 10 秒写死的兜底模板。
- `retimeShotLengthText` —— 只换算「每 / 连续 N 秒」这类**整镜时长**表述。用于风格预设。
  用错会把「开头 0.5-1 秒出现明确人物」缩成「开头 0-1 秒」——0.5 秒是钩子出现时点，与镜头长度无关。

---

## 4. 验收层

模型输出每次措辞都不同，无法断言具体文本。所以验收层断言的是**不变量**：

- 每镜严格等于模式时长；时间码不得超过本镜长度
- 6 秒模式不得出现承接字段、审核不得检查「上一镜尾帧承接」
- 覆盖镜文案不得重复、不得包含元指令
- 主角身份与代词一致；否定声明不得被当作违规

```text
.verify/
  run.sh                    统一入口：bash .verify/run.sh [过滤词]
  register-hook.mjs         解析钩子：Node 直跑 .mts 时把 './state' 解析到 './state.ts'
  *.unit.mts                11 个回归套件，合计 485 项断言
  _demo_duration.mts        一次性脚本（'_' 前缀不进回归）：两种时长模式的成品对照
```

| 套件 | 断言数 | 覆盖 |
|---|---|---|
| `auditor.unit.mts` | 14 | 否定语境、禁项拦截 |
| `direction.unit.mts` | 23 | 兜底方向描述的可执行性 |
| `lead-order.unit.mts` | 16 | 主角按最早出现者判定 |
| `lead-audit.unit.mts` | 23 | 角色识别与审核器协同（合法异性配角不误报） |
| `agent.unit.mts` | 28 | Agent 节点与 prompt 模块的一致性 |
| `narrative.unit.mts` | 51 | 剧情词进入规划、动态镜头数、情绪标注、补位镜 |
| `hook.unit.mts` | 54 | 6 种钩子、首镜景别一致性、爽点情绪语义 |
| `override.unit.mts` | 22 | 覆盖白名单合并、镜头数一致性守卫 |
| `duration.unit.mts` | 113 | 两种时长模式的时长 / 镜头数 / 时间块 / 免承接行为 |
| `coverage.unit.mts` | 82 | 叙述顺序、覆盖镜类型与去重、兜底路径放大 |
| `template-io.unit.mts` | 59 | 模板导出/导入的严格校验、按 id 合并、往返一致性 |

**新增套件必须加进 `run.sh` 的 `SUITES`，否则不会被回归覆盖。**

**新增套件后必须反向验证一次**：故意改坏被守护的代码，确认套件真的会红。
一个从不失败的测试等于没有测试——无法区分「通过」和「根本没跑到」。

---

## 5. SQL-ready boundary

`app/lib/server/repositories/template-repository.ts` 是存储契约，当前只有内存实现。
**注意：`getTemplateRepository()` 目前没有任何调用方**——它是一个预留边界，不是活跃代码。

实际持久化走的是浏览器 `localStorage`，两个 key 为 `short-drama-image-prompt-templates`
与 `short-drama-video-templates`。

这两个 key 的读写、校验与合并**全部集中在 `app/lib/template-io.ts`（唯一实现处）**，
`app/page.tsx` 只负责调用与提示。之所以要独立成模块：
**localStorage 既不进仓库也不进 `.env.local`，换电脑 / 换浏览器 / 换端口都会静默清空**，
导出/导入是用户唯一不丢模板的通道，这条通道必须有回归覆盖（见 `template-io.unit.mts`）。

设计上两条硬约束：

- 校验**字段不合法就整条剔除，不做猜测性修补**——宁可少导入一条，也不塞一个半对的模板进去。
- `parseTemplateFile` 用**可判别返回值**区分 `invalid-json` 与 `no-templates`，
  因为这两种失败要给用户不同的提示；用返回值比让调用方 try/catch 更清楚。
- `mergeTemplates` 按 `id` 合并、同 id 以导入文件为准，**重复导入不产生副本**——
  用户会反复点导入，这是必然发生的操作，不是边界情况。

`database/001_init.sql` 是第一版迁移草案，把 projects / prompt_templates / shot_blocks 拆开，
为后续的 users、versions、audit_runs、model_providers、exports 留出扩展空间而不改 UI 契约。

`app/lib/domain/types.ts` 定义稳定的领域记录：`TemplateRecord` / `ProjectRecord` / `ShotBlockRecord`
（其中 `ShotBlockRecord.durationSeconds` 为 `number`，不再写死 10）。

## 6. Agent boundary

`app/lib/agent/` 是一个预留的状态图运行器，**当前没有被主链路引用**。
它存在的意义是把「提示词工作流」的状态契约固定下来，将来接 LangGraph 时不需要改 UI 或 API 载荷。

```text
PromptAgentStage =
  input → character → intent → scene_card → shot_plan → movement → continuity → repair → complete
                                                                                        └→ error
```

- `types.ts` —— 稳定的 state / node / edge 契约
- `nodes.ts` —— 可替换的业务节点。**节点必须复用 `app/lib/prompt/*`，不得再写第二套实现**
  （历史上这里曾有两套更弱的角色识别和意图识别，其中一套完全没有否定语境处理，
  输入「女主不要跳舞」会被判成 `dance`）
- `graph.ts` / `runtime.ts` —— 临时运行器与本地 runtime

将来需要持久化检查点、流式输出、重试、分支或人工审批时，新增一个消费同一套 state/node 契约的
LangGraph 适配器即可，不要改动 UI 和 API 载荷。

## 7. 已知缺口

- 所有创作规则都是**经验规则**，没有真实投放数据回测
- 只支持单段剧情；没有多段连贯、多角色对白调度、长剧集一致性
- `ACTION_VERBS` 是手工维护的约 180 个动词，规模上去会顶到天花板
- 没有部署上线，没有并发 / 成本 / 延迟数据
- Agent 层与仓储层都是预留边界，未接入主链路

> 阅读代码的推荐路径见 `docs/CODE_TOUR.md`。
