/**
 * Host loader entry for the dsh-model-profile plugin — runs in the DSH host
 * process. The plugin is browser-only: it renders a model-capability settings
 * card in the Web GUI and writes through the existing settings wire
 * (`settings.mutate` against the `llm-pi-ai` namespace), so there is no
 * host-side behavior to mount.
 */
export function apply(): void {}
