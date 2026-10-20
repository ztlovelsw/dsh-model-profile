**中文** · [English](README.en.md)

# dsh-model-profile · 模型能力同步（思考等级 / 图像支持 / 上下文容量）

[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-8A2BE2)](https://github.com/topics/dsh-plugin)

> **0.6.0 起本插件只做一件事：提供方行上的「同步模型能力」按钮。**
> 官方模型行现在自带**推理等级**编辑（当前 DSH 的 `dsh-client-ui-settings-models` 已内置
> `readEfforts` / `withEfforts`：逐档勾选 + 接口取值，并对非 `off` 档校验取值非空），
> 与 0.2.0-rc.1 起自带的**输入类型（文本 / 图像）**勾选框一样，已经不需要插件代劳。
> 因此插件不再往任何模型行注入控件、也不再跨保存「守护」这些字段，只保留按
> [models.dev](https://models.dev) 批量补全的按钮。
> 构建基线仍是 `@deepseek-ai/dsh-*` `0.2.0-rc.2`（peer 范围 `^0.2.0-rc.1`，覆盖 `0.2.x`）。

## 唯一入口：「同步模型能力」

每个**模型列表由你自己维护**的提供方行卡片上，「编辑」按钮左边会多出一个
**「同步模型能力」**按钮（复制官方按钮的 class，因此同尺寸同样式；React 重绘把它冲掉时观察器会
自动重注入，重复扫描不会产生第二个按钮）。点击后对该提供方下的**全部模型**按模型 ID 查询
models.dev：

| 字段 | 行为 |
| --- | --- |
| 思考等级 `reasoningEfforts` | 命中即写入（`reasoning_options` 枚举，`none` → `off` 且取值为 `null`） |
| 图像支持 `input` | 命中即写入（`modalities.input` 含 `image` → `['text','image']`，否则 `['text']`） |
| 上下文窗口 `contextWindow` / 最大输出 `maxTokens` | **只补空值**（`limit.context` / `limit.output`）：已填写的取值不覆盖 |

按钮就地显示进度与结果（「同步中…」→「已同步 N 项」），鼠标悬停可看命中数、未收录的模型 ID 与
写入失败信息；未收录的模型原样保留。按钮在行卡片渲染后即出现，**无需展开模型目录**。

**写入是一次性落地**：字段写进去之后，官方行内的「推理等级 / 输入类型」控件就是唯一权威——插件不会
在后续保存或刷新中把值改回去，你在官方控件里的修改永远生效。

## 模型 ID 匹配规则

网关 / 目录路由的模型 ID 常带前缀，逐层剥掉后再查 models.dev（每层都算候选，从最具体到最泛）：

1. **命名空间前缀**：`/` 与 `:` 两种分隔符都剥，且可以嵌套——`cn:deepseek-v4.1-flash`、
   `ag/gemini-3.7-flash-high`、`openrouter/anthropic:claude-x-high` 都能落到
   `deepseek-v4.1-flash` / `gemini-3.7-flash` / `claude-x`；
2. **思考档后缀**：每层再剥一层 `-high` / `-medium` / `-low` / `-extra-low` / `-thinking` / `-none`；
3. 同名条目**一方厂商**（deepseek / google / openai / zai…）优先于聚合网关的别名条目。

原始 id 永远排在最前，所以 models.dev 里真有带前缀的条目时不会被剥出来的短 id 抢走。

## 0.6.0 变更

| 项目 | 0.5.0 及以前 | 0.6.0 |
| --- | --- | --- |
| 思考等级（`reasoningEfforts`） | 插件在模型行内注入「继承 / 不支持思考 / 自定义等级」下拉 + 七档勾选 | **官方模型行自带**推理等级编辑；插件不再注入任何每模型控件 |
| 每模型「按 models.dev 预设」按钮 | 有（暂存，随官方卡片保存落地） | **移除**：单模型配置交给官方控件，批量补全交给「同步模型能力」 |
| 容量自动填充 | 展开模型行时自动填空白容量框 | **移除**：只在点「同步模型能力」时对未填写的容量补全 |
| 写入生命周期 | `reasoningEfforts` 为**粘滞复原**（官方改不到该字段，故由插件守值） | **一次性落地**：官方控件成为权威，插件不再复原 |
| 模型 ID 匹配 | 只剥 `/` 路由前缀 | 同时剥 `:` 命名空间前缀（`cn:` 等），支持嵌套前缀链 |
| 注入 DOM | 每模型行一个控件块 | 只剩提供方行的一个按钮 |

已经写进设置的 `reasoningEfforts` / `input` 值**不会**被这次升级改动，官方行会直接以它们为初值渲染。

## 它解决什么

官方模型行能逐档编辑推理等级与输入类型，但**逐个模型手点**仍然费事；`reasoningEfforts` 的档位枚举、
接口取值，以及`contextWindow` / `maxTokens` 这些数字，在 models.dev 里本来就是现成的。
本插件把「按提供方一键拉齐」做成一个按钮，填的就是模型目录编辑器里的那些字段。

## 工作原理

- **宿主端**：无行为（纯浏览器插件）。
- **浏览器端**：
  - `controller.ts` 复用官方 Models 页的 join（`remote.llm.listConfigurableProviders` +
    `remote.settings.describe`），只挑出 `llm-pi-ai` 命名空间下、模型列表由**用户层**持有的提供方
    （内置目录继承的列表不会被擅自物化）。
  - `enhance.ts` 用 MutationObserver 做**与语言无关的结构探测**：提供方行 = `<li>`，其首个子元素为
    行头，行头里带一组官方按钮（`<span>` 内全是 `button`）。扫描从按钮出发、按父元素去重，
    每次扫描只过一遍已渲染按钮。
  - `controls.ts` 在该按钮组首位（「编辑」左边）坐上同步按钮，并执行批量同步。
  - 写入走最小 `settings.mutate` 路径操作：`providers.<route>.models` 整段 `set`（设置服务的路径
    解析器无法下钻数组，`…models.0.input` 会把数组换成对象而校验失败），只补目标字段、其余字段
    （含未知字段）原样保留，并带 `expectedRevision` 防冲突；遇到并发写入导致的
    `settings/conflict` 会自动重新加载 join 并重试一次，不会把原始冲突抛给用户。

## 作用范围与限制

- 只对 **`llm-pi-ai`**（网关 / 自定义提供方）生效——只有它的 schema 声明了每模型 `input` 与
  `reasoningEfforts`。`llm-deepseek` 官方直连的模型目录不支持这两项，故不出按钮。
- 只增强**用户已自定义**的模型列表（`providers.<route>.models` 在用户层存在）。仅继承内置目录的
  路由请先在模型列表里显式声明模型，再点同步。
- 容量只补空值；想强制覆盖就清空那个输入框再同步。
- 字段写的是用户层设置，`modelOverrides` 形式暂不处理。
- 同步按命名空间串行化，一次点击只写真正有变化的字段（值已相同的字段跳过，不消耗 revision）。

## 安装

> **版本兼容**：peer 范围 `@deepseek-ai/dsh-*@^0.2.0-rc.1` + `@deepseek-ai/cordis@^4.0.4` 覆盖
> `0.2.0-rc.1`、`0.2.0-rc.2` 与后续 `0.2.x`；构建与测试基线固定 `0.2.0-rc.2`。
> 客户端接入走 `dsh-api-remotes` 挂载的 `remote.settings` / `remote.llm` 命名空间；类型走
> `@deepseek-ai/cordis` 的 `Context`。
> DSH 会按运行时版本校验插件的 `@deepseek-ai/dsh-*` peer 范围（`dsh plugin list` 会打印不兼容告警，
> 并在启动时拒绝加载未豁免的插件），所以 `0.1.x` 时代的旧版插件在 `0.2.x` 上**必须重新安装**；装完
> **重启 `dsh web`**。版本不匹配的 SDK 与宿主并列安装会破坏会话作用域（表现为选择模型时
> `agent-presets: refusing to compose an unscoped context`）。

从 npm 安装：

```sh
dsh plugin --profile web add @ztlovelsw/dsh-model-profile
```

或本地 link 安装：

```sh
dsh plugin --profile web add link:<本目录绝对路径>
```

例如：

```sh
dsh plugin --profile web add link:D:\Desktop\dsh-model-profile
```

然后重启 `dsh web`，打开「设置 → 模型」，任一自定义提供方行的「编辑」左侧即出现
**「同步模型能力」**按钮。

## 卸载

```sh
dsh plugin --profile web remove @ztlovelsw/dsh-model-profile
```

## 开发

```sh
pnpm install
pnpm run build      # tsc -b（类型声明）+ tsdown（宿主/客户端 bundle）
pnpm test           # vitest 单测
```

结构：

- `src/index.ts` — host 半区入口（无行为）。
- `src/client/index.ts` — browser 半区装配（字典、失效刷新、增强器启动）。
- `src/client/controller.ts` — providers/models join 与 revision 围栏写入。
- `src/client/enhance.ts` — MutationObserver 结构探测 + 扫描调度。
- `src/client/controls.ts` — 同步按钮的注入与批量同步。
- `src/client/presets.ts` — models.dev 拉取、索引与模型 ID 匹配（`cn:` 等前缀）、字段换算。
- `src/client/locales.ts` — 中英文案。
- `src/client/enhance.module.css` — 按钮兜底样式（跟随外壳设计令牌）。
- `cordis.patch.yml` — bundle patch 插件行（id `ui-model-profile`）。
