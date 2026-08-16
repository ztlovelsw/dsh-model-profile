# dsh-model-profile · 模型能力配置（图像 + 思考等级）

[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-8A2BE2)](https://github.com/topics/dsh-plugin)

在 **「设置 → 模型」** 的模型目录编辑器里，**每个已配置模型的行内**直接加两个官方编辑器没有的控件：

- **是否支持图像**：继承默认 / 支持图像（`input: ['text','image']`）/ 仅文本（`input: ['text']`）。
- **思考等级**：继承默认 / 不支持思考（`reasoningEfforts: false`）/ 自定义等级
  （`off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`，逐级勾选并填写接口取值）。

控件块标题行有 **「按 models.dev 预设」** 按钮：按模型 ID 查询
[models.dev](https://models.dev) 开放数据库（自动去掉网关前缀并容忍 `-high` / `-medium`
等思考档后缀，一方厂商条目优先），命中后自动写入该模型的图像支持
（`modalities.input`）与思考等级（`reasoning_options` 枚举，`none` → `off` 且取值为空）；
models.dev 没有意见的字段保持原值不动。

改完**即时写入**，无需重启；下一次请求即按新能力调度。

## 它解决什么

官方 Models 设置页的模型行只暴露 id / 显示名称 / 上下文窗口 / 最大输出，**没有**图像支持与
思考等级入口——这两项只能手写 `settings.yaml`。本插件把它们做成行内控件，填的就是模型目录
编辑器那个位置（自定义模型目录的每一行）。

## 工作原理

- **宿主端**：无行为（纯浏览器插件）。
- **浏览器端**：
  - `controller.ts` 复用官方 Models 页的 join（`llm.providers` + `settings.describe`），只挑出
    `llm-pi-ai` 命名空间下、模型列表由**用户层**持有的提供方（内置目录继承的列表不会被擅自物化）。
  - `enhance.ts` 用 MutationObserver 做**与语言无关的结构探测**：以每行的高级展开按钮 + 两个文本
    输入框为行特征，顺着编辑卡头部（显示名 / route）反查所属提供方。
  - `controls.ts` 往每个模型行注入一个控件块；React 重绘把它冲掉时，观察器自动重注入并从已提交
    设置重新同步（不会覆盖你正在编辑的元素）。
  - 写入走最小 `settings.mutate` 路径操作：`providers.<route>.models[<i>].input` / `.reasoningEfforts`，
    只动这两个字段，模型条目里其它字段（含未知字段）原样保留，并带 `expectedRevision` 防冲突。
  - **粘滞复原**：官方编辑器保存时会把整个 `models` 数组从它的草稿写回，可能顺带抹掉你刚设的能力
    字段；控制器记住你本次会话的显式选择，重载后若发现被抹掉会自动补回，避免数据静默丢失。

## 作用范围与限制

- 只对 **`llm-pi-ai`**（网关 / 自定义提供方）生效——只有它的 schema 声明了每模型 `input` 与
  `reasoningEfforts`。`llm-deepseek` 官方直连的模型目录不支持这两项，故不注入。
- 只增强**用户已自定义**的模型列表（`providers.<route>.models` 在用户层存在）。仅继承内置目录的
  路由请先在模型列表里显式声明模型，再配置能力。
- 能力字段写的是用户层设置，`modelOverrides` 形式暂不处理。

## 安装（独立插件，不属于 dsh-web-ui-all 聚合）

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
即可在该模型行内看到「图像与思考」控件块。

## 卸载

```sh
dsh plugin --profile web remove @ztlovelsw/dsh-model-profile
```

## 开发

```sh
pnpm install        # 或按 dsh-web-ui 约定链接 SDK 依赖
pnpm run build      # tsc -b（类型声明）+ tsdown（宿主/客户端 bundle）
pnpm test           # vitest 纯逻辑单测
```

结构：

- `src/index.ts` — host 半区入口（无行为）。
- `src/client/index.ts` — browser 半区装配（字典、失效刷新、增强器启动）。
- `src/client/controller.ts` — providers/models join、写回、粘滞复原。
- `src/client/enhance.ts` — MutationObserver 结构探测 + 注入协调。
- `src/client/controls.ts` — 注入块 DOM 构建 / 事件 / 同步。
- `src/client/core.ts` — 图像 / 思考等级纯逻辑（可单测）。
- `src/client/locales.ts` — 中英文案。
- `src/client/enhance.module.css` — 注入块样式（跟随外壳设计令牌）。
- `cordis.patch.yml` — bundle patch 插件行（id `ui-model-profile`）。
