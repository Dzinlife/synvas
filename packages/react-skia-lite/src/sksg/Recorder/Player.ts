import { processColor } from "../../dom/nodes";
import type { DrawingNodeProps } from "../../dom/types";
import type { SkSurface } from "../../skia/types";

import {
  drawCircle,
  drawImage,
  drawOval,
  drawPath,
  drawPoints,
  drawRect,
  drawRRect,
  drawLine,
  drawAtlas,
  drawParagraph,
  drawImageSVG,
  drawPicture,
  drawGlyphs,
  drawTextBlob,
  drawTextPath,
  drawText,
  drawDiffRect,
  drawVertices,
  drawPatch,
  drawSkottie,
} from "./commands/Drawing";
import { drawBox, isBoxCommand } from "./commands/Box";
import {
  composeColorFilters,
  isPushColorFilter,
  pushColorFilter,
} from "./commands/ColorFilters";
import { saveCTM } from "./commands/CTM";
import {
  setBlurMaskFilter,
  isPushImageFilter,
  pushImageFilter,
  composeImageFilters,
} from "./commands/ImageFilters";
import { setPaintProperties } from "./commands/Paint";
import {
  composePathEffects,
  isPushPathEffect,
  pushPathEffect,
} from "./commands/PathEffects";
import { isPushShader, pushShader } from "./commands/Shaders";
import {
  CommandType,
  isCommand,
  isDrawCommand,
  isGroup,
  isRenderTarget,
  materializeCommand,
} from "./Core";
import type {
  Command,
  GroupCommand,
  RenderTargetCommand,
} from "./Core";
import {
  createDrawingContext,
  makeSurfaceSnapshotImage,
  type DrawingContext,
  type SurfaceSnapshotSource,
} from "./DrawingContext";
import { getSkiaRenderBackend } from "../../skia/web/renderBackend";

const renderTargetFallbackWarnings = new Set<string>();
const MAX_RENDER_TARGET_POOL_KEYS = 16;
const MAX_RENDER_TARGET_SURFACES_PER_KEY = 2;
const renderTargetSurfacePool = new Map<string, SkSurface[]>();

const resolveRenderTargetSurfacePoolKey = (
  backendKind: string,
  width: number,
  height: number
) => {
  return `${backendKind}:${width}x${height}`;
};

const disposeSurfaceList = (surfaces: SkSurface[]) => {
  surfaces.forEach((surface) => {
    surface.dispose?.();
  });
};

const evictRenderTargetSurfacePoolEntry = () => {
  const oldestEntry = renderTargetSurfacePool.entries().next().value as
    | [string, SkSurface[]]
    | undefined;
  if (!oldestEntry) {
    return;
  }
  const [key, surfaces] = oldestEntry;
  disposeSurfaceList(surfaces);
  renderTargetSurfacePool.delete(key);
};

const acquireRenderTargetSurface = (
  Skia: DrawingContext["Skia"],
  width: number,
  height: number,
  backendKind: string
) => {
  const key = resolveRenderTargetSurfacePoolKey(backendKind, width, height);
  const pooled = renderTargetSurfacePool.get(key);
  if (pooled && pooled.length > 0) {
    const pooledSurface = pooled.pop();
    if (pooledSurface) {
      if (pooled.length === 0) {
        renderTargetSurfacePool.delete(key);
      }
      return {
        surface: pooledSurface,
        reused: true,
      };
    }
  }
  const created = Skia.Surface.MakeOffscreen(width, height);
  if (!created) {
    return null;
  }
  return {
    surface: created,
    reused: false,
  };
};

const releaseRenderTargetSurface = (
  surface: SkSurface,
  width: number,
  height: number,
  backendKind: string
) => {
  const key = resolveRenderTargetSurfacePoolKey(backendKind, width, height);
  let pooled = renderTargetSurfacePool.get(key);
  if (!pooled) {
    if (renderTargetSurfacePool.size >= MAX_RENDER_TARGET_POOL_KEYS) {
      evictRenderTargetSurfacePoolEntry();
    }
    pooled = [];
    renderTargetSurfacePool.set(key, pooled);
  }
  if (pooled.length >= MAX_RENDER_TARGET_SURFACES_PER_KEY) {
    surface.dispose?.();
    return;
  }
  pooled.push(surface);
};

export const clearRenderTargetSurfacePoolForTest = () => {
  for (const surfaces of renderTargetSurfacePool.values()) {
    disposeSurfaceList(surfaces);
  }
  renderTargetSurfacePool.clear();
};

