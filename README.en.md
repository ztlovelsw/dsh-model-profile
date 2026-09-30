[中文](README.md) · **English**

# dsh-model-profile · Model capability configuration (reasoning levels + capacity)

[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-8A2BE2)](https://github.com/topics/dsh-plugin)

> **This release is built and verified against DSH `0.2.0-rc.2` (and stays compatible with `0.2.0-rc.1`).**
> The official model row ships its own 输入类型 (text/image) checkboxes since 0.2.0-rc.1, so the plugin no
> longer injects an **image** control — see “0.2.0-rc.x changes” below. rc.2 changes nothing this plugin
> touches: the official Models editor bundle (`dsh-client-ui-settings-models`) and the `llm-pi-ai`
> provider/model schema are byte-identical to rc.1; only the build/verification baseline moved to rc.2.

In the **Settings → Models** catalog editor, one control the official editor lacks is added
**inline on every configured model row**:

- **Reasoning level**: Inherit default / No reasoning (`reasoningEfforts: false`) / Custom level
  (`off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`, check levels and fill in the API value).

The control block header has a **「Preset from models.dev」** button: it looks up the model ID in the open
[models.dev](https://models.dev) database (automatically strips gateway prefixes and tolerates reasoning-tier
suffixes like `-high` / `-medium`, with first-party vendor entries taking precedence). On a hit it shows the
model's reasoning level (the `reasoning_options` enum; `none` → `off` with an empty value) in the controls and
**stages it — no write yet**; image support (`modalities.input`) is staged the same way, while the capacity
limits (`limit.context` / `limit.output`) are filled into the official inline "Context window / Max output
tokens" inputs as before (they ride the official editor's draft). When you save this card, the capacity commits
with the official draft and the plugin writes the capability fields on the settings update that follows. Not
saved, not written — the open card's revision snapshot is never bumped out from under its own save. Fields
models.dev has no opinion about are left untouched.

**Newly added models are auto-preset from models.dev**: rows added via "Fetch available models / Add model"
show the control block (with a "Not saved yet" banner) and apply the preset even before saving; your manual
edits are staged just like the preset and written to settings when the editor is saved. Same for "Add custom
provider" — when the provider doesn't exist yet, fill in `Provider ID` and configure the draft model rows
directly; they are written once you click "Create provider". Re-entering a Provider ID clears the staged
selections under the old id; cancel writes nothing. "Add provider" (first-time customization of a catalog
route) works the same — pick the provider at the top of the card and the draft rows are configurable right
away; switching the selected provider clears the staged selections under the previous route.

**Capacity (context window / max output tokens) is likewise preset from models.dev**: expanding any model row
auto-fills empty capacity inputs from models.dev's `limit` — only empty values, endpoint-disclosed or manually
filled values stay; clearing an input doesn't re-fill it. The "Preset from models.dev" button force-overrides
capacity with models.dev values as well. Capacity lands through the official editor's own draft (committed with
save/create); cancel writes nothing.

Changes are written **immediately**, no restart needed; the next request is scheduled with the new capabilities.

**One-click "Sync model capabilities"**: every provider row whose models you own gains a
"Sync model capabilities" button to the left of the official "Edit" button (same size and style). Clicking it
looks up **every model** of that provider on models.dev by ID: matched models get their image support
(`input`) and reasoning levels (`reasoningEfforts`) written directly, while the capacity fields (context
window / max output) are **filled in only when absent** — existing values are never overwritten. Models
models.dev does not list are left untouched. The button reports progress and outcome in place
("Syncing…" → "Synced N fields"); hover for the match count, the unlisted model IDs, and any write failures.
It appears as soon as the row card renders — **no need to expand the model catalog**.

## 0.2.0-rc.x changes

The table compares against 0.1.2-alpha.2; `0.2.0-rc.2` changes nothing this plugin depends on (the official
Models editor client bundle is byte-identical and the `llm-pi-ai` config schema is unchanged — the new
`dsh-user-questions` remote namespace and the Mistral / mid-convo compat fields are unrelated).

| Area | 0.1.2-alpha.2 and earlier | 0.2.0-rc.1 / rc.2 |
| --- | --- | --- |
| Image support (`input`) | Plugin injected an inline select | The **official row ships** 输入类型 (text/image) checkboxes; the plugin injects no duplicate, and only writes the field for "Preset from models.dev" and "Sync model capabilities" |
| `input` lifetime | Sticky restore like every capability | **Seed once, then forget**: an image choice made in the official control is never reverted |
| Reasoning levels (`reasoningEfforts`) | Plugin injected | Still no official surface, so the plugin keeps injecting it and keeps the **sticky restore** (nothing official can edit that field) |
| Per-provider proxy | Plugin wrote `providers.<route>.proxy` | **Removed**: that field exists in neither the 0.2.0-rc.1 nor the rc.2 pi-ai provider schema, and neither the adapter nor pi-ai reads it; proxying is process-wide now, via `dsh-http-proxy` reading `http_proxy` / `https_proxy` / `all_proxy` / `no_proxy` (`$DSH_HOME/.env` or real environment variables) |
| SDK dependencies | `@deepseek-ai/dsh-*@^0.1.2-alpha.2` | `^0.2.0-rc.1` (covers rc.1, rc.2 and later 0.2.x) plus `@deepseek-ai/cordis@^4.0.4`; the build/test baseline is pinned to `0.2.0-rc.2` (DSH validates every `@deepseek-ai/dsh-*` peer range against its own runtime version, and refuses to start plugins with stale ranges) |

