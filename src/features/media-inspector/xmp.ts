import { boundedTextBytes, decodeUtf8, MetadataCollector } from "./metadata";

function decodeXmlEntities(value: string) {
  return value.replace(
    /&(amp|lt|gt|quot|apos|#\d{1,7}|#x[0-9a-fA-F]{1,6});/g,
    (entity, code: string) => {
      if (code === "amp") return "&";
      if (code === "lt") return "<";
      if (code === "gt") return ">";
      if (code === "quot") return '"';
      if (code === "apos") return "'";
      const numeric = code.startsWith("#x")
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10);
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 0x10ffff) {
        return entity;
      }
      return String.fromCodePoint(numeric);
    },
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cleanXmlValue(value: string) {
  return decodeXmlEntities(value.replace(/<[^>]{0,512}>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function findXmpValue(packet: string, names: readonly string[]) {
  for (const name of names) {
    const escaped = escapeRegExp(name);
    const attribute = new RegExp(`(?:\\s|<)${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i").exec(packet);
    if (attribute) return cleanXmlValue(attribute[2]);
    const element = new RegExp(`<${escaped}(?:\\s[^>]{0,2048})?>([\\s\\S]*?)<\\/${escaped}\\s*>`, "i").exec(packet);
    if (element) return cleanXmlValue(element[1]);
  }
  return null;
}

const XMP_FIELDS = [
  {
    names: ["Iptc4xmpExt:DigitalSourceType", "iptcExt:DigitalSourceType"],
    key: "xmp.digitalSourceType",
    label: "Digital source type",
    sensitive: false,
  },
  {
    names: ["Iptc4xmpExt:AISystemUsed", "iptcExt:AISystemUsed"],
    key: "xmp.aiSystemUsed",
    label: "AI system used",
    sensitive: true,
  },
  {
    names: ["Iptc4xmpExt:AISystemVersionUsed", "iptcExt:AISystemVersionUsed"],
    key: "xmp.aiSystemVersionUsed",
    label: "AI system version used",
    sensitive: true,
  },
  {
    names: [
      "Iptc4xmpExt:AIPromptInfo",
      "Iptc4xmpExt:AIPromptInformation",
      "iptcExt:AIPromptInfo",
    ],
    key: "xmp.aiPromptInformation",
    label: "AI prompt information",
    sensitive: true,
  },
  {
    names: ["Iptc4xmpExt:AIPromptWriterName", "iptcExt:AIPromptWriterName"],
    key: "xmp.aiPromptWriterName",
    label: "AI prompt writer name",
    sensitive: true,
  },
  {
    names: ["xmp:CreatorTool"],
    key: "xmp.creatorTool",
    label: "Creator tool",
    sensitive: false,
  },
  {
    names: ["xmp:CreateDate", "photoshop:DateCreated"],
    key: "xmp.createDate",
    label: "Creation date",
    sensitive: true,
  },
  {
    names: ["xmp:ModifyDate", "xmp:MetadataDate"],
    key: "xmp.modifyDate",
    label: "Modification date",
    sensitive: true,
  },
  {
    names: ["dc:creator"],
    key: "xmp.creator",
    label: "Creator",
    sensitive: true,
  },
  {
    names: ["dc:title"],
    key: "xmp.title",
    label: "Title",
    sensitive: true,
  },
  {
    names: ["dc:description"],
    key: "xmp.description",
    label: "Description",
    sensitive: true,
  },
  {
    names: ["dc:rights"],
    key: "xmp.rights",
    label: "Rights statement",
    sensitive: false,
  },
] as const;

export function parseXmpPacket(
  bytes: Uint8Array,
  collector: MetadataCollector,
) {
  const packet = decodeUtf8(boundedTextBytes(bytes));
  if (!packet) return;
  for (const field of XMP_FIELDS) {
    collector.add(
      field.key,
      field.label,
      findXmpValue(packet, field.names),
      "xmp",
      field.sensitive,
    );
  }
  collector.add(
    "xmp.packet",
    "Raw XMP packet",
    packet,
    "xmp",
    /(?:prompt|workflow|gps|location|creator|author|serial)/i.test(packet),
  );
}