export type RenderTargetReplayMetrics = {
  commandCount: number;
  renderTargetCount: number;
  offscreenPixelCount: number;
  offscreenAllocCount: number;
  offscreenReuseCount: number;
  offscreenAllocFailureCount: number;
  offscreenFlushCount: number;
  snapshotCount: number;
  snapshotBySource: Record<SurfaceSnapshotSource, number>;
  compositeDrawImageCount: number;
  durationMs: number;
};

type RenderTargetReplayMetricsListener = (
  metrics: RenderTargetReplayMetrics
) => void;

const createReplayMetrics = (): RenderTargetReplayMetrics => ({
  commandCount: 0,
  renderTargetCount: 0,
  offscreenPixelCount: 0,
  offscreenAllocCount: 0,
  offscreenReuseCount: 0,
  offscreenAllocFailureCount: 0,
  offscreenFlushCount: 0,
  snapshotCount: 0,
  snapshotBySource: {
    asImageCopy: 0,
    makeImageSnapshot: 0,
  },
  compositeDrawImageCount: 0,
  durationMs: 0,
});

const resolveNow = () => {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
};

let replayMetricsListener: RenderTargetReplayMetricsListener | null = null;
let activeReplayMetrics: RenderTargetReplayMetrics | null = null;

export const setRenderTargetReplayMetricsListener = (
  listener: RenderTargetReplayMetricsListener | null
) => {
  replayMetricsListener = listener;
};

const warnRenderTargetFallback = (debugLabel?: string) => {
  const warningKey = debugLabel?.trim() || "__default__";
  if (renderTargetFallbackWarnings.has(warningKey)) {
    return;
  }
  renderTargetFallbackWarnings.add(warningKey);
  console.warn(
    `[react-skia-lite] RenderTarget ${
      debugLabel ? `"${debugLabel}" ` : ""
    }failed to allocate offscreen surface, fallback to direct replay`
  );
};

const disposePaintPool = (paintPool: DrawingContext["paintPool"]) => {
  paintPool.forEach((paint) => {
    paint.dispose?.();
  });
};

type PendingGroup = {
  command: GroupCommand;
  zIndex: number;
  order: number;
};

const getZIndex = (command: GroupCommand) => {
  "worklet";
  const materialized = materializeCommand(command);
  const { zIndex } = (materialized.props ?? {}) as DrawingNodeProps;
  if (typeof zIndex !== "number" || Number.isNaN(zIndex)) {
    return 0;
  }
  return zIndex;
};

const flushPendingGroups = (
  ctx: DrawingContext,
  pendingGroups: PendingGroup[],
  playFn: (ctx: DrawingContext, cmd: Command) => void
) => {
  "worklet";
  if (pendingGroups.length === 0) {
    return;
  }
  pendingGroups
    .sort((a, b) =>
      a.zIndex === b.zIndex ? a.order - b.order : a.zIndex - b.zIndex
    )
    .forEach(({ command }) => {
      playFn(ctx, command);
    });
  pendingGroups.length = 0;
};

const playGroup = (
  ctx: DrawingContext,
  group: GroupCommand,
  playFn: (ctx: DrawingContext, cmd: Command) => void
) => {
  "worklet";
  const pending: PendingGroup[] = [];
  group.children.forEach((child) => {
    if (isGroup(child)) {
      pending.push({
        command: child,
        zIndex: getZIndex(child),
        order: pending.length,
      });
      return;
    }
    flushPendingGroups(ctx, pending, playFn);
    playFn(ctx, child);
  });
  flushPendingGroups(ctx, pending, playFn);
};

const hasBackdropFilterInCommands = (commands: Command[]): boolean => {
  for (const command of commands) {
    if (isCommand(command, CommandType.SaveBackdropFilter)) {
      return true;
    }
    if (isGroup(command) && hasBackdropFilterInCommands(command.children)) {
      return true;
    }
    if (isRenderTarget(command) && hasBackdropFilterInCommands(command.children)) {
      return true;
    }
  }
  return false;
};

