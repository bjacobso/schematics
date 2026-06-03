export type SchematicsImageFormat = "png" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "unknown";

/**
 * Metadata read directly from an image's bytes (format magic + dimension
 * headers) or, for SVG, from its markup. A second non-schema artifact type that
 * rides the same handler/cache machinery as the PDF views — proof the artifact
 * primitive generalizes past one special case. `width`/`height` are `null` when
 * the dimensions can't be determined, never a guess.
 */
export interface SchematicsImageInspection {
  readonly kind: "image";
  readonly path: string;
  readonly format: SchematicsImageFormat;
  readonly width: number | null;
  readonly height: number | null;
  readonly byteLength: number;
}

interface DecodedImage {
  readonly bytes: Uint8Array;
  readonly svgText: string | null;
}

export function inspectImage(content: string, path: string): SchematicsImageInspection {
  const decoded = decodeImageContent(content);
  const format = detectFormat(decoded);
  const dimensions =
    format === "svg"
      ? svgDimensions(decoded.svgText ?? "")
      : rasterDimensions(format, decoded.bytes);

  return {
    kind: "image",
    path,
    format,
    width: dimensions?.width ?? null,
    height: dimensions?.height ?? null,
    byteLength: decoded.bytes.byteLength,
  };
}

function decodeImageContent(content: string): DecodedImage {
  const trimmed = content.trimStart();
  if (trimmed.startsWith("<svg") || trimmed.startsWith("<?xml")) {
    return { bytes: new TextEncoder().encode(content), svgText: content };
  }
  const dataUrl = content.match(/^data:image\/([a-z0-9.+-]+);base64,([\s\S]*)$/i);
  if (dataUrl?.[2] !== undefined) {
    if (dataUrl[1]?.toLowerCase().includes("svg")) {
      const text = utf8(base64ToBytes(dataUrl[2]));
      return { bytes: new TextEncoder().encode(text), svgText: text };
    }
    return { bytes: base64ToBytes(dataUrl[2]), svgText: null };
  }
  // Bare base64 vs. raw binary string: a base64 body has no control bytes.
  if (/^[A-Za-z0-9+/=\s]+$/.test(content) && content.replace(/\s+/g, "").length % 4 === 0) {
    return { bytes: base64ToBytes(content), svgText: null };
  }
  return { bytes: binaryStringToBytes(content), svgText: null };
}

function detectFormat(decoded: DecodedImage): SchematicsImageFormat {
  if (decoded.svgText !== null) return "svg";
  const bytes = decoded.bytes;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return "png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x47, 0x49, 0x46])) return "gif";
  if (startsWith(bytes, [0x42, 0x4d])) return "bmp";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && matchesAt(bytes, 8, [0x57, 0x45, 0x42, 0x50]))
    return "webp";
  return "unknown";
}

interface Dimensions {
  readonly width: number;
  readonly height: number;
}

function rasterDimensions(format: SchematicsImageFormat, bytes: Uint8Array): Dimensions | null {
  switch (format) {
    case "png":
      // IHDR width/height are big-endian uint32 at offsets 16 and 20.
      return bytes.length >= 24
        ? { width: readUint32BE(bytes, 16), height: readUint32BE(bytes, 20) }
        : null;
    case "gif":
      return bytes.length >= 10
        ? { width: readUint16LE(bytes, 6), height: readUint16LE(bytes, 8) }
        : null;
    case "bmp":
      return bytes.length >= 26
        ? { width: readUint32LE(bytes, 18), height: Math.abs(readInt32LE(bytes, 22)) }
        : null;
    case "jpeg":
      return jpegDimensions(bytes);
    case "webp":
      return webpDimensions(bytes);
    default:
      return null;
  }
}

function jpegDimensions(bytes: Uint8Array): Dimensions | null {
  let offset = 2; // skip SOI (0xFFD8)
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    // SOF0..SOF15 carry frame dimensions, excluding DHT(C4)/JPG(C8)/DAC(CC).
    const isSof =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      return { height: readUint16BE(bytes, offset + 5), width: readUint16BE(bytes, offset + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    const segmentLength = readUint16BE(bytes, offset + 2);
    if (segmentLength < 2) return null;
    offset += 2 + segmentLength;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): Dimensions | null {
  if (bytes.length < 30) return null;
  const fourCc = utf8(bytes.subarray(12, 16));
  if (fourCc === "VP8X") {
    return {
      width: read24LE(bytes, 24) + 1,
      height: read24LE(bytes, 27) + 1,
    };
  }
  if (fourCc === "VP8 ") {
    // Lossy: dimensions live just after the start-code at offset 26.
    return { width: readUint16LE(bytes, 26) & 0x3fff, height: readUint16LE(bytes, 28) & 0x3fff };
  }
  if (fourCc === "VP8L" && bytes.length >= 25) {
    const bits = bytes[21]! | (bytes[22]! << 8) | (bytes[23]! << 16) | (bytes[24]! << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function svgDimensions(text: string): Dimensions | null {
  const svgTag = text.match(/<svg\b[^>]*>/i)?.[0] ?? "";
  const width = parseSvgLength(svgTag.match(/\bwidth\s*=\s*["']([^"']+)["']/i)?.[1]);
  const height = parseSvgLength(svgTag.match(/\bheight\s*=\s*["']([^"']+)["']/i)?.[1]);
  if (width !== null && height !== null) return { width, height };

  const viewBox = svgTag.match(/\bviewBox\s*=\s*["']([^"']+)["']/i)?.[1];
  if (viewBox) {
    const parts = viewBox
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts.every((value) => Number.isFinite(value))) {
      return { width: Math.round(parts[2]!), height: Math.round(parts[3]!) };
    }
  }
  return null;
}

function parseSvgLength(value: string | undefined): number | null {
  if (value === undefined) return null;
  const match = value.match(/^([0-9]*\.?[0-9]+)\s*(px)?$/i);
  return match ? Math.round(Number(match[1])) : null;
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return matchesAt(bytes, 0, prefix);
}

function matchesAt(bytes: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (bytes.length < offset + expected.length) return false;
  return expected.every((value, index) => bytes[offset + index] === value);
}

function readUint16BE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function readUint16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function readUint32BE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    ((bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!)
  );
}

function readUint32LE(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! +
    bytes[offset + 1]! * 0x100 +
    bytes[offset + 2]! * 0x10000 +
    bytes[offset + 3]! * 0x1000000
  );
}

function readInt32LE(bytes: Uint8Array, offset: number): number {
  return readUint32LE(bytes, offset) | 0;
}

function read24LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16);
}

function utf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ""));
  return binaryStringToBytes(binary);
}

function binaryStringToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index) & 0xff;
  }
  return bytes;
}
