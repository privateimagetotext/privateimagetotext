import { MediaInspectionError, throwIfAborted } from "./errors";
import { MetadataCollector } from "./metadata";
import {
  BoundedBlobReader,
  ascii,
  readUint16BigEndian,
  readUint32BigEndian,
  readUint64BigEndian,
} from "./reader";
import {
  MEDIA_INSPECTION_LIMITS,
  type ContainerMediaDetails,
  type DetectedMediaFormat,
  type InspectionWarning,
  type MediaTrack,
  type MediaTrackKind,
  type MetadataEntry,
} from "./types";

type IsoBox = {
  readonly offset: number;
  readonly type: string;
  readonly size: number;
  readonly headerSize: number;
  readonly payloadOffset: number;
  readonly end: number;
};

type ParseState = {
  boxCount: number;
};

type MovieHeader = {
  readonly timescale?: number;
  readonly durationSeconds?: number;
  readonly createdAt?: string;
  readonly modifiedAt?: string;
};

type SampleDescription = {
  readonly codec?: string;
  readonly width?: number;
  readonly height?: number;
  readonly channels?: number;
  readonly sampleRate?: number;
};

type TrackDraft = {
  id?: number;
  kind: MediaTrackKind;
  codec?: string;
  durationSeconds?: number;
  language?: string;
  width?: number;
  height?: number;
  channels?: number;
  sampleRate?: number;
  createdAt?: string;
  modifiedAt?: string;
  sampleDescription?: SampleDescription;
};

export interface ParsedIsoBmff {
  readonly container: ContainerMediaDetails;
  readonly metadata: readonly MetadataEntry[];
  readonly warnings: readonly InspectionWarning[];
}

function addSafe(left: number, right: number, message: string) {
  const value = left + right;
  if (!Number.isSafeInteger(value)) {
    throw new MediaInspectionError("malformed-file", message);
  }
  return value;
}

async function readBox(
  reader: BoundedBlobReader,
  offset: number,
  boundary: number,
): Promise<IsoBox> {
  if (boundary - offset < 8) {
    throw new MediaInspectionError(
      "malformed-file",
      "An ISO media box header is truncated.",
    );
  }
  const basic = await reader.read(offset, 8);
  const size32 = readUint32BigEndian(basic, 0);
  const type = ascii(basic, 4, 4);
  let size = size32;
  let headerSize = 8;
  if (size32 === 1) {
    if (boundary - offset < 16) {
      throw new MediaInspectionError(
        "malformed-file",
        "An extended ISO media box header is truncated.",
      );
    }
    size = readUint64BigEndian(await reader.read(offset + 8, 8), 0);
    headerSize = 16;
  } else if (size32 === 0) {
    size = boundary - offset;
  }
  const end = addSafe(offset, size, "An ISO media box end offset is invalid.");
  if (size < headerSize || end > boundary) {
    throw new MediaInspectionError(
      "malformed-file",
      `The ISO media box ${JSON.stringify(type)} has an invalid length.`,
    );
  }
  return {
    offset,
    type,
    size,
    headerSize,
    payloadOffset: offset + headerSize,
    end,
  };
}

async function forEachBox(
  reader: BoundedBlobReader,
  start: number,
  end: number,
  depth: number,
  state: ParseState,
  visit: (box: IsoBox) => Promise<void>,
) {
  if (depth > MEDIA_INSPECTION_LIMITS.maxContainerDepth) {
    throw new MediaInspectionError(
      "metadata-limit-exceeded",
      "The media container is nested too deeply to inspect safely.",
    );
  }
  let offset = start;
  while (offset < end) {
    throwIfAborted(reader.signal);
    state.boxCount += 1;
    if (state.boxCount > MEDIA_INSPECTION_LIMITS.maxContainerBoxes) {
      throw new MediaInspectionError(
        "metadata-limit-exceeded",
        "The media container has too many boxes to inspect safely.",
      );
    }
    const box = await readBox(reader, offset, end);
    await visit(box);
    if (box.end <= offset) {
      throw new MediaInspectionError(
        "malformed-file",
        "An ISO media box does not advance the file cursor.",
      );
    }
    offset = box.end;
  }
}

