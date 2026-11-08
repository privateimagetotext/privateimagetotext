import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { productConfig } from "../../src/config/product";
import { routes, SITE_ORIGIN } from "../../src/config/routes";

const root = path.resolve(__dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

function relativeLinks(markdown: string): string[] {
  const targets = [...markdown.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]);
  return targets
    .filter((target) => !/^(https?:|mailto:|#)/.test(target))
    .map((target) => target.split("#")[0]);
}

describe("public repository documents", () => {
  it("sends security reports to the configured public contact", () => {
    expect(read("SECURITY.md")).toContain(productConfig.securityContact);
  });

  it.each(["README.md", "SECURITY.md", "CONTRIBUTING.md"])(
    "%s links only to files that exist",
    (file) => {
      const missing = relativeLinks(read(file)).filter(
        (target) => !existsSync(path.join(root, target)),
      );
      expect(missing).toEqual([]);
    },
  );

  it("lists every tool route in the contributing privacy invariants", () => {
    const contributing = read("CONTRIBUTING.md");
    for (const toolPath of [routes.tool, routes.hideMessage, routes.mediaInspector, "/pdf-to-text"]) {
      expect(contributing).toContain(`\`${toolPath}\``);
    }
  });

  it("links the README tool table to the production origin", () => {
    const readme = read("README.md");
    for (const toolPath of ["/hide-message", "/media-inspector", "/pdf-to-text", "/verify"]) {
      expect(readme).toContain(`${SITE_ORIGIN}${toolPath}`);
    }
  });

  it("states one code licence consistently: AGPL-3.0-only", () => {
    const licence = read("LICENSE");
    expect(licence).toMatch(/^\s*GNU AFFERO GENERAL PUBLIC LICENSE\s+Version 3, 19 November 2007/);
    expect(licence).toContain("END OF TERMS AND CONDITIONS");
    expect(JSON.parse(read("package.json")).license).toBe("AGPL-3.0-only");
    expect(read("README.md")).toContain("(`AGPL-3.0-only`)");
    expect(read("CONTRIBUTING.md")).toContain("[GNU AGPL-3.0-only](LICENSE)");
    const combined = ["README.md", "CONTRIBUTING.md"].map(read).join("\n");
    expect(combined).not.toMatch(/Licen[cs]e: not yet chosen|does not have a licence yet/);
  });
});

const contentPaths = ["src/config/guide-content/", "src/config/pdf-guide.ts", "public/guides/"];

function sourceFiles(directory: string): string[] {
  return readdirSync(path.join(root, directory)).flatMap((name) => {
    const relative = `${directory}/${name}`;
    return statSync(path.join(root, relative)).isDirectory() ? sourceFiles(relative) : [relative];
  });
}

describe("guide content licence", () => {
  it("LICENSE-CONTENT and the README list the same existing guide paths", () => {
    const licence = read("LICENSE-CONTENT");
    const readme = read("README.md");
    for (const contentPath of contentPaths) {
      expect(existsSync(path.join(root, contentPath))).toBe(true);
      expect(licence).toContain(contentPath);
      expect(readme).toContain(`\`${contentPath}\``);
    }
    expect(readme).toContain("[LICENSE-CONTENT](LICENSE-CONTENT)");
  });

  it("keeps every guide definition inside a path covered by LICENSE-CONTENT", () => {
    // Guide metadata (meta.ts) and guide bodies (satisfies GuideContent).
    const guideDefinitions = sourceFiles("src").filter((file) =>
      /primaryActionLabel:\s*["'`]|satisfies GuideContent\b/.test(read(file)),
    );
    expect(guideDefinitions.filter((file) => /satisfies GuideContent\b/.test(read(file))).length).toBeGreaterThan(1);
    expect(guideDefinitions.length).toBeGreaterThan(0);
    const uncovered = guideDefinitions.filter(
      (file) => !contentPaths.some((contentPath) => file === contentPath || file.startsWith(contentPath)),
    );
    expect(uncovered).toEqual([]);
  });
});
