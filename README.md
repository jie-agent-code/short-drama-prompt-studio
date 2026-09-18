# 短剧提示词工作台 · Short Drama Prompt Studio

把**一段中文剧情文本**，变成**可直接投产的竖屏短剧分镜提示词**。

面向红果类竖屏短剧的分镜生产：输入一段剧情，输出若干个严格对齐时长、景别明确、
镜头之间能真正拼起来的分镜提示词，并附带连续性审核报告。

---

## 它解决什么问题

竖屏短剧的分镜提示词有两个硬约束，手工写很痛苦：

1. **每镜严格 N 秒**——时间轴要精确到秒，且不能出现超出本镜长度的时间码；
2. **镜头之间必须能拼接**——上一镜的尾帧姿态要和下一镜的首帧对得上。

再加上「用户没提舞蹈就不能出现跳舞」「镜头顺序必须等于剧情顺序」这类业务规则，
手工写一段 30 秒的分镜要反复对齐十几处细节，换一段剧情又得重来。

这个工具把创作规则变成**代码里的硬约束**，而不是写在提示词里祈祷模型听话。

## 核心能力

| 能力 | 说明 |
|---|---|
| **剧情节拍动态分镜** | 按剧情节拍数决定镜头数（2–12 镜），不写死 3 镜 |
| **双时长协议** | 10 秒（承接尾帧、可无缝拼接）/ 6 秒（不做承接、后期硬切） |
| **黄金前 3 秒钩子** | 6 种钩子类型，产出可拍画面 + 信息缺口 + 第 3 秒尾帧 |
| **情绪外化指令** | 把「强忍屈辱」翻译成可表演指令（眼睛看哪、呼吸怎么走、重心在哪） |
| **覆盖剪辑** | 镜头数多于节拍数时，自动补道具插入镜 / 对手反应镜 / 情绪特写镜 |
| **连续性审核 + 自动修正** | 角色漂移、缺承接、缺时长、倒退风险、用户未要求的动作 |

## 关键设计决策

这一节是这个项目真正值得看的部分。

**1. 时长协议收敛成一份数据。**
「每镜严格 10 秒」原本硬编码在 8 个文件里。新增 6 秒模式时，先把时长抽象成
`duration-modes.ts` 里的一份数据（每镜秒数 / 时间块模板 / 是否承接 / 镜头数系数），
之后**新增一种时长模式只需往数组里加一条记录**，规划器、审核器、编译器、API、UI 全部自动跟随。

**2. 覆盖剪辑，而不是「继续推进」。**
6 秒模式的镜头数按 10/6 放大，必然多于节拍数。多出来的镜头如果写「继续推进，完成一个新动作」，
会同时踩两个坑：两镜文案一字不差，而且这是**元指令**——没给视频模型任何具体信息。
改为红果真实的覆盖剪辑：插入镜（道具特写）、反应镜（对手的脸）、情绪镜（主角面部）。
它们只换机位重拍已发生的事，不新增剧情动作。

**3. 镜头顺序必须等于剧情顺序。**
早期实现按情绪强度排序分配镜头，结果「被泼红酒受辱 → 隐忍退入后台」被排成了先退场再被泼酒，
因果完全颠倒。情绪强度只能决定「哪一镜收得更紧」「哪一镜多给画面」，不能决定谁先谁后。

**4. 覆盖必须白名单合并。**
编辑面板下发的是整份场景卡，其中 `beats` / `emotion` / `visual` 是用户改不了的**推导字段**。
浅合并会让旧值盖掉服务端按新剧情重算的结果，表现为「界面显示新剧情、成品却按旧剧情输出」。
改为白名单合并后，推导字段永不被覆盖。

**5. 断言不变量，而不是措辞。**
模型每次输出措辞都不同，无法断言具体文本。所以验收层断言的是不变量：
每镜严格等于模式时长、时间码不得超过本镜长度、6 秒模式不得出现承接字段、覆盖镜文案不得重复……

## 架构

```text
UI (app/page.tsx + app/components)
  → API routes (app/api/*)          ← 唯一持有 API Key 的地方
    → 提示词引擎 (app/lib/prompt/*)  ← 纯函数，无 IO、无副作用
    → AI 适配器 (百炼 DashScope)
    → 仓储 (app/lib/server/repositories/*)
```

提示词引擎的 5 步链路：

```text
剧情文本
  → analyzePlotIntent        剧情 → 意图（6 种，含否定语境处理）
  → buildSceneCard           剧情 → 结构化场景卡（事件节拍 / 情绪 / 视觉符号 / 对手角色）
  → planSceneToShots         场景卡 → 分镜规划（动态镜头数 + 覆盖镜 + 景别节奏）
  → auditAndRepairContinuity 分镜 → 审核报告 + 自动修正
  → compilePromptSet         全部产物 → 最终提示词文本
```

完整的模块职责、依赖方向、时长协议细节见 **[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)**。
阅读代码的推荐路径见 **[`docs/CODE_TOUR.md`](docs/CODE_TOUR.md)**。

## 验证

模型输出不确定，所以验收层断言的是不变量。**11 个回归套件、485 项断言、一条命令：**

