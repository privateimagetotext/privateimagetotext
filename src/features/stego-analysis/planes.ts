export type ChannelKey = "r" | "g" | "b" | "a";

export const CHANNELS: readonly ChannelKey[] = ["r", "g", "b", "a"];

export const CHANNEL_LABELS: Record<ChannelKey, string> = {
  r: "Red",
  g: "Green",
  b: "Blue",
  a: "Alpha",
};

const CHANNEL_INDEX: Record<ChannelKey, number> = { r: 0, g: 1, b: 2, a: 3 };

export type PlaneView =
  | { readonly kind: "normal" }
  | { readonly kind: "opaque" }
  | { readonly kind: "inverted" }
  | { readonly kind: "bit"; readonly channel: ChannelKey; readonly bit: number }
  | { readonly kind: "rgb-bit"; readonly bit: number }
  | { readonly kind: "channel"; readonly channel: ChannelKey };

export type PlaneDefinition = {
  readonly id: string;
  readonly label: string;
  readonly view: PlaneView;
};

function definitions(): PlaneDefinition[] {
  const list: PlaneDefinition[] = [
    { id: "normal", label: "Normal image", view: { kind: "normal" } },
    { id: "opaque", label: "Colour with transparency removed", view: { kind: "opaque" } },
    { id: "inverted", label: "Colour inversion", view: { kind: "inverted" } },
  ];
  for (const channel of CHANNELS) {
    for (let bit = 7; bit >= 0; bit -= 1) {
      list.push({
        id: `${channel}${bit}`,
        label: `${CHANNEL_LABELS[channel]} plane ${bit}${bit === 0 ? " (least significant)" : bit === 7 ? " (most significant)" : ""}`,
        view: { kind: "bit", channel, bit },
      });
    }
  }
  for (let bit = 7; bit >= 0; bit -= 1) {
    list.push({ id: `rgb${bit}`, label: `Combined RGB plane ${bit}`, view: { kind: "rgb-bit", bit } });
  }
  for (const channel of CHANNELS) {
    list.push({ id: `${channel}-only`, label: `${CHANNEL_LABELS[channel]} channel only`, view: { kind: "channel", channel } });
  }
  return list;
}

export const PLANE_DEFINITIONS: readonly PlaneDefinition[] = definitions();

export function planeById(id: string) {
  return PLANE_DEFINITIONS.find((plane) => plane.id === id);
}

/** Renders one analysis view of straight RGBA pixels into a new RGBA buffer. */
export function renderPlane(source: Uint8ClampedArray, view: PlaneView): Uint8ClampedArray {
  const output = new Uint8ClampedArray(source.length);
  const length = source.length;
  switch (view.kind) {
    case "normal":
      output.set(source);
      break;
    case "opaque":
      for (let i = 0; i < length; i += 4) {
        output[i] = source[i];
        output[i + 1] = source[i + 1];
        output[i + 2] = source[i + 2];
        output[i + 3] = 255;
      }
      break;
    case "inverted":
      for (let i = 0; i < length; i += 4) {
        output[i] = 255 - source[i];
        output[i + 1] = 255 - source[i + 1];
        output[i + 2] = 255 - source[i + 2];
        output[i + 3] = 255;
      }
      break;
    case "bit": {
      const offset = CHANNEL_INDEX[view.channel];
      const mask = 1 << view.bit;
      for (let i = 0; i < length; i += 4) {
        const value = source[i + offset] & mask ? 255 : 0;
        output[i] = value;
        output[i + 1] = value;
        output[i + 2] = value;
        output[i + 3] = 255;
      }
      break;
    }
    case "rgb-bit": {
      const mask = 1 << view.bit;
      for (let i = 0; i < length; i += 4) {
        output[i] = source[i] & mask ? 255 : 0;
        output[i + 1] = source[i + 1] & mask ? 255 : 0;
        output[i + 2] = source[i + 2] & mask ? 255 : 0;
        output[i + 3] = 255;
      }
      break;
    }
    case "channel": {
      const offset = CHANNEL_INDEX[view.channel];
      for (let i = 0; i < length; i += 4) {
        const value = source[i + offset];
        if (view.channel === "a") {
          output[i] = value;
          output[i + 1] = value;
          output[i + 2] = value;
        } else {
          output[i + offset] = value;
        }
        output[i + 3] = 255;
      }
      break;
    }
  }
  return output;
}
