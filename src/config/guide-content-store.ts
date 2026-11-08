import type { GuideContent } from "./guides";

// The shell renders structured data for every route, but guide bodies load
// with the guide route. `guide-library.ts` registers them here when imported;
// subscribers (StructuredData) re-render once they arrive.
let contents: ReadonlyMap<string, GuideContent> = new Map();
const listeners = new Set<() => void>();

export function registerGuideContents(next: ReadonlyMap<string, GuideContent>) {
  if (next === contents) return;
  contents = next;
  for (const listener of listeners) listener();
}

export function guideContentsSnapshot(): ReadonlyMap<string, GuideContent> {
  return contents;
}

export function subscribeGuideContents(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