const playRenderTarget = (
  ctx: DrawingContext,
  command: RenderTargetCommand,
  playFn: (ctx: DrawingContext, cmd: Command) => void
) => {
  const metrics = activeReplayMetrics;
  const renderBackend = getSkiaRenderBackend();
  const width = Math.max(1, Math.ceil(command.props.width));
  const height = Math.max(1, Math.ceil(command.props.height));
  if (metrics) {
    metrics.renderTargetCount += 1;
    metrics.offscreenPixelCount += width * height;
  }

  const acquiredSurface = acquireRenderTargetSurface(
    ctx.Skia,
    width,
    height,
    renderBackend.kind
  );
  if (!acquiredSurface) {
    if (metrics) {
      metrics.offscreenAllocFailureCount += 1;
    }
    const hasBackdropFilterCommand = hasBackdropFilterInCommands(command.children);
    if (renderBackend.kind === "webgpu" && hasBackdropFilterCommand) {
      throw new Error(
        `[react-skia-lite] RenderTarget ${
          command.props.debugLabel ? `"${command.props.debugLabel}" ` : ""
        }failed to allocate offscreen surface on webgpu`
      );
    }
    warnRenderTargetFallback(command.props.debugLabel);
    command.children.forEach((child) => {
      playFn(ctx, child);
    });
    return;
  }
  const { surface, reused } = acquiredSurface;
  if (reused) {
    if (metrics) {
      metrics.offscreenReuseCount += 1;
    }
  } else {
    if (metrics) {
      metrics.offscreenAllocCount += 1;
    }
  }

  const childPaintPool: DrawingContext["paintPool"] = [];
  const childCanvas = surface.getCanvas();
  childCanvas.clear(processColor(ctx.Skia, command.props.clearColor ?? "transparent"));
  const childCtx = createDrawingContext(ctx.Skia, childPaintPool, childCanvas, {
    renderTarget: {
      surface,
      width,
      height,
      debugLabel: command.props.debugLabel,
    },
    retainResources: ctx.retainResources,
  });

  let retainedSnapshotImage = false;
  let retainedSurfaceInCleanup = false;
  try {
    command.children.forEach((child) => {
      playFn(childCtx, child);
    });
    surface.flush();
    if (metrics) {
      metrics.offscreenFlushCount += 1;
    }
    const snapshot = makeSurfaceSnapshotImage(surface);
    if (metrics) {
      metrics.snapshotCount += 1;
      metrics.snapshotBySource[snapshot.source] += 1;
    }
    const image = snapshot.image;
    const retainSurfaceForSnapshot =
      ctx.retainResources && snapshot.requiresSurfaceRetention;
    try {
      ctx.canvas.drawImage(image, 0, 0, ctx.paint);
      if (metrics) {
        metrics.compositeDrawImageCount += 1;
      }
      if (ctx.retainResources) {
        retainedSnapshotImage = true;
        retainedSurfaceInCleanup = retainSurfaceForSnapshot;
        ctx.retainResource(() => {
          image.dispose?.();
          if (retainSurfaceForSnapshot) {
            releaseRenderTargetSurface(surface, width, height, renderBackend.kind);
          }
        });
      }
    } finally {
      if (!retainedSnapshotImage) {
        image.dispose?.();
      }
    }
  } finally {
    disposePaintPool(childPaintPool);
    childCtx.takeRetainedResources().forEach((cleanup) => {
      ctx.retainResource(cleanup);
    });
    if (!retainedSurfaceInCleanup) {
      releaseRenderTargetSurface(surface, width, height, renderBackend.kind);
    }
  }
};

