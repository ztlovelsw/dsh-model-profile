# dsh-model-profile · 模型能力配置

在 DSH Web 设置 → 插件配置 → Web UI 插件 中新增「模型能力配置」卡片，为**已配置的模型**
批量设置两项能力（官方「设置 → 模型」页面当前不提供）：

- **是否支持图像**：把该模型的 `input` 声明为 `['text', 'image']`（支持）或 `['text']`（不支持）。
- **思考等级**：把该模型的 `reasoningEfforts` 声明为 `false`（不支持思考）或一组
  思考等级及其接口取值（`off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`）。

写入目标是模型所属提供方的设置命名空间（`llm-pi-ai`，网关/自定义提供方；`llm-deepseek`
的模型目录目前不支持这两项字段，因此该提供方显示为只读提示）。保存后即时生效，无需重启。

## 工作原理

- **数据来源**：复用官方 Models 页面的 join —— `llm.providers`（可配置提供方目录）+
  `settings.describe`（命名空间描述）+ `settings.mutate`（路径写）。
- **写路径**：每个模型的编辑都转成最小 `settings.mutate` path ops：
  - 图像：`providers.<route>.models[<i>].input`
  - 思考等级：`providers.<route>.models[<i>].reasoningEfforts`
- **保留隐藏字段**：只写上述两个字段，模型条目里其他字段（名称、上下文窗口、最大输出、
  未知的未来字段）原样保留。
- **宿主端**：无需任何 host 逻辑 —— `llm-pi-ai` 适配器已经读取 `input` 与
  `reasoningEfforts` 并据此决定图像准入与可选择的思考等级。

## 安装（独立插件，不并入全家桶）

本插件是独立安装包，不参与 `dsh-web-ui-all` 聚合。安装到 DSH profile：

```sh
dsh plugin --profile web add link:<本仓库绝对路径>/packages/dsh-model-profile
```

重启 `dsh web` 后，在「设置 → 插件配置 → Web UI 插件」中找到「模型能力配置」卡片。

## 结构

- `src/index.ts` — host 半区入口（无行为）。
- `src/client/` — browser 半区：
  - `index.ts` — 注册字典与 Web UI 插件组卡片。
  - `controller.ts` — 提供方/设置 join 与行模型。
  - `ModelProfileCard.tsx` — 卡片组件与分步编辑模型。
  - `PluginSettingsCard.tsx` / `settings-card.module.css` — 卡片外壳。
  - `locales.ts` — 中英文案。
- `cordis.patch.yml` — bundle patch 插件行（id `ui-model-profile`）。
