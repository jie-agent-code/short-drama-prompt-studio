# 代码导览与补课路径

这份文档解决一个问题：**代码是 AI 生成的，你看不懂，怎么在最短时间内补到「能讲、能改、能扛追问」。**

不推荐从头逐行读——2445 行、10 个模块、没有阅读入口，逐行读会在一半放弃。
推荐的方式是：**先用测试当导航建立地图，再挑 3 个文件精读，最后做一个真改动。**

---

## 一、先认清：整个项目只有 5 步

`.verify/_demo_duration.mts` 是最短的一条完整链路（40 行），把它读完你就掌握了 60%：

```ts
const il = analyzePlotIntent(idea)              // 1. 剧情 → 意图
const scene = buildSceneCard(idea, il)          // 2. 剧情 → 结构化场景卡（含事件节拍）
const plans = planSceneToShots(scene, ..., mode) // 3. 场景卡 → 分镜规划
const continuity = auditAndRepairContinuity(...) // 4. 分镜 → 审核 + 自动修正
const compiled = compilePromptSet(...)          // 5. 全部产物 → 最终提示词文本
```

配合 `.verify/_demo_duration.md`（同一段剧情的成品对照）一起看，
**逐个确认每个函数的输出落在成品的哪一行**——这一步做完，数据流就长在你脑子里了。

---

## 二、10 个模块各自负责什么

| 文件 | 行数 | 解决什么问题 | 输入 → 输出 |
|---|---|---|---|
| `intent-classifier.ts` | 136 | 把剧情判成 6 种类型之一，并给出「必须包含」和「禁止默认添加」 | 剧情字符串 → `PlotIntentLabel` |
| `scene-card.ts` | 484 | 把剧情拆成结构化场景卡：主角、场地、动作、**事件节拍**、情绪曲线、视觉符号、对手角色 | 剧情 + 意图 → `SceneCard` |
| `duration-modes.ts` | 167 | **时长模式唯一真相源**：每镜秒数、时间块模板、是否承接、镜头数系数 | 模式 id → `DurationMode` |
| `narrative-planner.ts` | 320 | **业务核心**：按节拍切分镜——决定几镜、每镜拍哪个节拍、景别怎么排 | `SceneCard` → `PlannedShot[]` |
| `beat-coverage.ts` | 198 | 镜头数多于节拍数时，多出来的镜头拍什么（道具插入镜 / 对手反应镜 / 情绪镜） | 上下文 + 额度 → 覆盖镜文案 |
| `hook-designer.ts` | 171 | 黄金前 3 秒钩子：6 种类型，产出可拍画面 + 信息缺口 + 第 3 秒尾帧 | `SceneCard` → `HookDesign` |
| `shot-planner.ts` | 203 | 规划入口：优先叙事规划，节拍不足退回意图模板并放大 | `SceneCard` → `PlannedShot[]` |
| `continuity-auditor.ts` | 514 | **验证层**：审核 + 自动修正（角色漂移、缺承接、缺时长、倒退风险、用户没要求的动作） | 镜头块 → 审核报告 + 修正后镜头 |
| `prompt-compiler.ts` | 227 | 把上面所有产物编译成最终提示词文本 | 全部产物 → `CompiledPromptSet` |
| `style-presets.ts` | 25 | 5 个风格预设（按 10 秒撰写，非 10 秒必须换算） | — → `StylePreset` |

**提示词引擎之外还有一个独立模块**：`app/lib/template-io.ts`（模板库导出/导入的校验与合并）。
它不属于提示词链路，但遵守同一条约定——**业务逻辑放 `app/lib`，组件只做调用**。
理由是可验证性：逻辑写在 `app/page.tsx` 里就写不出回归测试，
而模板库是用户唯一会丢的数据（只存在浏览器 localStorage，换机器就没了），那条通道必须有测试守着。

依赖方向（改上游会影响下游，反过来不会）：

```text
duration-modes ──> narrative-planner ──> prompt-compiler
                        ↑   ↓
intent-classifier ─> scene-card      beat-coverage
                        ↓
                  hook-designer ──> prompt-compiler
                        ↓
                  continuity-auditor ──> prompt-compiler
```

---

## 三、补课路径（每步都有可执行的验证）

### 第 0 步 · 建立「跑得起来」的肌肉（10 分钟）

```bash
bash .verify/run.sh          # 应该看到「合计：485 通过 / 0 失败」
bash .verify/run.sh duration # 只跑某一个套件
```

**以后每改一次代码就跑它。** 这是你唯一的确定性来源——模型输出会变，测试不会。

**新增套件时记住两件事**：① 加进 `run.sh` 的 `SUITES`，否则它根本不会被执行；
② 故意改坏被守护的代码跑一次，确认套件真的会红。
**一个从不失败的测试等于没有测试**——你无法区分「通过」和「根本没跑到」。

### 第 1 步 · 认数据流，不认代码（1 小时）

读 `.verify/_demo_duration.mts`，对照 `.verify/_demo_duration.md`。
目标：能口头说出「剧情进来，经过哪 5 步，变成什么出去」。

### 第 2 步 · 改一个常量，看什么红了（30 分钟）

把 `app/lib/prompt/continuity-auditor.ts` 第 44 行的

```ts
export const MAX_SHOT_COUNT = 12
```

改成 `3`，然后跑 `bash .verify/run.sh`。你会看到 **12 项断言变红、3 个套件失败**，而且失败信息直接告诉你这个常量在干什么：

```text
FAIL | 「女主推开办公室的门」6 秒模式镜头数多于 10 秒模式（3 vs 3）
FAIL | 道具插入镜必须是特写   []
```