const play = (ctx: DrawingContext, _command: Command) => {
  if (isGroup(_command)) {
    playGroup(ctx, _command, play);
    return;
  }
  const command = materializeCommand(_command);
  if (isCommand(command, CommandType.SaveBackdropFilter)) {
    ctx.saveBackdropFilter();
  } else if (isCommand(command, CommandType.RestoreBackdropFilter)) {
    ctx.restoreBackdropFilter();
  } else if (isCommand(command, CommandType.SaveLayer)) {
    ctx.materializePaint();
    const paint = ctx.paintDeclarations.pop();
    ctx.canvas.saveLayer(paint);
  } else if (isDrawCommand(command, CommandType.SavePaint)) {
    if (command.props.paint) {
      // 自定义 paint 也必须走 savePaint，确保 opacity/paint 栈成对维护
      ctx.savePaint();
      ctx.paint.assign(command.props.paint);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { standalone } = command as any;
      ctx.savePaint();
      if (standalone) {
        const freshPaint = ctx.Skia.Paint();
        try {
          ctx.paint.assign(freshPaint);
        } finally {
          freshPaint.dispose();
        }
      }
      setPaintProperties(ctx.Skia, ctx, command.props, standalone);
    }
  } else if (isCommand(command, CommandType.RestorePaint)) {
    ctx.restorePaint();
  } else if (isCommand(command, CommandType.ComposeColorFilter)) {
    composeColorFilters(ctx);
  } else if (isCommand(command, CommandType.RestorePaintDeclaration)) {
    ctx.materializePaint();
    const paint = ctx.restorePaint();
    if (!paint) {
      throw new Error("No paint declaration to push");
    }
    ctx.paintDeclarations.push(paint);
  } else if (isCommand(command, CommandType.MaterializePaint)) {
    ctx.materializePaint();
  } else if (isPushColorFilter(command)) {
    pushColorFilter(ctx, command);
  } else if (isPushShader(command)) {
    pushShader(ctx, command);
  } else if (isPushImageFilter(command)) {
    pushImageFilter(ctx, command);
  } else if (isPushPathEffect(command)) {
    pushPathEffect(ctx, command);
  } else if (isCommand(command, CommandType.ComposePathEffect)) {
    composePathEffects(ctx);
  } else if (isCommand(command, CommandType.ComposeImageFilter)) {
    composeImageFilters(ctx);
  } else if (isDrawCommand(command, CommandType.PushBlurMaskFilter)) {
    setBlurMaskFilter(ctx, command.props);
  } else if (isDrawCommand(command, CommandType.SaveCTM)) {
    saveCTM(ctx, command.props);
  } else if (isCommand(command, CommandType.RestoreCTM)) {
    ctx.canvas.restore();
  } else {
    // TODO: is a copy needed here?
    // apply opacity to the current paint.
    const paint = ctx.paint.copy();
    paint.setAlphaf(paint.getAlphaf() * ctx.getOpacity());
    const paints = [paint, ...ctx.paintDeclarations];
    ctx.paintDeclarations = [];
    try {
      paints.forEach((p) => {
        ctx.paints.push(p);
        if (isRenderTarget(command)) {
          playRenderTarget(ctx, command, play);
        } else if (isBoxCommand(command)) {
          drawBox(ctx, command);
        } else if (isCommand(command, CommandType.DrawPaint)) {
          ctx.canvas.drawPaint(ctx.paint);
        } else if (isDrawCommand(command, CommandType.DrawImage)) {
          drawImage(ctx, command.props);
        } else if (isDrawCommand(command, CommandType.DrawCircle)) {
          drawCircle(ctx, command.props);
        } else if (isDrawCommand(command, CommandType.DrawPoints)) {
          drawPoints(ctx, command.props);
        } else if (isDrawCommand(command, CommandType.DrawPath)) {
          drawPath(ctx, command.props);
        } else if (isDrawCommand(command, CommandType.DrawRect)) {
          drawRect(ctx, command.props);
        } else if (isDrawCommand(command, CommandType.DrawRRect)) {
          drawRRect(ctx, command.props);
        } else if (isDrawCommand(command, CommandType.DrawOval)) {
          drawOval(ctx, command.props);
        } else if (isDrawCommand(command, CommandType.DrawLine)) {
          drawLine(ctx, command.props);
        } else if (isDrawCommand(command, CommandType.DrawPatch)) {
          drawPatch(ctx, command.props);
        } else if (isDrawCommand(command, CommandType.DrawVertices)) {
          drawVertices(ctx, command.props);
        } else if (isDrawCommand(command, CommandType.DrawDiffRect)) {
          drawDiffRect(ctx, command.props);
        } else if (isDrawCommand(command, CommandType.DrawText)) {
          drawText(ctx, command.props);
        } else if (isDrawCommand(command, CommandType.DrawTextPath)) {
          drawTextPath(ctx, command.props);
        } else if (isDrawCommand(command, CommandType.DrawTextBlob)) {
          drawTextBlob(ctx, command.props);
        } else if (isDrawCommand(command, CommandType.DrawGlyphs)) {
          drawGlyphs(ctx, command.props);
        } else if (isDrawCommand(command, CommandType.DrawPicture)) {
          drawPicture(ctx, command.props);
        } else if (isDrawCommand(command, CommandType.DrawImageSVG)) {
          drawImageSVG(ctx, command.props);
        } else if (isDrawCommand(command, CommandType.DrawParagraph)) {
          drawParagraph(ctx, command.props);
        } else if (isDrawCommand(command, CommandType.DrawAtlas)) {
          drawAtlas(ctx, command.props);
        } else if (isDrawCommand(command, CommandType.DrawSkottie)) {
          drawSkottie(ctx, command.props);
        } else {
          console.warn(`Unknown command: ${command.type}`);
        }
        ctx.paints.pop();
      });
    } finally {
      paint.dispose();
    }
  }
};
export function replay(ctx: DrawingContext, commands: Command[]) {
  "worklet";
  //console.log(debugTree(commands));
  const previousMetrics = activeReplayMetrics;
  const ownsMetrics = previousMetrics === null && replayMetricsListener !== null;
  const metrics = ownsMetrics ? createReplayMetrics() : previousMetrics;
  const startedAt = metrics ? resolveNow() : 0;
  if (metrics) {
    metrics.commandCount += commands.length;
  }
  activeReplayMetrics = metrics;
  try {
    commands.forEach((command) => {
      play(ctx, command);
    });
  } finally {
    activeReplayMetrics = previousMetrics;
    if (ownsMetrics && metrics && replayMetricsListener) {
      metrics.durationMs = Math.max(0, resolveNow() - startedAt);
      replayMetricsListener(metrics);
    }
  }
}
