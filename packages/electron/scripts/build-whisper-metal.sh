#!/usr/bin/env bash
# 在 macOS 上从源码构建带 Metal 加速的 whisper-cli。
# 需安装 Xcode 命令行工具与 cmake。在目标架构机器上执行（Intel 或 Apple Silicon 各构建一次）。
set -euo pipefail

WHISPER_CPP_VERSION="${WHISPER_CPP_VERSION:-1.8.3}"
# 输出目录；不设则使用当前目录下的 whisper.cpp/build/bin
OUT_DIR="${OUT_DIR:-}"
REPO_URL="${REPO_URL:-https://github.com/ggerganov/whisper.cpp.git}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORK_DIR="${WORK_DIR:-$(mktemp -d)}"
trap 'if [ -z "${KEEP_WORK_DIR:-}" ]; then rm -rf "$WORK_DIR"; fi' EXIT

echo "[build-whisper-metal] 版本: $WHISPER_CPP_VERSION"
echo "[build-whisper-metal] 工作目录: $WORK_DIR"

if [ ! -d "$WORK_DIR/.git" ]; then
  git clone --depth 1 --branch "v${WHISPER_CPP_VERSION}" "$REPO_URL" "$WORK_DIR"
else
  (cd "$WORK_DIR" && git fetch --depth 1 origin "v${WHISPER_CPP_VERSION}" && git checkout "v${WHISPER_CPP_VERSION}")
fi

cd "$WORK_DIR"
rm -rf build
cmake -B build \
  -DGGML_METAL=ON \
  -DCMAKE_BUILD_TYPE=Release
cmake --build build -j --config Release

CLI_PATH="$WORK_DIR/build/bin/whisper-cli"
if [ ! -f "$CLI_PATH" ]; then
  echo "[build-whisper-metal] 错误: 未找到 $CLI_PATH" >&2
  exit 1
fi

ARCH=$(uname -m)
case "$ARCH" in
  arm64)  FNAME="whisper-cli-darwin-arm64" ;;
  x86_64) FNAME="whisper-cli-darwin-x64" ;;
  *)      FNAME="whisper-cli-darwin-$ARCH" ;;
esac

if [ -n "$OUT_DIR" ]; then
  mkdir -p "$OUT_DIR"
  cp "$CLI_PATH" "$OUT_DIR/$FNAME"
  chmod +x "$OUT_DIR/$FNAME"
  echo "[build-whisper-metal] 已复制到: $OUT_DIR/$FNAME"
else
  echo "[build-whisper-metal] 构建完成: $CLI_PATH"
  echo "[build-whisper-metal] 建议命名为: $FNAME 并上传到二进制地址列表"
fi
