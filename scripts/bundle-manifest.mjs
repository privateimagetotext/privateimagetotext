// Keep route preloads, offline allowlists and size budgets on the same graph.
export function staticRouteFiles(manifest, key) {
  const files = new Set();
  const visited = new Set();
  const visit = key => {
    if (visited.has(key)) return;
    visited.add(key);
    const entry = manifest[key];
    if (!entry) throw new Error(`Missing Vite manifest entry: ${key}`);
    files.add(entry.file);
    for (const file of entry.css ?? []) files.add(file);
    for (const imported of entry.imports ?? []) visit(imported);
  };
  visit(key);
  return [...files];
}

export function buildAssetAllowlist(manifest) {
  const files = new Set();
  for (const entry of Object.values(manifest)) {
    for (const file of [entry.file, ...entry.css ?? [], ...entry.assets ?? []]) {
      if (!/^assets\/[A-Za-z0-9_.-]+$/.test(file) || file.endsWith(".map")) {
        throw new Error(`Unsafe built asset path: ${file}`);
      }
      files.add(`/${file}`);
    }
    for (const dependency of [...entry.imports ?? [], ...entry.dynamicImports ?? [], ...entry.workers ?? []]) {
      if (!manifest[dependency]) throw new Error(`Missing Vite dependency: ${dependency}`);
    }
  }
  return [...files].sort();
}
