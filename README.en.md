[中文](README.md) · **English**

# dsh-model-profile · Model capability configuration (images + reasoning levels)

[![dsh-plugin](https://img.shields.io/badge/topic-dsh--plugin-8A2BE2)](https://github.com/topics/dsh-plugin)

In the **Settings → Models** catalog editor, two controls the official editor lacks are added **inline on every configured model row**:

- **Image support**: Inherit default / Supports images (`input: ['text','image']`) / Text only (`input: ['text']`).
- **Reasoning level**: Inherit default / No reasoning (`reasoningEfforts: false`) / Custom level
  (`off` / `minimal` / `low` / `medium` / `high` / `xhigh` / `max`, check levels and fill in the API value).

The control block header has a **「Preset from models.dev」** button: it looks up the model ID in the open
[models.dev](https://models.dev) database (automatically strips gateway prefixes and tolerates reasoning-tier
suffixes like `-high` / `-medium`, with first-party vendor entries taking precedence). On a hit it writes the
model's image support (`modalities.input`), reasoning level (the `reasoning_options` enum; `none` → `off` with
an empty value), and capacity limits (`limit.context` / `limit.output` → the official inline "Context window /
Max output tokens" inputs). Fields models.dev has no opinion about are left untouched.

**Newly added models are auto-preset from models.dev**: rows added via "Fetch available models / Add model"
show the control block (with a "Not saved yet" banner) and apply the preset even before saving; your manual
edits are staged just like the preset and written to settings when the editor is saved. Same for "Add custom
provider" — when the provider doesn't exist yet, fill in `Provider ID` and configure the draft model rows
directly; they are written once you click "Create provider". Re-entering a Provider ID clears the staged
selections under the old id; cancel writes nothing.

**Capacity (context window / max output tokens) is likewise preset from models.dev**: expanding any model row
auto-fills empty capacity inputs from models.dev's `limit` — only empty values, endpoint-disclosed or manually
filled values stay; clearing an input doesn't re-fill it. The "Preset from models.dev" button force-overrides
capacity with models.dev values as well. Capacity lands through the official editor's own draft (committed with
save/create); cancel writes nothing.

Changes are written **immediately**, no restart needed; the next request is scheduled with the new capabilities.

## What it solves

Official Models settings rows only expose id / display name / context window / max output — there is **no** image
support or reasoning level entry point; both could only be hand-written into `settings.yaml`. This plugin turns
them into inline controls, filling exactly the slot of the model catalog editor (each row of custom model catalogs).

## How it works

- **Host side**: no behavior (pure browser plugin).
- **Browser side**:
  - `controller.ts` reuses the official Models page join (`llm.providers` + `settings.describe`) and only picks
    providers under the `llm-pi-ai` namespace whose model lists are held by the **user** layer (lists inherited
    from the built-in catalog are not materialized on its own).
  - `enhance.ts` uses a MutationObserver for **language-agnostic structural detection**: rows are identified by
    their advanced-expand button plus two text inputs, then traced back up the edit-card header (display name /
    route) to the owning provider.
  - `controls.ts` injects a control block into every model row; when a React repaint wipes it out, the observer
    re-injects it and re-syncs from the committed settings (never clobbering elements you are editing).
  - Writes go through minimal `settings.mutate` path operations: `providers.<route>.models[<i>].input` /
    `.reasoningEfforts`, touching only those two fields; every other field in the model entry (including unknown
    ones) is preserved, and `expectedRevision` guards against conflicts.
  - **Sticky restore**: on save, the official editor writes the whole `models` array back from its draft, which
    can wipe out the capability fields you just set; the controller remembers your explicit choices for the
    session and, after a reload, auto-restores them when they turn out to have been wiped — no silent data loss.

## Scope and limitations

- Only affects **`llm-pi-ai`** (gateway / custom providers) — only its schema declares a per-model `input` and
  `reasoningEfforts`. The `llm-deepseek` official direct catalog supports neither, so nothing is injected.
- Only enhances **user-customized** model lists (`providers.<route>.models` present in the user layer). For
  routes that merely inherit from the built-in catalog, declare the models explicitly in the list first, then
  configure capabilities.
- Capability fields are written to the user layer settings; the `modelOverrides` form is not handled for now.

## Installation (standalone plugin, not part of the dsh-web-ui-all aggregate)

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
settings — the "Image & Reasoning" control block appears inline on that model row.

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
- `src/client/controller.ts` — providers/models join, write-back, sticky restore.
- `src/client/enhance.ts` — MutationObserver structural detection + injection coordination.
- `src/client/controls.ts` — injected block DOM construction / events / sync.
- `src/client/core.ts` — image / reasoning-level pure logic (unit-testable).
- `src/client/locales.ts` — Chinese & English copy.
- `src/client/enhance.module.css` — injected block styles (follows the shell design tokens).
- `cordis.patch.yml` — bundle patch plugin line (id `ui-model-profile`).