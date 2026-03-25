import type {
  Skia,
  SkCanvas,
  SkImage,
  SkColorFilter,
  SkSurface,
  SkPaint,
  SkShader,
  SkImageFilter,
  SkPathEffect,
} from "../../skia/types";
import {
  BlendMode,
  PaintStyle,
  StrokeCap,
  StrokeJoin,
} from "../../skia/types";
import { getSkiaRenderBackend } from "../../skia/web/renderBackend";

export type ActiveRenderTarget = {
  surface: SkSurface;
  width: number;
  height: number;
  pixelRatio: number;
  debugLabel?: string;
};

type DrawingContextOptions = {
  renderTarget?: ActiveRenderTarget | null;
  retainResources?: boolean;
};

type BackdropExecution = {
  mode: "explicit" | "legacy";
  paint?: SkPaint | null;
};

const IDENTITY_MATRIX = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const MATRIX_EPSILON = 1e-6;

const isCanvasMatrixIdentity = (canvas: SkCanvas) => {
  const matrix = canvas.getTotalMatrix();
  try {
    const values = matrix.get();
    return values.every((value, index) => {
      return Math.abs(value - IDENTITY_MATRIX[index]) <= MATRIX_EPSILON;
    });
  } finally {
    matrix.dispose?.();
  }
};

const resolveImageSize = (
  image: unknown,
  fallbackWidth: number,
  fallbackHeight: number
) => {
  const target = image as {
    width?: number | (() => number);
    height?: number | (() => number);
  };
  const rawWidth =
    typeof target.width === "function" ? target.width() : target.width;
  const rawHeight =
    typeof target.height === "function" ? target.height() : target.height;
  return {
    width:
      typeof rawWidth === "number" && Number.isFinite(rawWidth) && rawWidth > 0
        ? rawWidth
        : fallbackWidth,
    height:
      typeof rawHeight === "number" && Number.isFinite(rawHeight) && rawHeight > 0
        ? rawHeight
        : fallbackHeight,
  };
};

export type SurfaceSnapshotSource = "asImageCopy" | "makeImageSnapshot";

export type SurfaceSnapshotImage = {
  image: SkImage;
  source: SurfaceSnapshotSource;
  requiresSurfaceRetention: boolean;
};

export const makeSurfaceSnapshotImage = (
  surface: SkSurface
): SurfaceSnapshotImage => {
  const asImageCopy = surface.asImageCopy?.();
  if (asImageCopy) {
    return {
      image: asImageCopy,
      source: "asImageCopy",
      requiresSurfaceRetention: false,
    };
  }
  return {
    image: surface.makeImageSnapshot(),
    source: "makeImageSnapshot",
    requiresSurfaceRetention: true,
  };
};

