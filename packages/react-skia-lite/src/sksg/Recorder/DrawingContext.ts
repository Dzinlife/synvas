import type {
  Skia,
  SkCanvas,
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

export const makeSurfaceSnapshotImage = (surface: SkSurface) => {
  return surface.makeImageSnapshot();
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
        renderTarget.height
      );
      if (scratchSurface) {
        const sourceImage = renderTarget.surface.makeImageSnapshot();
        const filteredPaint = Skia.Paint();
        const backdropPaint = createBackdropPaint();
        let retainedFilteredImage = false;
        try {
          const scratchCanvas = scratchSurface.getCanvas();
          filteredPaint.setImageFilter(imageFilter);
          scratchCanvas.clear(Skia.Color("transparent"));
          scratchCanvas.drawImage(sourceImage, 0, 0, filteredPaint);
          scratchSurface.flush();
          const filteredImage = makeSurfaceSnapshotImage(scratchSurface);
          try {
            canvas.drawImage(filteredImage, 0, 0, backdropPaint);
            if (retainResources) {
              retainedFilteredImage = true;
              retainResource(() => {
                filteredImage.dispose?.();
                scratchSurface.dispose?.();
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
          if (!retainedFilteredImage) {
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
