import { decode, encode, convertIndexedToRgb } from 'fast-png';
import type { Pack } from './pack';

export type Raster = { width: number; height: number; data: Uint8Array };
export const blank = (width: number, height: number): Raster => {
  if (width <= 0 || height <= 0 || width * height > 16777216)
    throw new Error('Texture dimensions exceed the 16 megapixel image limit.');
  return { width, height, data: new Uint8Array(width * height * 4) };
};

export function readPng(bytes: Uint8Array): Raster {
  if (bytes.length < 24) throw new Error('Incomplete PNG.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16),
    height = view.getUint32(20);
  const image = blank(width, height);
  let input = bytes;
  let colorKey: Uint16Array | undefined;
  // fast-png mistakes an RGB color key for three pixel alpha values when an
  // image has fewer than three pixels. Read that key separately in this case.
  if (bytes[25] === 2 && width * height < 3) {
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = view.getUint32(offset);
      if (offset + length + 12 > bytes.length) break;
      if (view.getUint32(offset + 4) === 0x74524e53 && length === 6) {
        colorKey = new Uint16Array([
          view.getUint16(offset + 8),
          view.getUint16(offset + 10),
          view.getUint16(offset + 12),
        ]);
        input = new Uint8Array(bytes.length - 18);
        input.set(bytes.subarray(0, offset));
        input.set(bytes.subarray(offset + 18), offset);
        break;
      }
      offset += length + 12;
    }
  }
  const png = decode(input);
  if (colorKey) png.transparency = colorKey;
  const source = png.palette
    ? { ...png, data: convertIndexedToRgb(png), channels: png.palette[0].length, depth: 8 }
    : png;
  const max = (1 << source.depth) - 1;
  for (let i = 0; i < width * height; i++) {
    const offset = i * source.channels;
    if (!png.palette && png.depth < 8) {
      const x = i % width,
        y = Math.floor(i / width);
      const packed =
        png.data[y * Math.ceil((width * png.depth) / 8) + Math.floor((x * png.depth) / 8)];
      const value = (packed >> (8 - png.depth - ((x * png.depth) % 8))) & max;
      image.data.set(
        [
          (value * 255) / max,
          (value * 255) / max,
          (value * 255) / max,
          png.transparency?.[0] === value ? 0 : 255,
        ],
        i * 4,
      );
      continue;
    }
    const rgba = i * 4;
    const gray = source.channels < 3;
    image.data[rgba] = Math.round((source.data[offset] * 255) / max);
    image.data[rgba + 1] = Math.round((source.data[offset + (gray ? 0 : 1)] * 255) / max);
    image.data[rgba + 2] = Math.round((source.data[offset + (gray ? 0 : 2)] * 255) / max);
    image.data[rgba + 3] =
      source.channels === 2 || source.channels === 4
        ? Math.round((source.data[offset + source.channels - 1] * 255) / max)
        : 255;
    if (
      png.transparency &&
      png.transparency.every((v, channel) => v === png.data[i * png.channels + channel])
    )
      image.data[rgba + 3] = 0;
  }
  return image;
}

export function savePng(pack: Pack, path: string, image: Raster): void {
  pack.set(path, encode({ ...image, depth: 8, channels: 4 }));
}

// Coordinates are in the vanilla sheet's units. Integer scaling preserves HD pixels.
export class Sheet {
  readonly scaleX: number;
  readonly scaleY: number;
  constructor(
    readonly image: Raster,
    width: number,
    height: number,
  ) {
    this.scaleX = image.width / width;
    this.scaleY = image.height / height;
    if (
      !Number.isInteger(this.scaleX) ||
      !Number.isInteger(this.scaleY) ||
      this.scaleX < 1 ||
      this.scaleY < 1
    )
      throw new Error(`Expected a multiple of ${width} x ${height} pixels.`);
  }
  canvas(width: number, height: number): Raster {
    return blank(width * this.scaleX, height * this.scaleY);
  }
  copy(
    output: Raster,
    x: number,
    y: number,
    width: number,
    height: number,
    dx = 0,
    dy = 0,
    flip: 'none' | 'y' | 'xy' = 'none',
  ): void {
    const sx = x * this.scaleX,
      sy = y * this.scaleY,
      w = width * this.scaleX,
      h = height * this.scaleY;
    const tx = dx * this.scaleX,
      ty = dy * this.scaleY;
    if (
      sx < 0 ||
      sy < 0 ||
      sx + w > this.image.width ||
      sy + h > this.image.height ||
      tx + w > output.width ||
      ty + h > output.height
    )
      throw new Error('Texture slice is outside the image.');
    for (let py = 0; py < h; py++)
      for (let px = 0; px < w; px++) {
        const input =
          ((sy + (flip === 'none' ? py : h - py - 1)) * this.image.width +
            sx +
            (flip === 'xy' ? w - px - 1 : px)) *
          4;
        output.data.set(
          this.image.data.subarray(input, input + 4),
          ((ty + py) * output.width + tx + px) * 4,
        );
      }
  }
  crop(x: number, y: number, width: number, height: number): Raster {
    const output = this.canvas(width, height);
    this.copy(output, x, y, width, height);
    return output;
  }
}

export function withSheet(
  pack: Pack,
  path: string,
  width: number,
  height: number,
  run: (sheet: Sheet) => void,
): void {
  const bytes = pack.files.get(path);
  if (!bytes) return;
  try {
    run(new Sheet(readPng(bytes), width, height));
  } catch (error) {
    pack.warn(
      `Could not convert ${path}: ${error instanceof Error ? error.message : 'Unsupported PNG.'} Original artwork is under converter_legacy.`,
    );
    pack.archive(path);
    pack.archive(path + '.mcmeta');
  }
}
