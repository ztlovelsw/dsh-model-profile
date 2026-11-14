[中文](README.md) · **English**

# dsh-model-profile · Model capability sync and request-header settings

[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-8A2BE2)](https://github.com/topics/dsh-plugin)

> **The plugin provides two provider-row actions: 「Sync model capabilities」 and 「Advanced settings」.**
> The official model row now ships its own **reasoning-level** editor (the current DSH build of
> `dsh-client-ui-settings-models` bundles `readEfforts` / `withEfforts`: one row per offered level with its
> wire value, validating that every non-`off` level carries a non-empty value) — just like it has shipped its
> own **input type** (text / image) checkboxes since 0.2.0-rc.1. So the plugin no longer injects a control into
> any model row, and no longer defends those fields across saves; models.dev still supplies the bulk capability
> sync, while request headers are configured per provider.
> The build baseline stays `@deepseek-ai/dsh-*` `0.2.0-rc.2` (peer range `^0.2.0-rc.1`, covering `0.2.x`).

## The only entry point: 「Sync model capabilities」

Every provider row whose model list **you** own gains a **「Sync model capabilities」** button to the left of
the official 「Edit」 button (it copies that button's class, so it renders at exactly the same size; when a
React repaint wipes it the observer re-injects it, and repeated sweeps never create a second one). Clicking it
looks up **every model** of that provider on [models.dev](https://models.dev) by model ID:

| Field | Behavior |
| --- | --- |
| Reasoning levels `reasoningEfforts` | Written on a match (the `reasoning_options` enum, `none` → `off` with a `null` wire value) |
| Image support `input` | Written on a match (`modalities.input` containing `image` → `['text','image']`, otherwise `['text']`) |
| Context window `contextWindow` / max output `maxTokens` | **Gap-filled only** (`limit.context` / `limit.output`): an existing value is never overwritten |

The button reports progress and outcome in place (「Syncing…」 → 「Synced N fields」); hover for the match
count, the unlisted model IDs, and any write failures. Models models.dev does not list are left untouched. It
appears as soon as the row card renders — **no need to expand the model catalog**.

**Every write is a one-shot seed**: once a field lands, the official row's own reasoning-level and input-type
controls are the only authority — the plugin never re-applies a value on a later save or reload, so an edit
made in the official control always stands.

## Provider advanced settings: custom request headers

Every `llm-pi-ai` provider row also has 「Advanced settings」. It provides:

- an enable switch for that provider's custom headers; disabling it stops adding headers without changing the
  original `llm-pi-ai` profile;
- a JSON editor for arbitrary `Header: string` values, applied to new inference requests after saving;
- editable **Codex** and **Claude** header templates.

The Codex template follows the public client identity vocabulary documented by
[codex-proxy-rs](https://github.com/zyycn/codex-proxy-rs) and starts with `originator: codex_cli_rs`. The Claude
template starts with `anthropic-version: 2023-06-01`. Authentication, `User-Agent`, and session headers remain
owned by DSH/pi-ai, so the templates do not fabricate an API key or override DSH's `User-Agent`.

The settings live in this plugin's `ui-model-profile` namespace and are isolated by provider route. The host uses
the request-level `llm-pi-ai/request-headers` waterfall; Cordis removes the listener when the plugin unloads. No
DSH installation files or process-wide `fetch` patch are modified.

## Model ID matching

Gateway / catalog routes usually prefix a model ID, so prefixes are peeled off before the lookup (every peeled
form is a candidate, most specific first):

1. **Namespace prefixes**: both separators are peeled — `/` and `:` — and they nest, so
   `cn:deepseek-v4.1-flash`, `ag/gemini-3.7-flash-high` and `openrouter/anthropic:claude-x-high` all resolve
   to `deepseek-v4.1-flash` / `gemini-3.7-flash` / `claude-x`;
2. **Reasoning-tier suffixes**: one more peel per level — `-high` / `-medium` / `-low` / `-extra-low` /
   `-thinking` / `-none`;
3. Same-id **first-party** entries (deepseek / google / openai / zai …) beat aggregator aliases.

The raw ID always comes first, so a genuinely prefixed entry in models.dev is never shadowed by the stripped
form.

## 0.6.0 changes

| Area | 0.5.0 and earlier | 0.6.0 |
| --- | --- | --- |
| Reasoning levels (`reasoningEfforts`) | Plugin injected an inline 「inherit / no reasoning / custom levels」 select plus the seven-level grid | The **official row ships** the reasoning-level editor; the plugin injects no per-model control at all |
| Per-model 「Preset from models.dev」 button | Present (staged, landed with the official card's save) | **Removed**: per-model editing belongs to the official control, bulk filling to 「Sync model capabilities」 |
| Capacity auto-fill | Filled empty capacity inputs when a row expanded | **Removed**: capacity is gap-filled only when you click 「Sync model capabilities」 |
| Write lifetime | `reasoningEfforts` was **sticky-restored** (nothing official could edit it, so the plugin defended it) | **Seed once**: the official control is authoritative, the plugin never restores |
| Model ID matching | Peelled `/` route prefixes only | Also peels `:` namespace prefixes (`cn:` …), including nested chains |
| Injected DOM | One control block per model row | One button per provider row |

Values already stored in settings are **not** touched by this upgrade — the official row simply renders them
as its initial state.

## What it solves

The official model row can edit reasoning levels and input types level by level, but doing that **per model by
hand** is still tedious, and the level enum, its wire spellings, and the `contextWindow` / `maxTokens` numbers
are all already published on models.dev. This plugin turns "align one provider in one click" into a button that
fills exactly those fields of the model catalog editor.

## How it works

- **Host side**: registers the request-level `llm-pi-ai/request-headers` listener, reads the plugin config by
  provider route, and adds the configured headers while enabled.
- **Browser side**:
  - `controller.ts` reuses the official Models page join (`remote.llm.listConfigurableProviders` +
    `remote.settings.describe`) and only picks providers under the `llm-pi-ai` namespace whose model lists are
    held by the **user** layer (lists inherited from the built-in catalog are never materialized).
  - `enhance.ts` uses a MutationObserver for **language-agnostic structural detection**: a provider row is an
    `<li>` whose first child is the head, and the head carries an official button group (a `<span>` of
    `button`s). The scan starts from buttons and dedupes by parent, so a sweep costs one pass over the
    rendered buttons.
  - `header-controller.ts` reads and revision-fences the `ui-model-profile` request-header namespace;
  - `controls.ts` adds the 「Advanced settings」 and 「Sync model capabilities」 actions, with the JSON editor,
    enable switch, and two templates.
  - Writes go through one minimal `settings.mutate` path op: a whole-array `set` of
    `providers.<route>.models` (the settings path walker cannot descend into arrays — `…models.0.input` would
    replace the array with an object and fail schema validation), patching only the target field and preserving
    every other field (including unknown ones), fenced by `expectedRevision`; a `settings/conflict` from a
    concurrent writer heals itself by reloading the join and retrying once instead of surfacing the raw error.

## Scope and limitations

- Capability sync affects **`llm-pi-ai`** (gateway / custom providers) because its schema declares per-model
  `input` and `reasoningEfforts`; request-header settings are also shown per `llm-pi-ai` provider route.
- Only enhances **user-customized** model lists (`providers.<route>.models` present in the user layer). For a
  route that merely inherits the built-in catalog, declare the models explicitly first, then sync.
- Capacity is gap-filled only; to force models.dev values, clear the input first.
- Capability fields are written to the user layer; the `modelOverrides` form is not handled yet.
- Writes are serialized per namespace, and a click only writes fields whose value actually changes (equal
  values are skipped, so they never consume a revision).

## Installation

> **Version compatibility**: the peer range `@deepseek-ai/dsh-*@^0.2.0-rc.1` + `@deepseek-ai/cordis@^4.0.4`
> covers `0.2.0-rc.1`, `0.2.0-rc.2` and later `0.2.x`; the build and test baseline is pinned to
> `0.2.0-rc.2`. Client access goes through the `remote.settings` / `remote.llm` namespaces mounted by
> `dsh-api-remotes`, and types come from `@deepseek-ai/cordis`'s `Context`. DSH validates every
> `@deepseek-ai/dsh-*` peer range against its runtime version (`dsh plugin list` prints an incompatibility
> warning and startup refuses non-exempted plugins), so a `0.1.x`-era build **must be reinstalled** on
> `0.2.x` — then **restart `dsh web`**. A version-mismatched SDK installed alongside the host breaks session
> scoping (surfacing as `agent-presets: refusing to compose an unscoped context` when selecting a model).

From npm:

```sh
dsh plugin --profile web add @ztlovelsw/dsh-model-profile
```

Or via a local link:

```sh
dsh plugin --profile web add link:<absolute path to this directory>
```

For example:

```sh
dsh plugin --profile web add link:D:\Desktop\dsh-model-profile
```

Then restart `dsh web`, open **Settings → Models**: every provider row has **「Advanced settings」** to the left
of 「Edit」, and custom providers whose model lists are user-owned also have **「Sync model capabilities」**.

## Uninstall

```sh
dsh plugin --profile web remove @ztlovelsw/dsh-model-profile
```

## Development

```sh
pnpm install
pnpm run build      # tsc -b (type declarations) + tsdown (host/client bundles)
pnpm test           # vitest unit tests
```

Structure:

- `src/index.ts` — host half entry (request-header schema and `llm-pi-ai/request-headers` hook).
- `src/client/index.ts` — browser half assembly (dictionary, invalidation refresh, enhancer bootstrap).
- `src/client/controller.ts` — providers/models join and revision-fenced writes.
- `src/client/header-controller.ts` — provider request-header reads, saves, and revision fencing.
- `src/client/enhance.ts` — MutationObserver structural detection + sweep scheduling.
- `src/client/controls.ts` — the sync button's injection and the bulk sync.
- `src/header-config.ts` — header namespace and Codex/Claude templates.
- `src/client/presets.ts` — models.dev fetch, index, model-ID matching (`cn:` prefixes) and field mapping.
- `src/client/locales.ts` — Chinese & English copy.
- `src/client/enhance.module.css` — fallback button styles (follows the shell design tokens).
- `cordis.patch.yml` — bundle patch plugin line (id `ui-model-profile`).
