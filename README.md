# ai-nle Monorepo

This is a monorepo using pnpm workspaces and Turborepo.

## Structure

```
ai-nle/
├── packages/
│   ├── core/     # Core Engine
│   ├── web/      # Web entry (TanStack Start)
│   ├── editor/   # Editor UI + shared logic
│   ├── electron/ # Desktop app (Electron) - local Whisper.cpp backend
│   └── react-skia-lite/ # ESM version of react-native-skia for web
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

## Getting Started

### Install dependencies

```bash
pnpm install
```

### Development

Run all packages in development mode (via Turbo):

```bash
pnpm dev
```

Run a specific package:

```bash
pnpm --filter ai-nle-web dev
pnpm --filter ai-nle-electron dev
pnpm --filter react-skia-lite dev
```

### Building

Build all packages:

```bash
pnpm build
```

Build a specific package:

```bash
pnpm --filter ai-nle-web build
pnpm --filter ai-nle-electron build
pnpm --filter react-skia-lite build
```

### Testing

```bash
pnpm test
```

### Linting & Formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting:

```bash
pnpm lint
pnpm format
pnpm check
```

## Packages

### ai-nle-web

Main application built with TanStack Start, React Router, and Tailwind CSS.

### ai-nle-electron

Electron desktop application that runs ASR with a local `whisper.cpp` CLI (better utilizes local hardware).

Required env vars (pick one):

```bash
export AI_NLE_WHISPER_MODEL=/absolute/path/to/ggml-small.bin
# or:
export AI_NLE_WHISPER_MODEL_TINY=/path/to/ggml-tiny.bin
export AI_NLE_WHISPER_MODEL_SMALL=/path/to/ggml-small.bin
export AI_NLE_WHISPER_MODEL_MEDIUM=/path/to/ggml-medium.bin
```

Optional:

```bash
export AI_NLE_WHISPER_CLI=whisper-cli
```

The renderer uses `mediabunny` to export 16kHz mono 16-bit WAV before calling `whisper-cli`.

### ai-nle-editor

Editor UI + shared logic (used by both web and electron).

### react-skia-lite

ESM version of react-native-skia for web. This package is being developed to port react-native-skia to a web-compatible ESM version.

## Learn More

- [TanStack Start](https://tanstack.com/start)
- [TanStack Router](https://tanstack.com/router)
- [Turborepo](https://turbo.build/)
- [pnpm workspaces](https://pnpm.io/workspaces)