export const createDrawingContext = (
  Skia: Skia,
  paintPool: SkPaint[],
  canvas: SkCanvas,
  options?: DrawingContextOptions
) => {
  "worklet";

  // State (formerly class fields)
  const paints: SkPaint[] = [];
  const colorFilters: SkColorFilter[] = [];
  const shaders: SkShader[] = [];
  const imageFilters: SkImageFilter[] = [];
  const pathEffects: SkPathEffect[] = [];
  const paintDeclarations: SkPaint[] = [];
  const opacities: number[] = [];
  const backdropExecutions: BackdropExecution[] = [];
  const retainedResources: Array<() => void> = [];
  const renderTarget = options?.renderTarget ?? null;
  const retainResources = options?.retainResources ?? false;
  const renderBackend = getSkiaRenderBackend();

  let nextPaintIndex = 1;

  // Initialize first paint and opacity
  if (!paintPool[0]) {
    paintPool[0] = Skia.Paint();
  }
  const rootPaint = paintPool[0];
  rootPaint.setShader(null);
  rootPaint.setColorFilter(null);
  rootPaint.setImageFilter(null);
  rootPaint.setMaskFilter(null);
  rootPaint.setPathEffect(null);
  rootPaint.setBlendMode(BlendMode.SrcOver);
  rootPaint.setStyle(PaintStyle.Fill);
  rootPaint.setStrokeWidth(0);
  rootPaint.setStrokeMiter(4);
  rootPaint.setStrokeCap(StrokeCap.Butt);
  rootPaint.setStrokeJoin(StrokeJoin.Miter);
  rootPaint.setAlphaf(1);
  rootPaint.setDither(false);
  rootPaint.setAntiAlias(true);
  paints.push(rootPaint);
  opacities.push(1);

  // Methods (formerly class methods)
  const savePaint = () => {
    // Get next available paint from pool or create new one if needed
    if (nextPaintIndex >= paintPool.length) {
      paintPool.push(Skia.Paint());
    }

    const nextPaint = paintPool[nextPaintIndex];
    nextPaint.assign(getCurrentPaint()); // Reuse allocation by copying properties
    paints.push(nextPaint);
    opacities.push(opacities[opacities.length - 1]);
    nextPaintIndex++;
  };

  const getOpacity = () => {
    return opacities[opacities.length - 1];
  };

  const setOpacity = (newOpacity: number) => {
    opacities[opacities.length - 1] = Math.max(0, Math.min(1, newOpacity));
  };

  const resolveBackdropFilter = () => {
    let imageFilter: SkImageFilter | null = null;
    const imgf = imageFilters.pop();
    if (imgf) {
      imageFilter = imgf;
    } else {
      const cf = colorFilters.pop();
      if (cf) {
        imageFilter = Skia.ImageFilter.MakeColorFilter(cf, null);
      }
    }
    return imageFilter;
  };

  const retainResource = (cleanup: () => void) => {
    retainedResources.push(cleanup);
  };

  const takeRetainedResources = () => {
    const resources = [...retainedResources];
    retainedResources.length = 0;
    return resources;
  };

  const createBackdropPaint = () => {
    const paint = getCurrentPaint().copy();
    paint.setAlphaf(paint.getAlphaf() * getOpacity());
    return paint;
  };

  const saveBackdropFilter = () => {
    const imageFilter = resolveBackdropFilter();
    if (
      renderTarget &&
      renderBackend.kind === "webgpu" &&
      imageFilter &&
      isCanvasMatrixIdentity(canvas)
    ) {
      const scratchSurface = Skia.Surface.MakeOffscreen(
        renderTarget.width,
        renderTarget.height,
        renderTarget.pixelRatio
      );
      if (scratchSurface) {
        const sourceImage = renderTarget.surface.makeImageSnapshot();
        const filteredPaint = Skia.Paint();
        const backdropPaint = createBackdropPaint();
        let retainedFilteredImage = false;
        let retainScratchSurface = false;
        try {
          const scratchCanvas = scratchSurface.getCanvas();
          filteredPaint.setImageFilter(imageFilter);
          scratchCanvas.clear(Skia.Color("transparent"));
          const sourceImageSize = resolveImageSize(
            sourceImage,
            renderTarget.width,
            renderTarget.height
          );
          scratchCanvas.drawImageRect(
            sourceImage,
            {
              x: 0,
              y: 0,
              width: sourceImageSize.width,
              height: sourceImageSize.height,
            },
            {
              x: 0,
              y: 0,
              width: renderTarget.width,
              height: renderTarget.height,
            },
            filteredPaint,
            true
          );
          scratchSurface.flush();
          const filteredSnapshot = makeSurfaceSnapshotImage(scratchSurface);
          const filteredImage = filteredSnapshot.image;
          retainScratchSurface =
            retainResources && filteredSnapshot.requiresSurfaceRetention;
          try {
            const filteredImageSize = resolveImageSize(
              filteredImage,
              renderTarget.width,
              renderTarget.height
            );
            canvas.drawImageRect(
              filteredImage,
              {
                x: 0,
                y: 0,
                width: filteredImageSize.width,
                height: filteredImageSize.height,
              },
              {
                x: 0,
                y: 0,
                width: renderTarget.width,
                height: renderTarget.height,
              },
              backdropPaint,
              true
            );
            if (retainResources) {
              retainedFilteredImage = true;
              retainResource(() => {
                filteredImage.dispose?.();
                if (retainScratchSurface) {
                  scratchSurface.dispose?.();
                }
              });
            }
            backdropExecutions.push({ mode: "explicit" });
            return;
          } finally {
            if (!retainedFilteredImage) {
              filteredImage.dispose?.();
            }
          }
        } finally {
          backdropPaint.dispose?.();
          filteredPaint.dispose?.();
          sourceImage.dispose?.();
          if (!retainedFilteredImage || !retainScratchSurface) {
            scratchSurface.dispose?.();
          }
        }
      }
    }
    const backdropPaint = createBackdropPaint();
    backdropExecutions.push({ mode: "legacy", paint: backdropPaint });
    canvas.saveLayer(backdropPaint, null, imageFilter);
  };

  const restoreBackdropFilter = () => {
    const execution = backdropExecutions.pop();
    if (execution?.mode === "explicit") {
      return;
    }
    canvas.restore();
    execution?.paint?.dispose?.();
  };

  // Equivalent to the `get paint()` getter in the original class
  const getCurrentPaint = () => {
    return paints[paints.length - 1];
  };

  const restorePaint = () => {
    opacities.pop();
    return paints.pop();
  };

  const materializePaint = () => {
    // Color Filters
    if (colorFilters.length > 0) {
      getCurrentPaint().setColorFilter(
        colorFilters.reduceRight((inner, outer) =>
          inner ? Skia.ColorFilter.MakeCompose(outer, inner) : outer
        )
      );
    }
    // Shaders
    if (shaders.length > 0) {
      getCurrentPaint().setShader(shaders[shaders.length - 1]);
    }
    // Image Filters
    if (imageFilters.length > 0) {
      getCurrentPaint().setImageFilter(
        imageFilters.reduceRight((inner, outer) =>
          inner ? Skia.ImageFilter.MakeCompose(outer, inner) : outer
        )
      );
    }

    // Path Effects
    if (pathEffects.length > 0) {
      getCurrentPaint().setPathEffect(
        pathEffects.reduceRight((inner, outer) =>
          inner ? Skia.PathEffect.MakeCompose(outer, inner) : outer
        )
      );
    }

    // Clear arrays
    colorFilters.length = 0;
    shaders.length = 0;
    imageFilters.length = 0;
    pathEffects.length = 0;
  };

  // Return an object containing the Skia reference, the canvas, and the methods
  return {
    // Public fields
    Skia,
    canvas,
    paints,
    colorFilters,
    shaders,
    imageFilters,
    pathEffects,
    paintDeclarations,
    paintPool,
    renderTarget,
    retainResources,

    // Public methods
    savePaint,
    saveBackdropFilter,
    restoreBackdropFilter,
    get paint() {
      return paints[paints.length - 1];
    }, // the "getter" for the current paint
    restorePaint,
    materializePaint,
    getOpacity,
    setOpacity,
    retainResource,
    takeRetainedResources,
  };
};

export type DrawingContext = ReturnType<typeof createDrawingContext>;
