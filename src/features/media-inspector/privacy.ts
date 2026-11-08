import type {
  MetadataEntry,
  PrivacyFinding,
  PrivacyFindingCategory,
  PrivacyFindingSeverity,
} from "./types";

type FindingRule = {
  readonly category: PrivacyFindingCategory;
  readonly severity: PrivacyFindingSeverity;
  readonly title: string;
  readonly detail: string;
  readonly matches: (entry: MetadataEntry, searchable: string) => boolean;
};

const RULES: readonly FindingRule[] = [
  {
    category: "location",
    severity: "high",
    title: "Location information is embedded",
    detail:
      "This file contains coordinates or a named location that may reveal where it was created.",
    matches: (_entry, value) =>
      /(?:\bgps\b|latitude|longitude|location|iso6709|geotag|destination\.bearing)/i.test(
        value,
      ),
  },
  {
    category: "device-identifier",
    severity: "high",
    title: "A device identifier is embedded",
    detail:
      "Serial numbers or owner identifiers can link the file to a particular camera, lens or person.",
    matches: (_entry, value) =>
      /(?:serial(?:\s|\.|_)*number|bodyserial|lensserial|cameraowner|ownername|deviceidentifier)/i.test(
        value,
      ),
  },
  {
    category: "personal",
    severity: "medium",
    title: "Personal or descriptive information is embedded",
    detail:
      "Creator, author, rights, title, description or comment fields may identify a person or project.",
    matches: (entry, value) =>
      entry.sensitive === true &&
      /(?:artist|author|creator|owner|copyright|rights|title|description|comment|credit|contact)/i.test(
        value,
      ),
  },
  {
    category: "timestamp",
    severity: "medium",
    title: "Creation or editing times are embedded",
    detail:
      "Recorded dates and times can reveal when the media was captured, exported or modified.",
    matches: (_entry, value) =>
      /(?:datetime|timestamp|created(?:at|date)?|modified(?:at|date)?|datecreated|datetimedigitized|datetimeoriginal)/i.test(
        value,
      ),
  },
  {
    category: "embedded-preview",
    severity: "high",
    title: "An embedded preview or thumbnail is present",
    detail:
      "Embedded previews can retain an earlier crop or unedited view that differs from the visible image.",
    matches: (_entry, value) => /(?:thumbnail|embeddedpreview|previewimage)/i.test(value),
  },
  {
    category: "generation-data",
    severity: "medium",
    title: "AI generation data is embedded",
    detail:
      "Prompts, workflows, model settings or origin claims may disclose how this media was generated.",
    matches: (_entry, value) =>
      /(?:\bprompt\b|negativeprompt|workflow|comfyui|stable\s*diffusion|digitalsourcetype|trainedalgorithm|\blora\b|generationdata|sampler|cfgscale)/i.test(
        value,
      ),
  },
  {
    category: "editing-history",
    severity: "low",
    title: "Editing software information is embedded",
    detail:
      "Software and creator-tool fields can reveal the applications used to create or edit the file.",
    matches: (_entry, value) =>
      /(?:software|creatortool|photoshop|lightroom|editinghistory|historyaction|historywhen)/i.test(
        value,
      ),
  },
];

function searchableEntry(entry: MetadataEntry) {
  const value = Array.isArray(entry.value)
    ? entry.value.join(" ")
    : String(entry.value);
  return `${entry.key} ${entry.label} ${value}`;
}

export function derivePrivacyFindings(
  entries: readonly MetadataEntry[],
): readonly PrivacyFinding[] {
  const findings: PrivacyFinding[] = [];
  for (const rule of RULES) {
    const metadataKeys = entries
      .filter((entry) => rule.matches(entry, searchableEntry(entry)))
      .map((entry) => entry.key);
    if (metadataKeys.length === 0) continue;
    findings.push({
      id: rule.category,
      category: rule.category,
      severity: rule.severity,
      title: rule.title,
      detail: rule.detail,
      metadataKeys,
    });
  }
  return findings;
}
