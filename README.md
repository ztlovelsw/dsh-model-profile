**中文** · [English](README.en.md)

# dsh-model-profile · 模型能力配置（思考等级 + 上下文容量）

[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-8A2BE2)](https://github.com/topics/dsh-plugin)

> **本版本对齐 DSH `0.2.0-rc.2`（同时兼容 `0.2.0-rc.1`）。** 官方模型行自 0.2.0-rc.1 起已自带
> 「输入类型（文本/图像）」勾选框，因此插件不再注入**图像**控件（见下方「0.2.0-rc.x 变更」）。
> rc.2 相对 rc.1 只是新增了 remote 命名空间与 pi-ai compat 字段：官方 Models 编辑器
> （`dsh-client-ui-settings-models`）与 `llm-pi-ai` 的 provider/model schema 二进制一致，
> 本插件无需改代码，仅把构建/验证基线升到 rc.2。

在 **「设置 → 模型」** 的模型目录编辑器里，**每个已配置模型的行内**加一个官方编辑器没有的控件：

- **思考等级**：继承默认 / 不支持思考（`reasoningEfforts: false`）/ 自定义等级
  （`off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`，逐级勾选并填写接口取值）。

控件块标题行有 **「按 models.dev 预设」** 按钮：按模型 ID 查询
[models.dev](https://models.dev) 开放数据库（自动去掉网关前缀并容忍 `-high` / `-medium`
等思考档后缀，一方厂商条目优先），命中后把该模型的思考等级
（`reasoning_options` 枚举，`none` → `off` 且取值为空）**显示在控件里并暂存，不立即写入**；
图像支持（`modalities.input`）同样暂存，容量上限（`limit.context` / `limit.output`）则照旧填进官方行内的
「上下文窗口 / 最大输出 token」输入框（走官方编辑器的草稿）。点本卡的「保存」后，容量随官方草稿一起提交，
能力字段由插件在保存后随 `settings` 更新落地；不保存就不写入，避免把官方卡片打开时快照的 revision
顶掉、导致保存报「设置已被改动」。models.dev 没有意见的字段保持原值不动。

**新添加的模型自动按 models.dev 预设**：通过「获取可用模型 / 添加模型」新增的行
在保存前就会显示控件块（带「尚未保存」横幅）并自动套用预设；你的手动修改与预设
一样先暂存，待编辑器保存落地后自动写入设置。「添加自定义提供方」同理——提供方
尚未创建时，填好 `Provider ID` 即可对草稿模型行直接配置，点「创建提供方」后自动
写入；重输 Provider ID 会清掉旧 id 下暂存的选择，取消则什么都不写。「添加提供方」
（为目录路由首次定制）也同理——卡片顶部选好提供方后草稿行即时可配；切换所选
提供方会清掉旧路由下暂存的选择。

**容量（上下文窗口 / 最大输出 token）同样按 models.dev 预设**：展开任意模型行时，
空的容量输入框会按 models.dev 的 `limit` 自动填入——只补空值，端点已披露或你手动
填写的值不动；清空后不会再次回填。「按 models.dev 预设」按钮则会把容量一并强制
覆盖为 models.dev 的值。容量值经由官方编辑器自己的草稿落地（随保存/创建提交），
取消则不写。

改完**即时写入**，无需重启；下一次请求即按新能力调度。

**一键「同步模型能力」**：每个已自定义模型的提供方行卡片上，「编辑」按钮左边会多出一个
「同步模型能力」按钮（与「编辑」同尺寸同样式）。点击后对该提供方下的**全部模型**按模型 ID 查询
models.dev：命中的模型直接写入图像支持（`input`）与思考等级（`reasoningEfforts`）两个能力字段，
容量（上下文窗口 / 最大输出）**只在未填写时补全**、不覆盖你已有的取值；未收录的模型原样保留。
按钮就地显示进度与结果（「同步中…」→「已同步 N 项」），鼠标悬停可看命中数、未收录的模型 ID
与写入失败信息。按钮在行卡片渲染后即出现，**无需展开模型目录**。

## 0.2.0-rc.x 变更

下表是相对 0.1.2-alpha.2 的行为差异；`0.2.0-rc.2` 相对 `0.2.0-rc.1` 没有影响本插件的改动
（官方 Models 编辑器客户端 bundle 逐字节一致，`llm-pi-ai` 的 config schema 一致；新增的
`dsh-user-questions` remote 命名空间与 Mistral / mid-convo compat 字段都与本插件无关）。

| 项目 | 0.1.2-alpha.2 及以前 | 0.2.0-rc.1 / rc.2 |
| --- | --- | --- |
| 图像支持（`input`） | 插件在行内注入下拉框 | **官方行内自带**「输入类型」勾选框；插件不再注入重复控件，只会在「按 models.dev 预设」与「同步模型能力」时写入该字段 |
| `input` 的写后处理 | 与其他能力字段一样粘滞复原 | **一次性落地**：写入后即忘，之后以官方勾选框为准，绝不回滚你在官方控件里的选择 |
| 思考等级（`reasoningEfforts`） | 插件注入 | 官方仍无入口，插件继续注入；**继续粘滞复原**（官方改不到这个字段） |
| 提供方代理 | 插件写 `providers.<route>.proxy` | **已移除**：该字段在 0.2.0-rc.1 与 rc.2 的 pi-ai provider schema 中都不存在，适配器与 pi-ai 都不读取它；代理改为进程级 `dsh-http-proxy`，读 `http_proxy` / `https_proxy` / `all_proxy` / `no_proxy`（`$DSH_HOME/.env` 或环境变量） |
| SDK 依赖 | `@deepseek-ai/dsh-*@^0.1.2-alpha.2` | `^0.2.0-rc.1`（覆盖 rc.1、rc.2 与后续 0.2.x）、`@deepseek-ai/cordis@^4.0.4`；构建与测试基线固定 `0.2.0-rc.2`（DSH 会按运行时版本校验 `@deepseek-ai/dsh-*` peer 范围，旧范围会被判为不兼容并拒绝启动） |

代理入口现在写在 `$DSH_HOME/.env`（或直接导出环境变量），例如：

```sh
HTTPS_PROXY=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890
NO_PROXY=localhost,127.0.0.1
```

改完重启 `dsh web`。设置里遗留的 `providers.<route>.proxy` 字段已成惰性数据，留着无害，
想清理也可以直接删掉（插件不会再去读写它）。

## 它解决什么

官方 Models 设置页的模型行暴露 id / 显示名称 / 上下文窗口 / 最大输出（0.2.0-rc.1 起还有输入类型），
**没有**思考等级入口——`reasoningEfforts` 只能手写 `settings.yaml`。本插件把它做成行内控件，
填的就是模型目录编辑器那个位置（自定义模型目录的每一行）。

## 工作原理

- **宿主端**：无行为（纯浏览器插件）。
- **浏览器端**：
  - `controller.ts` 复用官方 Models 页的 join（`remote.llm.listConfigurableProviders` +
    `remote.settings.describe`），只挑出
    `llm-pi-ai` 命名空间下、模型列表由**用户层**持有的提供方（内置目录继承的列表不会被擅自物化）。
  - `enhance.ts` 用 MutationObserver 做**与语言无关的结构探测**：以每行的高级展开按钮 + 两个文本
    输入框为行特征，顺着编辑卡头部（显示名 / route）反查所属提供方。
  - `controls.ts` 往每个模型行注入一个控件块；React 重绘把它冲掉时，观察器自动重注入并从已提交
    设置重新同步（不会覆盖你正在编辑的元素）。
  - 写入走最小 `settings.mutate` 路径操作：`providers.<route>.models[<i>].reasoningEfforts`（图像则是
    `…input`），只动目标字段，模型条目里其它字段（含未知字段）原样保留，并带 `expectedRevision` 防冲突。
  - **两种生命周期**：`reasoningEfforts` 是**粘滞复原**的——官方编辑器保存时会从草稿整段写回
    `models` 数组，可能顺带抹掉你刚设的思考等级，控制器记住你本次会话的显式选择并在重载后补回；
    `input` 则是**一次性落地**——写进去就交给官方勾选框，之后不再干预，避免插件的粘滞逻辑把你在
    官方控件里的改动改回去。

## 作用范围与限制

- 只对 **`llm-pi-ai`**（网关 / 自定义提供方）生效——只有它的 schema 声明了每模型 `input` 与
  `reasoningEfforts`。`llm-deepseek` 官方直连的模型目录不支持这两项，故不注入。
- 只增强**用户已自定义**的模型列表（`providers.<route>.models` 在用户层存在）。仅继承内置目录的
  路由请先在模型列表里显式声明模型，再配置能力。
- 能力字段写的是用户层设置，`modelOverrides` 形式暂不处理。
- 写入按命名空间**串行化**，遇到并发写入导致的 revision 冲突（`settings/conflict`）会自动重新加载
  join 并重试一次，不会把原始冲突抛给用户。「按 models.dev 预设」设置的能力字段会随官方卡片保存
  落地（不占用官方操作的 revision），不会与卡片保存冲突；**手动**改动思考等级仍是即时写入，官方编辑器
  卡片在打开时会快照命名空间 revision——手动改完能力后**立即**点卡片自身的「保存」可能提示「设置已
  被改动，请关闭后重新打开」：先保存卡片的其它编辑，或关掉卡片重新打开后再保存即可。
- 在官方「输入类型」勾选框里改图像支持不会与本插件冲突：插件不会去覆盖它。

## 安装

> **版本兼容**：本版本在 DSH `0.2.0-rc.2` 上构建与验证，peer 范围 `@deepseek-ai/dsh-*@^0.2.0-rc.1` +
> `@deepseek-ai/cordis@^4.0.4` 同时覆盖 `0.2.0-rc.1`、`0.2.0-rc.2` 与后续 `0.2.x`。客户端接入走
> `dsh-api-remotes` 挂载的 `remote.settings` / `remote.llm` 命名空间；`dsh-client-runtime` 已被移除，
> 类型走 `@deepseek-ai/cordis` 的 `Context`。
> DSH 会按运行时版本校验插件的 `@deepseek-ai/dsh-*` peer 范围（`dsh plugin list` 会打印不兼容告警，
> 并在启动时拒绝加载未豁免的插件），所以 `0.1.x` 时代的旧版插件在 0.2.0-rc.x 上**必须重新安装**；装完
> **重启 `dsh web`**。若你装的是旧版本又升级了 DSH，请重新安装本插件——版本不匹配的 SDK 与宿主并列
> 安装会破坏会话作用域（表现为选择模型时
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

然后重启 `dsh web`，打开「设置 → 模型」，展开任一自定义提供方并打开某个模型的高级设置，
即可在该模型行内看到「模型能力」控件块（图像支持用同一区域里官方自带的「输入类型」勾选框）。

## 卸载

```sh
dsh plugin --profile web remove @ztlovelsw/dsh-model-profile
```

## 开发

```sh
pnpm install       
pnpm run build      # tsc -b（类型声明）+ tsdown（宿主/客户端 bundle）
pnpm test           # vitest 纯逻辑单测
```

结构：

- `src/index.ts` — host 半区入口（无行为）。
- `src/client/index.ts` — browser 半区装配（字典、失效刷新、增强器启动）。
- `src/client/controller.ts` — providers/models join、写回、能力字段生命周期。
- `src/client/enhance.ts` — MutationObserver 结构探测 + 注入协调。
- `src/client/controls.ts` — 注入块 DOM 构建 / 事件 / 同步 / 批量同步按钮。
- `src/client/core.ts` — 思考等级纯逻辑（可单测）。
- `src/client/locales.ts` — 中英文案。
- `src/client/enhance.module.css` — 注入块样式（跟随外壳设计令牌）。
- `cordis.patch.yml` — bundle patch 插件行（id `ui-model-profile`）。