function isAllOnes(bytes: Uint8Array, offset: number, length: number) {
  if (offset < 0 || offset + length > bytes.byteLength) return false;
  for (let index = offset; index < offset + length; index += 1) {
    if (bytes[index] !== 0xff) return false;
  }
  return true;
}

function isoDate(
  seconds: number,
  collector: MetadataCollector,
  label: string,
) {
  if (seconds === 0) return undefined;
  const milliseconds = (seconds - 2_082_844_800) * 1_000;
  if (!Number.isFinite(milliseconds) || Math.abs(milliseconds) > 8.64e15) {
    collector.warn(
      "timestamp-out-of-range",
      `${label} is outside the date range supported by this browser.`,
    );
    return undefined;
  }
  return new Date(milliseconds).toISOString();
}

function secondsFromDuration(duration: number | undefined, timescale: number) {
  if (duration === undefined || timescale <= 0) return undefined;
  const seconds = duration / timescale;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

async function parseMovieHeader(
  reader: BoundedBlobReader,
  box: IsoBox,
  collector: MetadataCollector,
): Promise<MovieHeader> {
  if (box.size - box.headerSize < 20) {
    throw new MediaInspectionError("malformed-file", "The mvhd box is truncated.");
  }
  const versionByte = await reader.read(box.payloadOffset, 1);
  const version = versionByte[0];
  if (version !== 0 && version !== 1) {
    collector.warn("metadata-unsupported", `Movie header version ${version} is not supported.`);
    return {};
  }
  const required = version === 0 ? 20 : 32;
  if (box.size - box.headerSize < required) {
    throw new MediaInspectionError("malformed-file", "The mvhd fields are truncated.");
  }
  const bytes = await reader.read(box.payloadOffset, required);
  const creationSeconds = version === 0
    ? readUint32BigEndian(bytes, 4)
    : readUint64BigEndian(bytes, 4);
  const modificationSeconds = version === 0
    ? readUint32BigEndian(bytes, 8)
    : readUint64BigEndian(bytes, 12);
  const timescale = readUint32BigEndian(bytes, version === 0 ? 12 : 20);
  const durationOffset = version === 0 ? 16 : 24;
  const durationLength = version === 0 ? 4 : 8;
  const duration = isAllOnes(bytes, durationOffset, durationLength)
    ? undefined
    : version === 0
      ? readUint32BigEndian(bytes, durationOffset)
      : readUint64BigEndian(bytes, durationOffset);
  if (timescale === 0) {
    collector.warn("metadata-truncated", "The movie header has a zero timescale.");
  }
  const durationSeconds = secondsFromDuration(duration, timescale);
  const createdAt = isoDate(
    creationSeconds,
    collector,
    "The movie creation time",
  );
  const modifiedAt = isoDate(
    modificationSeconds,
    collector,
    "The movie modification time",
  );
  return {
    ...(timescale ? { timescale } : {}),
    ...(durationSeconds !== undefined ? { durationSeconds } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(modifiedAt ? { modifiedAt } : {}),
  };
}

async function parseTrackHeader(
  reader: BoundedBlobReader,
  box: IsoBox,
  draft: TrackDraft,
  collector: MetadataCollector,
) {
  const payloadLength = box.size - box.headerSize;
  if (payloadLength < 24) {
    throw new MediaInspectionError("malformed-file", "The tkhd box is truncated.");
  }
  const version = (await reader.read(box.payloadOffset, 1))[0];
  if (version !== 0 && version !== 1) {
    collector.warn("metadata-unsupported", `Track header version ${version} is not supported.`);
    return;
  }
  const headLength = version === 0 ? 24 : 36;
  const required = version === 0 ? 84 : 96;
  if (payloadLength < required) {
    throw new MediaInspectionError("malformed-file", "The tkhd fields are truncated.");
  }
  const bytes = await reader.read(box.payloadOffset, headLength);
  const creationSeconds = version === 0
    ? readUint32BigEndian(bytes, 4)
    : readUint64BigEndian(bytes, 4);
  const modificationSeconds = version === 0
    ? readUint32BigEndian(bytes, 8)
    : readUint64BigEndian(bytes, 12);
  draft.id = readUint32BigEndian(bytes, version === 0 ? 12 : 20);
  draft.createdAt = isoDate(creationSeconds, collector, "A track creation time");
  draft.modifiedAt = isoDate(modificationSeconds, collector, "A track modification time");

  const dimensions = await reader.read(box.end - 8, 8);
  const width = readUint32BigEndian(dimensions, 0) / 65_536;
  const height = readUint32BigEndian(dimensions, 4) / 65_536;
  if (width > 0 && height > 0) {
    draft.width = width;
    draft.height = height;
  }
}

function decodeLanguage(value: number) {
  const codes = [(value >> 10) & 31, (value >> 5) & 31, value & 31];
  if (codes.some((code) => code < 1 || code > 26)) return undefined;
  return String.fromCharCode(...codes.map((code) => code + 0x60));
}

async function parseMediaHeader(
  reader: BoundedBlobReader,
  box: IsoBox,
  draft: TrackDraft,
  collector: MetadataCollector,
) {
  const version = (await reader.read(box.payloadOffset, 1))[0];
  if (version !== 0 && version !== 1) {
    collector.warn("metadata-unsupported", `Media header version ${version} is not supported.`);
    return;
  }
  const required = version === 0 ? 24 : 36;
  if (box.size - box.headerSize < required) {
    throw new MediaInspectionError("malformed-file", "The mdhd fields are truncated.");
  }
  const bytes = await reader.read(box.payloadOffset, required);
  const timescaleOffset = version === 0 ? 12 : 20;
  const durationOffset = version === 0 ? 16 : 24;
  const durationLength = version === 0 ? 4 : 8;
  const timescale = readUint32BigEndian(bytes, timescaleOffset);
  const duration = isAllOnes(bytes, durationOffset, durationLength)
    ? undefined
    : version === 0
      ? readUint32BigEndian(bytes, durationOffset)
      : readUint64BigEndian(bytes, durationOffset);
  draft.durationSeconds = secondsFromDuration(duration, timescale);
  draft.language = decodeLanguage(
    readUint16BigEndian(bytes, version === 0 ? 20 : 32),
  );
  if (timescale === 0) {
    collector.warn("metadata-truncated", "A media track has a zero timescale.");
  }
}

async function parseHandler(reader: BoundedBlobReader, box: IsoBox) {
  if (box.size - box.headerSize < 12) {
    throw new MediaInspectionError("malformed-file", "The hdlr box is truncated.");
  }
  const bytes = await reader.read(box.payloadOffset, 12);
  const handler = ascii(bytes, 8, 4);
  const kinds: Readonly<Record<string, MediaTrackKind>> = {
    vide: "video",
    soun: "audio",
    text: "text",
    sbtl: "text",
    subt: "text",
    clcp: "text",
    meta: "metadata",
    mdta: "metadata",
  };
  return kinds[handler] ?? "unknown";
}

async function parseSampleDescription(
  reader: BoundedBlobReader,
  box: IsoBox,
): Promise<SampleDescription> {
  const payloadLength = box.size - box.headerSize;
  if (payloadLength < 16) {
    throw new MediaInspectionError("malformed-file", "The stsd box is truncated.");
  }
  const head = await reader.read(box.payloadOffset, 16);
  const entryCount = readUint32BigEndian(head, 4);
  if (entryCount === 0) return {};
  const entrySize = readUint32BigEndian(head, 8);
  if (entrySize < 16 || entrySize > payloadLength - 8) {
    throw new MediaInspectionError(
      "malformed-file",
      "The first sample description has an invalid length.",
    );
  }
  const bytes = await reader.read(
    box.payloadOffset + 8,
    Math.min(entrySize, 80),
  );
  const codec = ascii(bytes, 4, 4);
  const width = bytes.byteLength >= 36 ? readUint16BigEndian(bytes, 32) : 0;
  const height = bytes.byteLength >= 36 ? readUint16BigEndian(bytes, 34) : 0;
  const channels = bytes.byteLength >= 28 ? readUint16BigEndian(bytes, 24) : 0;
  const sampleRate = bytes.byteLength >= 36
    ? readUint32BigEndian(bytes, 32) / 65_536
    : 0;
  return {
    codec,
    ...(width > 0 ? { width } : {}),
    ...(height > 0 ? { height } : {}),
    ...(channels > 0 && channels <= 64 ? { channels } : {}),
    ...(sampleRate > 0 && sampleRate <= 768_000 ? { sampleRate } : {}),
  };
}

async function parseSampleTable(
  reader: BoundedBlobReader,
  box: IsoBox,
  state: ParseState,
  depth: number,
  draft: TrackDraft,
) {
  await forEachBox(
    reader,
    box.payloadOffset,
    box.end,
    depth,
    state,
    async (child) => {
      if (child.type === "stsd") {
        draft.sampleDescription = await parseSampleDescription(reader, child);
      }
    },
  );
}

async function parseMediaInformation(
  reader: BoundedBlobReader,
  box: IsoBox,
  state: ParseState,
  depth: number,
  draft: TrackDraft,
) {
  await forEachBox(
    reader,
    box.payloadOffset,
    box.end,
    depth,
    state,
    async (child) => {
      if (child.type === "stbl") {
        await parseSampleTable(reader, child, state, depth + 1, draft);
      }
    },
  );
}

async function parseMedia(
  reader: BoundedBlobReader,
  box: IsoBox,
  state: ParseState,
  depth: number,
  draft: TrackDraft,
  collector: MetadataCollector,
) {
  await forEachBox(
    reader,
    box.payloadOffset,
    box.end,
    depth,
    state,
    async (child) => {
      if (child.type === "mdhd") {
        await parseMediaHeader(reader, child, draft, collector);
      } else if (child.type === "hdlr") {
        draft.kind = await parseHandler(reader, child);
      } else if (child.type === "minf") {
        await parseMediaInformation(reader, child, state, depth + 1, draft);
      }
    },
  );
}

function finaliseTrack(draft: TrackDraft): MediaTrack {
  const sample = draft.sampleDescription;
  return {
    ...(draft.id !== undefined ? { id: draft.id } : {}),
    kind: draft.kind,
    ...(sample?.codec ? { codec: sample.codec } : {}),
    ...(draft.durationSeconds !== undefined
      ? { durationSeconds: draft.durationSeconds }
      : {}),
    ...(draft.language ? { language: draft.language } : {}),
    ...(draft.kind === "video" && (draft.width ?? sample?.width)
      ? { width: draft.width ?? sample?.width }
      : {}),
    ...(draft.kind === "video" && (draft.height ?? sample?.height)
      ? { height: draft.height ?? sample?.height }
      : {}),
    ...(draft.kind === "audio" && sample?.channels
      ? { channels: sample.channels }
      : {}),
    ...(draft.kind === "audio" && sample?.sampleRate
      ? { sampleRate: sample.sampleRate }
      : {}),
    ...(draft.createdAt ? { createdAt: draft.createdAt } : {}),
    ...(draft.modifiedAt ? { modifiedAt: draft.modifiedAt } : {}),
  };
}

async function parseTrack(
  reader: BoundedBlobReader,
  box: IsoBox,
  state: ParseState,
  depth: number,
  collector: MetadataCollector,
) {
  const draft: TrackDraft = { kind: "unknown" };
  await forEachBox(
    reader,
    box.payloadOffset,
    box.end,
    depth,
    state,
    async (child) => {
      if (child.type === "tkhd") {
        await parseTrackHeader(reader, child, draft, collector);
      } else if (child.type === "mdia") {
        await parseMedia(reader, child, state, depth + 1, draft, collector);
      }
    },
  );
  return finaliseTrack(draft);
}

function addContainerMetadata(
  collector: MetadataCollector,
  format: DetectedMediaFormat,
  movie: MovieHeader,
  tracks: readonly MediaTrack[],
) {
  if (format.brands?.length) {
    collector.add("container.brands", "Compatible brands", format.brands, "container");
  }
  collector.add("container.duration", "Duration in seconds", movie.durationSeconds, "container");
  collector.add("container.createdAt", "Container creation time", movie.createdAt, "container", true);
  collector.add("container.modifiedAt", "Container modification time", movie.modifiedAt, "container", true);
  tracks.forEach((track, index) => {
    const prefix = `track.${index + 1}`;
    collector.add(`${prefix}.id`, `Track ${index + 1} ID`, track.id, "track");
    collector.add(`${prefix}.kind`, `Track ${index + 1} kind`, track.kind, "track");
    collector.add(`${prefix}.codec`, `Track ${index + 1} codec`, track.codec, "track");
    collector.add(`${prefix}.duration`, `Track ${index + 1} duration in seconds`, track.durationSeconds, "track");
    collector.add(`${prefix}.language`, `Track ${index + 1} language`, track.language, "track");
    collector.add(`${prefix}.dimensions`, `Track ${index + 1} dimensions`,
      track.width && track.height ? `${track.width} x ${track.height}` : undefined, "track");
    collector.add(`${prefix}.channels`, `Track ${index + 1} channels`, track.channels, "track");
    collector.add(`${prefix}.sampleRate`, `Track ${index + 1} sample rate`, track.sampleRate, "track");
    collector.add(`${prefix}.createdAt`, `Track ${index + 1} creation time`, track.createdAt, "track", true);
    collector.add(`${prefix}.modifiedAt`, `Track ${index + 1} modification time`, track.modifiedAt, "track", true);
  });
}

export async function parseIsoBmffMetadata(
  reader: BoundedBlobReader,
  format: DetectedMediaFormat,
): Promise<ParsedIsoBmff> {
  const collector = new MetadataCollector();
  const state: ParseState = { boxCount: 0 };
  const tracks: MediaTrack[] = [];
  let movie: MovieHeader = {};
  let foundMovie = false;

  await forEachBox(reader, 0, reader.size, 0, state, async (topLevel) => {
    if (topLevel.type !== "moov") return;
    foundMovie = true;
    await forEachBox(
      reader,
      topLevel.payloadOffset,
      topLevel.end,
      1,
      state,
      async (child) => {
        if (child.type === "mvhd") {
          movie = await parseMovieHeader(reader, child, collector);
        } else if (child.type === "trak") {
          tracks.push(await parseTrack(reader, child, state, 2, collector));
        }
      },
    );
  });

  if (!foundMovie) {
    throw new MediaInspectionError(
      "malformed-file",
      "The ISO media container has no movie metadata box.",
    );
  }
  addContainerMetadata(collector, format, movie, tracks);
  return {
    container: {
      brands: format.brands ?? [],
      ...(movie.durationSeconds !== undefined
        ? { durationSeconds: movie.durationSeconds }
        : {}),
      ...(movie.createdAt ? { createdAt: movie.createdAt } : {}),
      ...(movie.modifiedAt ? { modifiedAt: movie.modifiedAt } : {}),
      tracks,
    },
    metadata: collector.entries,
    warnings: collector.warnings,
  };
}
