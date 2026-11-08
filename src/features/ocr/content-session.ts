import { suggestContentDefaults } from "./content-defaults";
import type { EnhancementPreset, OcrContentMode, OcrState } from "./types";

// One loaded app/tab lifetime, including route navigation and Clear. Only manual
// choices belong here; never files, pixel statistics, or automatically suggested values.
export const ocrSessionOverrides: { contentMode?: OcrContentMode; preset?: EnhancementPreset } = {};

export function resolveContentDefaults(state: OcrState, preview: HTMLCanvasElement): OcrState {
  if (state.defaultsApplied) return state;
  const suggestion = suggestContentDefaults(preview, state.image?.intakeSource === "clipboard");
  const contentMode = ocrSessionOverrides.contentMode ?? suggestion.contentMode;
  const preset = ocrSessionOverrides.preset ?? suggestion.preset;
  return {
    ...state, defaultsApplied: true, contentMode,
    suggestedContentMode: ocrSessionOverrides.contentMode ? null : contentMode,
    transform: preset === state.transform.preset ? state.transform : { ...state.transform, preset },
  };
}