```bash
bash .verify/run.sh          # 全量
bash .verify/run.sh duration # 只跑时长模式专项
```

| 套件 | 断言数 | 覆盖 |
|---|---|---|
| `auditor.unit.mts` | 14 | 否定语境、禁项拦截 |
| `direction.unit.mts` | 23 | 兜底方向描述的可执行性 |
| `lead-order.unit.mts` | 16 | 主角按最早出现者判定 |
| `lead-audit.unit.mts` | 23 | 角色识别与审核器协同 |
| `agent.unit.mts` | 28 | Agent 节点与 prompt 模块一致性 |
| `narrative.unit.mts` | 51 | 剧情词进入规划、动态镜头数、情绪标注 |
| `hook.unit.mts` | 54 | 6 种钩子、首镜景别一致性、爽点情绪语义 |
| `override.unit.mts` | 22 | 覆盖白名单合并、镜头数一致性守卫 |
| `duration.unit.mts` | 113 | 两种时长模式的时长 / 镜头数 / 时间块 / 免承接行为 |
| `coverage.unit.mts` | 82 | 叙述顺序、覆盖镜类型与去重、兜底路径放大 |
| `template-io.unit.mts` | 59 | 模板导出/导入的严格校验、按 id 合并、往返一致性 |

新增套件必须同时加进 `run.sh` 的 `SUITES`，否则不会被回归覆盖。

`.verify/_demo_duration.mts` 用同一段剧情跑两种时长模式，输出成品对照
（`_demo_duration.md`），用来直观验收两种模式的差异。

## 快速开始

### 首次运行

```bash
npm install
npm run dev                    # http://localhost:3000
```

启动后点页面右上角 **⚙ 百炼配置**，把百炼 API Key 粘进去保存即可。
Key 只发送到本机 Next.js 服务端、写入本机 `.env.local`，页面不回显，也不会进仓库。

也可以手动配置：`cp .env.example .env.local`，再填入 `DASHSCOPE_API_KEY`。

### 换到另一台电脑

代码全在 GitHub 上，新机器只需要三步：

```bash
git clone https://github.com/jie-agent-code/short-drama-prompt-studio.git
cd short-drama-prompt-studio
npm install && npm run dev
```

**前提**：装好 Node.js ≥ 18.17（推荐 20 / 22）与 Git。

**唯一需要手动补的是百炼 Key**。它存在 `.env.local`，被 `.gitignore` 挡住，
**不会跟着仓库走**（这是有意设计）。启动后点「⚙ 百炼配置」重新粘一次即可，
**不需要拷贝任何密钥文件**。

**不需要跟着走、系统会自动重建的**：

| 内容 | 重建方式 |
|---|---|
| `node_modules/` | `npm install` |
| `.next/` | `npm run build` 或 `npm run dev` |
| `next-env.d.ts` | Next.js 构建时自动生成（即使它被 gitignore） |

**⚠️ 会丢的东西：模板库。** 图片 / 视频提示词模板存在**浏览器 localStorage**，
key 为 `short-drama-image-prompt-templates` 与 `short-drama-video-templates`。
它既不进仓库也不进 `.env.local`，换电脑、换浏览器、甚至换端口都会清空。

**迁移方式：用页面右上角「▣ 模板库」面板里的导出 / 导入按钮。**

1. 旧机器：打开「▣ 模板库」→ 点「↓ 导出全部模板」，下载一个 JSON 文件
2. 新机器：打开同一面板 → 点「↑ 导入模板」，选中该 JSON

导入按模板 `id` 合并，同 id 以文件为准，**重复导入不会产生副本**。
文件格式为 `{ version, exportedAt, image: [...], video: [...] }`，
字段不合法的条目会被整条忽略而不是猜测修补。

<details>
<summary>没有界面时的手动方式（浏览器控制台）</summary>

导出：

```js
copy(JSON.stringify({
  image: localStorage.getItem('short-drama-image-prompt-templates'),
  video: localStorage.getItem('short-drama-video-templates')
}))
```

导入：

```js
const d = JSON.parse(`粘贴刚才的内容`)
localStorage.setItem('short-drama-image-prompt-templates', d.image || '[]')
localStorage.setItem('short-drama-video-templates', d.video || '[]')
location.reload()
```

</details>

> 以上方法已在干净克隆上实测：`npm install` → `npm run build` → 启动 → 首页返回 200，
> 全程不需要 `.env.local`（构建期不读取 Key，Key 只在请求时从服务端读取）。

## 技术栈

Next.js 14（App Router）· React 18 · TypeScript 5.5 · 阿里云百炼 DashScope 兼容接口（`qwen-plus`）

## 已知限制

- 所有创作规则都是**经验规则**，没有真实投放数据回测
- 只支持单段剧情；没有多段连贯、多角色对白调度、长剧集一致性
- 动作动词表（约 180 个）是手工维护的，规模上去会顶到天花板
- 未部署上线，没有并发 / 成本 / 延迟数据
- `app/lib/agent/` 与 `app/lib/server/repositories/` 是预留边界，尚未接入主链路

## License

MIT，详见 [LICENSE](./LICENSE)。
