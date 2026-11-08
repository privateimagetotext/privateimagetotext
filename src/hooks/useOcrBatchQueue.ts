import { useCallback, useEffect, useRef, useState } from "react";
import type { OcrBatchItem } from "../features/ocr/batch";
import type { OcrState } from "../features/ocr/types";

/** Only File references and text snapshots are retained; inactive items own no canvases or URLs. */
export function useOcrBatchQueue(current: OcrState) {
  const [items, setItems] = useState<OcrBatchItem[]>([]);
  const itemsRef = useRef<OcrBatchItem[]>([]);
  const activeIdRef = useRef<number | null>(null);
  const currentRef = useRef(current);
  const nextId = useRef(0);
  currentRef.current = current;
  const getCurrentState = useCallback(() => currentRef.current, []);

  const write = useCallback((next: OcrBatchItem[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);
  const capture = useCallback(() => {
    const state = currentRef.current;
    const activeId = activeIdRef.current;
    if (activeId === null) return itemsRef.current;
    const next = itemsRef.current.map((item) => item.id === activeId
      ? { ...item, name: state.image?.name ?? item.name, size: state.image?.size ?? item.size,
          state: { ...state, image: state.image ? { ...state.image, objectUrl: "" } : null } }
      : item);
    write(next);
    return next;
  }, [write]);
  useEffect(() => { capture(); }, [current, capture]);

  const makeItem = useCallback((name: string, size: number, state: OcrState): OcrBatchItem => ({
    id: ++nextId.current, name, size,
    state: { ...state, image: state.image ? { ...state.image, objectUrl: "" } : null },
  }), []);
  const clear = useCallback(() => {
    activeIdRef.current = null;
    write([]);
  }, [write]);
  return { items, itemsRef, activeIdRef, write, capture, getCurrentState, makeItem, clear };
}
