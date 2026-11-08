import type { Plugin } from "vite";

/** Vite's main manifest omits worker chunks. Record the worker build graph too. */
export function workerManifest(): Plugin {
  return {
    name: "localtext-worker-manifest",
    generateBundle(_options, bundle) {
      const entries = Object.values(bundle).filter(item => item.type === "chunk" && item.isEntry);
      if (entries.length !== 1) throw new Error("Expected one worker entry per build");
      const manifest = Object.fromEntries(Object.values(bundle)
        .filter(item => !item.fileName.endsWith(".map"))
        .map(item => [item.fileName, item.type === "chunk" ? {
          file: item.fileName,
          isWorkerEntry: item.isEntry,
          imports: item.imports,
          dynamicImports: item.dynamicImports,
        } : { file: item.fileName }]));
      this.emitFile({
        type: "asset",
        fileName: `.vite/worker-${entries[0].name}.json`,
        source: JSON.stringify(manifest, null, 2),
      });
    },
  };
}
