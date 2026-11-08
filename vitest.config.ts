import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { pdfCompileTimeDefinitions } from "./scripts/pdf-preview-build-config";

export default defineConfig({
  define: pdfCompileTimeDefinitions(),
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: [
      "tests/unit/**/*.test.ts",
      "tests/components/**/*.test.tsx",
    ],
    environmentOptions: {
      jsdom: {
        pretendToBeVisual: true,
      },
    },
    clearMocks: true,
    restoreMocks: true,
  },
});