Configure the proxy in `$DSH_HOME/.env` (or export the variables), for example:

```sh
HTTPS_PROXY=http://127.0.0.1:7890
HTTP_PROXY=http://127.0.0.1:7890
NO_PROXY=localhost,127.0.0.1
```

Then restart `dsh web`. A leftover `providers.<route>.proxy` field in settings is inert; keeping it is
harmless, and the plugin no longer reads or writes it.

## What it solves

Official Models settings rows expose id / display name / context window / max output (plus input types since
0.2.0-rc.1+) — there is **no** reasoning level entry point, so `reasoningEfforts` could only be hand-written
into `settings.yaml`. This plugin turns it into an inline control, filling exactly the slot of the model
catalog editor (each row of custom model catalogs).

## How it works

- **Host side**: no behavior (pure browser plugin).
- **Browser side**:
  - `controller.ts` reuses the official Models page join (`remote.llm.listConfigurableProviders` + `remote.settings.describe`) and only picks
    providers under the `llm-pi-ai` namespace whose model lists are held by the **user** layer (lists inherited
    from the built-in catalog are not materialized on its own).
  - `enhance.ts` uses a MutationObserver for **language-agnostic structural detection**: rows are identified by
    their advanced-expand button plus two text inputs, then traced back up the edit-card header (display name /
    route) to the owning provider.
  - `controls.ts` injects a control block into every model row; when a React repaint wipes it out, the observer
    re-injects it and re-syncs from the committed settings (never clobbering elements you are editing).
  - Writes go through minimal `settings.mutate` path operations: `…models[<i>].reasoningEfforts` (and `…input`
    for image seeding), touching only the target field; every other field in the model entry (including unknown
    ones) is preserved, and `expectedRevision` guards against conflicts.
  - **Two lifetimes**: `reasoningEfforts` is **sticky** — on save, the official editor writes the whole
    `models` array back from its draft, which can wipe out the level you just set, so the controller remembers
    your explicit choices for the session and restores them after a reload. `input` is **seed-once** — it is
    handed to the official checkboxes and never touched again, so the plugin can never revert an image choice
    made in the official control.

## Scope and limitations

- Only affects **`llm-pi-ai`** (gateway / custom providers) — only its schema declares a per-model `input` and
  `reasoningEfforts`. The `llm-deepseek` official direct catalog supports neither, so nothing is injected.
- Only enhances **user-customized** model lists (`providers.<route>.models` present in the user layer). For
  routes that merely inherit from the built-in catalog, declare the models explicitly in the list first, then
  configure capabilities.
- Capability fields are written to the user layer settings; the `modelOverrides` form is not handled for now.
- Writes are serialized per namespace, and a `settings/conflict` (the namespace moved past the write's
  snapshot) heals itself by reloading the join and retrying once instead of surfacing the raw error. Capability
  fields set via "Preset from models.dev" land with the card's save and never collide with it; MANUAL reasoning
  changes still write immediately, and the official editor card snapshots the namespace revision when it opens
  — after a manual change, saving that card's own edits IMMEDIATELY may still report "settings changed; close
  and reopen". Save the card's other edits first, or close and reopen the card before saving.
- Editing image support in the official 输入类型 checkboxes never conflicts with this plugin: the plugin does
  not overwrite that field.

## Installation

> **Version compatibility**: this release is built and verified against DSH `0.2.0-rc.2`, and its peer
> range (`@deepseek-ai/dsh-*@^0.2.0-rc.1`, `@deepseek-ai/cordis@^4.0.4`) covers `0.2.0-rc.1`, `0.2.0-rc.2`
> and later `0.2.x`. Client access goes through the `remote.settings` / `remote.llm` namespaces mounted by
> `dsh-api-remotes`; `dsh-client-runtime` is gone in favor of `@deepseek-ai/cordis`'s `Context`. DSH
> validates every `@deepseek-ai/dsh-*` peer range against its runtime version (`dsh plugin list` prints an
> incompatibility warning and startup refuses non-exempted plugins), so a `0.1.x`-era build **must be
> reinstalled** on 0.2.0-rc.x — then **restart `dsh web`**. A version-mismatched SDK installed alongside
> the host breaks session scoping (surfacing as `agent-presets: refusing to compose an unscoped context`
> when selecting a model).

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

Then restart `dsh web`, open **Settings → Models**, expand any custom provider and open a model's advanced
settings — the "Model capabilities" control block appears inline on that model row (image support uses the
official 输入类型 checkboxes in the same region).

## Uninstall

```sh
dsh plugin --profile web remove @ztlovelsw/dsh-model-profile
```

## Development

```sh
pnpm install        # or link the SDK dependencies per dsh-web-ui conventions
pnpm run build      # tsc -b (type declarations) + tsdown (host/client bundles)
pnpm test           # vitest pure-logic unit tests
```

Structure:

- `src/index.ts` — host half entry (no behavior).
- `src/client/index.ts` — browser half assembly (dictionary, invalidation refresh, enhancer bootstrap).
- `src/client/controller.ts` — providers/models join, write-back, capability lifetimes.
- `src/client/enhance.ts` — MutationObserver structural detection + injection coordination.
- `src/client/controls.ts` — injected block DOM, events, sync, and the bulk-sync button.
- `src/client/core.ts` — reasoning-level pure logic (unit-testable).
- `src/client/locales.ts` — Chinese & English copy.
- `src/client/enhance.module.css` — injected block styles (follows the shell design tokens).
- `cordis.patch.yml` — bundle patch plugin line (id `ui-model-profile`).
