import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  setCropEdge,
  type CropEdge,
} from "../features/image-editor/image";
import { cropPointFromClient } from "../features/image-editor/crop-coordinates";
import { fullCrop, type CropRect } from "../features/ocr/types";

type HandleName = "top-left" | "top-right" | "bottom-left" | "bottom-right";

type Props = {
  imageUrl: string;
  initialCrop: CropRect;
  onApply: (crop: CropRect) => void;
  onCancel: () => void;
  returnFocus: HTMLElement | null;
};

const focusableSelector =
  'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

function displayPercent(value: number) {
  return Math.round(value * 100);
}

function svgCoordinate(value: number) {
  return value * 100;
}

function updateByHandle(
  crop: CropRect,
  handle: HandleName,
  x: number,
  y: number,
) {
  let next = crop;
  if (handle.includes("left")) next = setCropEdge(next, "left", x);
  if (handle.includes("right")) next = setCropEdge(next, "right", x);
  if (handle.includes("top")) next = setCropEdge(next, "top", y);
  if (handle.includes("bottom")) next = setCropEdge(next, "bottom", y);
  return next;
}

export default function CropEditor({
  imageUrl,
  initialCrop,
  onApply,
  onCancel,
  returnFocus,
}: Props) {
  const [crop, setCrop] = useState(initialCrop);
  const [activeHandle, setActiveHandle] = useState<HandleName | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(focusableSelector),
    );
    focusable[0]?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCancel();
      }
      if (event.key !== "Tab" || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    dialog.addEventListener("keydown", handleKeyDown);
    document.body.classList.add("scroll-locked");
    return () => {
      dialog.removeEventListener("keydown", handleKeyDown);
      document.body.classList.remove("scroll-locked");
      returnFocus?.focus();
    };
  }, [onCancel, returnFocus]);

  const pointerPosition = (event: ReactPointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return cropPointFromClient(event.clientX, event.clientY, bounds);
  };

  const moveHandle = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!activeHandle) return;
    const position = pointerPosition(event);
    setCrop((current) =>
      updateByHandle(current, activeHandle, position.x, position.y),
    );
  };

  const handlePoints: Record<HandleName, [number, number]> = {
    "top-left": [svgCoordinate(crop.x), svgCoordinate(crop.y)],
    "top-right": [
      svgCoordinate(crop.x + crop.width),
      svgCoordinate(crop.y),
    ],
    "bottom-left": [
      svgCoordinate(crop.x),
      svgCoordinate(crop.y + crop.height),
    ],
    "bottom-right": [
      svgCoordinate(crop.x + crop.width),
      svgCoordinate(crop.y + crop.height),
    ],
  };
  const cropLeft = svgCoordinate(crop.x);
  const cropTop = svgCoordinate(crop.y);
  const cropRight = svgCoordinate(crop.x + crop.width);
  const cropBottom = svgCoordinate(crop.y + crop.height);

  const controls: Array<{
    edge: CropEdge;
    label: string;
    value: number;
  }> = [
    { edge: "left", label: "Left edge", value: crop.x },
    { edge: "top", label: "Top edge", value: crop.y },
    { edge: "right", label: "Right edge", value: crop.x + crop.width },
    {
      edge: "bottom",
      label: "Bottom edge",
      value: crop.y + crop.height,
    },
  ];

  return (
    <div className="dialog-backdrop" onPointerDown={onCancel}>
      <div
        ref={dialogRef}
        className="crop-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="crop-title"
        aria-describedby="crop-description"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="dialog-heading">
          <div>
            <p className="eyebrow">Non-destructive edit</p>
            <h2 id="crop-title">Choose the text area</h2>
            <p id="crop-description">
              Drag the four handles or adjust each edge with the keyboard.
            </p>
          </div>
          <button className="icon-button" type="button" onClick={onCancel}>
            <span aria-hidden="true">×</span>
            <span className="sr-only">Cancel crop</span>
          </button>
        </div>

        <div className="crop-stage">
          <div className="crop-media-frame" data-testid="crop-media-frame">
            <img src={imageUrl} alt="Image being cropped" />
            <svg
              ref={svgRef}
              className="crop-overlay"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
              onPointerMove={moveHandle}
              onPointerUp={() => setActiveHandle(null)}
              onPointerCancel={() => setActiveHandle(null)}
            >
              <path
                className="crop-shade"
                fillRule="evenodd"
                d={`M0 0H100V100H0Z M${cropLeft} ${cropTop}H${cropRight}V${cropBottom}H${cropLeft}Z`}
              />
              <rect
                className="crop-boundary"
                x={cropLeft}
                y={cropTop}
                width={svgCoordinate(crop.width)}
                height={svgCoordinate(crop.height)}
              />
              {Object.entries(handlePoints).map(([handle, point]) => (
                <circle
                  key={handle}
                  className="crop-handle"
                  data-crop-handle={handle}
                  cx={point[0]}
                  cy={point[1]}
                  r="2.7"
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    svgRef.current?.setPointerCapture(event.pointerId);
                    setActiveHandle(handle as HandleName);
                  }}
                />
              ))}
            </svg>
          </div>
        </div>

        <fieldset className="crop-controls">
          <legend>Crop edges, as a percentage of the image</legend>
          {controls.map((control) => (
            <label key={control.edge}>
              <span>{control.label}</span>
              <span className="mono-value">
                {displayPercent(control.value)}%
              </span>
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={displayPercent(control.value)}
                onChange={(event) => {
                  const value = event.currentTarget.valueAsNumber / 100;
                  setCrop((current) =>
                    setCropEdge(current, control.edge, value),
                  );
                }}
              />
            </label>
          ))}
        </fieldset>

        <div className="dialog-actions">
          <button
            className="button button--quiet"
            type="button"
            onClick={() => setCrop(fullCrop)}
          >
            Reset crop
          </button>
          <span className="dialog-actions__spacer" />
          <button
            className="button button--quiet"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="button button--primary"
            type="button"
            onClick={() => onApply(crop)}
          >
            Apply crop
          </button>
        </div>
      </div>
    </div>
  );
}
