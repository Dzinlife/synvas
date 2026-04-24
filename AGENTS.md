# AGENTS.md

## Working agreements

- Prefer `pnpm` when installing dependencies.
- Keep it simple - don't add unnecessary entities.
- Refactor frequently to maintain simplicity.
- Write comments in Chinese.
- Use English for all git commit messages.
- Prefer using `const getValue = useEffectEvent(() => value)` over manually assigning values to `useRef` for cleaner code, but do not use `useEffectEvent` in the element-system renderer running in the Skia tree custom reconciler, as this reconciler does not support it yet.
- Do not add tests for visual styles unless they are related to the layout engine