（第二行的空数组说明：镜头数被压回节拍数后，覆盖镜一个都没生成。）

改回 `12`，再跑一次，恢复 485 全绿。

**这一步是整份文档的核心。你不需要读懂 514 行代码——测试会告诉你每一行在干什么。**

### 第 3 步 · 精读三个文件，按这个顺序（各 1-2 小时）

1. **`duration-modes.ts`（167 行）** — 最简单，而且是「抽象」这件事的样板。
   重点看 `DurationMode` 类型：为什么把这 5 个字段放在一起，就能表达两种完全不同的镜头协议。
2. **`narrative-planner.ts`（320 行）** — 业务核心。
   重点看 `decideShotCount`（几镜）、`buildNarrativeBeats`（哪个节拍落哪镜）、`buildShotSizeSequence`（景别怎么排）。
3. **`continuity-auditor.ts`（514 行）** — 最难，但理解了它就理解了「验证层」这个想法。
   重点看 `requiredRulesFor`（规则按模式生成）、`clauseIsNegated`（否定语境）、`repairContinuity`（修正器）。

**读的方法**：只看 `export function` 的签名 + 上面的注释块，内部实现先跳过。
这些注释是 AI 写的，但写得很详细——**它就是你现成的阅读材料，别浪费。**

### 第 4 步 · 做一个真改动（半天）

加第三种时长模式，比如 8 秒：往 `DURATION_MODES` 数组里加一条数据。

```ts
{
  id: 'eight_second',            // 记得同步 DurationModeId 类型
  name: '8 秒镜头',
  seconds: 8,
  slots: [                        // 必须首尾衔接、覆盖 0..8
    { role: 'body', from: 0, to: 5 },
    { role: 'tail', from: 5, to: 8 },
  ],
  chained: false,
  shotRatio: 10 / 8,
}
```

然后 `bash .verify/run.sh duration`，看它怎么红、你怎么让它绿。

**能独立做完这一步，你就可以说「这个项目的时长模式抽象是我能维护的」。**

### 第 5 步 · 能回答「如果重做会怎么改」（面试加分）

---

## 四、面试自测 10 题（先自己答，答不出就回去读对应文件）

1. 用户输入「妻子发现丈夫背叛」，你怎么保证主角是妻子而不是丈夫？→ `scene-card.ts` 的 `protagonistFrom`（按最早出现者）
2. 为什么镜头顺序不能按情绪强度排？→ `narrative-planner.ts` 的 `buildNarrativeBeats`（会造成因果颠倒）
3. 6 秒模式为什么不写尾帧承接？→ `duration-modes.ts` 的 `chained` 字段
4. 「禁止穿模、倒放」为什么不能被判成违规？→ `continuity-auditor.ts` 的 `clauseIsNegated`（否定词只在串首，顿号是句内并列）
5. `rescaleTimelineText` 和 `retimeShotLengthText` 有什么区别，为什么不能合成一个？→ 前者按比例缩放所有秒数，后者只换整镜时长表述
6. 为什么要用白名单合并覆盖，不能浅合并？→ `scene-card.ts` 的 `mergeSceneCardOverrides`（推导字段用户改不了，被旧值盖回会导致「界面显示新剧情、成品输出旧剧情」）
7. 6 秒模式多出来的镜头为什么不能用「继续推进，完成一个新动作」？→ 两个坑：两镜文案一模一样 + 是元指令（没给模型任何具体信息）
8. 模型输出每次都不同，你怎么写测试？→ 断言**不变量**（每镜严格 N 秒、时间码不超限、覆盖镜文案不重复），不测措辞
9. 新增一种时长模式需要改几个文件？→ 1 个（`duration-modes.ts` 加一条数据）
10. 这个项目最大的缺陷是什么？→ 见下

---

## 五、面试怎么定位这个项目

**不要**说「我写了一个提示词生成工具」——没有区分度，市面上到处都是。

**要说**：「我给一个不确定性的模型输出，套了一层确定性的验收层。」
然后展开两个细节：怎么设计 485 项断言、怎么发现一个会让三项功能全部失效的集成缺陷。

**关于「是 AI 帮我写的」这件事**——诚实说：

> 这个项目是我和 AI 协作完成的。我负责需求拆解、规则定义和验收标准，AI 负责实现。
> 我做了三个关键判断：镜头数不能写死、时长模式必须先收敛成一份数据、验证要断言不变量而不是措辞。

2026 年这不减分——**面试官真正关心的是「你能不能判断 AI 给的东西对不对」，不是「你能不能手写红黑树」。**
但硬撑「都是我手写的」然后被问穿，才是真的减分。

### 这个项目最大的缺陷（第 10 题的答案）

- 所有规则都是**经验规则**，没有真实投放数据回测——「红果爆款」是我按经验写的，不是从数据里学出来的
- 没有部署上线，没有并发 / 成本 / 延迟数据
- 只支持单段剧情，没有多段连贯、多角色对白调度
- `ACTION_VERBS` 是手工维护的约 180 个动词，规模上去会顶到天花板

**主动说出这些，比被追问出来好得多。**

---

## 六、相关文档

- `docs/ARCHITECTURE.md` — **当前架构**（四层边界 + 提示词引擎链路 + 时长模式 + 验收层 +
  SQL/Agent 预留边界 + 已知缺口）。想知道「某个模块为什么存在、改它会影响谁」，先查它。
- `docs/CODE_TOUR.md` — 本文件，讲**怎么读**。
- `.verify/` 下的 `accept.mjs` / `forbidden.mjs` / `inspect.mjs` / `analyze-output.mts` / `homogeneity.mts`
  是早期的一次性排查脚本，**没有进 `run.sh`**，可以当历史参考，不要当回归套件。
