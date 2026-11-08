type CropBounds = Pick<
  DOMRectReadOnly,
  "left" | "top" | "width" | "height"
>;

function relativeCoordinate(
  pointerCoordinate: number,
  boundsStart: number,
  boundsSize: number,
) {
  if (boundsSize <= 0 || Number.isNaN(boundsSize)) return 0;
  const value = (pointerCoordinate - boundsStart) / boundsSize;
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function cropPointFromClient(
  clientX: number,
  clientY: number,
  bounds: CropBounds,
) {
  return {
    x: relativeCoordinate(clientX, bounds.left, bounds.width),
    y: relativeCoordinate(clientY, bounds.top, bounds.height),
  };
}
