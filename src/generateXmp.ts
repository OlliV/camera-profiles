import { randomUUID } from "crypto";
import { deflateSync } from "zlib";
import { CubeLut } from "./parseCube";

export type InputColorSpace =
  | "rec709"
  | "rec709-oetf"
  | "rec709-gamma24"
  | "srgb"
  | "adobe-rgb"
  | "linear-rec709"
  | "linear-adobe-rgb";

export type CubeOrder = "blue-fast" | "red-fast";

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

const ADOBE_RGB_GAMMA = 563 / 256; // Adobe RGB (1998) nominal gamma.
const REC709_DISPLAY_GAMMA = 2.4;

function decodeRec709Oetf(v: number): number {
  return v < 0.081 ? v / 4.5 : Math.pow((v + 0.099) / 1.099, 1 / 0.45);
}

function decodeTransfer(value: number, space: InputColorSpace): number {
  const v = clamp01(value);
  switch (space) {
    // Most grading Rec.709 LUTs (for example from Resolve) target display gamma.
    case "rec709":
    case "rec709-gamma24":
      return Math.pow(v, REC709_DISPLAY_GAMMA);
    case "rec709-oetf":
      return decodeRec709Oetf(v);
    case "srgb":
      return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    case "adobe-rgb":
      return Math.pow(v, ADOBE_RGB_GAMMA);
    case "linear-rec709":
    case "linear-adobe-rgb":
      return v;
  }
}

function encodeAdobeTransfer(linear: number): number {
  return Math.pow(clamp01(linear), 1 / ADOBE_RGB_GAMMA);
}

function multiplyMat3Vec3(
  m: ReadonlyArray<ReadonlyArray<number>>,
  v: readonly [number, number, number]
): [number, number, number] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2]
  ];
}

const REC709_TO_XYZ: ReadonlyArray<ReadonlyArray<number>> = [
  [0.4123908, 0.35758434, 0.18048079],
  [0.21263901, 0.71516868, 0.07219232],
  [0.01933082, 0.11919478, 0.95053215]
];

const ADOBE_TO_XYZ: ReadonlyArray<ReadonlyArray<number>> = [
  [0.5767309, 0.185554, 0.1881852],
  [0.2973769, 0.6273491, 0.0752741],
  [0.0270343, 0.0706872, 0.9911085]
];

const XYZ_TO_ADOBE: ReadonlyArray<ReadonlyArray<number>> = [
  [2.041369, -0.5649464, -0.3446944],
  [-0.969266, 1.8760108, 0.041556],
  [0.0134474, -0.1183897, 1.0154096]
];

function convertInputToAdobeRgbEncoded(
  rgb: readonly [number, number, number],
  inputColorSpace: InputColorSpace
): [number, number, number] {
  const decoded: [number, number, number] = [
    decodeTransfer(rgb[0], inputColorSpace),
    decodeTransfer(rgb[1], inputColorSpace),
    decodeTransfer(rgb[2], inputColorSpace)
  ];

  let adobeLinear: [number, number, number];
  if (inputColorSpace === "adobe-rgb" || inputColorSpace === "linear-adobe-rgb") {
    adobeLinear = decoded;
  } else {
    const xyz = multiplyMat3Vec3(REC709_TO_XYZ, decoded);
    adobeLinear = multiplyMat3Vec3(XYZ_TO_ADOBE, xyz);
  }

  return [
    encodeAdobeTransfer(adobeLinear[0]),
    encodeAdobeTransfer(adobeLinear[1]),
    encodeAdobeTransfer(adobeLinear[2])
  ];
}

function cubeDataIndex(
  size: number,
  rIndex: number,
  gIndex: number,
  bIndex: number,
  cubeOrder: CubeOrder
): number {
  if (cubeOrder === "blue-fast") {
    return rIndex * size * size + gIndex * size + bIndex;
  }

  // Red-fast ordering: r changes fastest, then g, then b.
  return bIndex * size * size + gIndex * size + rIndex;
}

function encodeRgbTableBinary(
  lut: CubeLut,
  inputColorSpace: InputColorSpace,
  cubeOrder: CubeOrder
): Buffer {
  const size = lut.size;
  const count = size * size * size;
  const buffer = Buffer.alloc(4 * 4 + count * 3 * 2 + 3 * 4 + 2 * 8 + 4);
  let offset = 0;

  const BTT_RGB_TABLE = 1;
  const RGB_TABLE_VERSION_1 = 1;
  const DIMENSIONS_3D = 3;
  const PRIMARIES_ADOBE = 1;
  const GAMMA_2_2 = 3;
  const GAMUT_CLIP = 0;
  const MIN_AMOUNT = 0.0;
  const MAX_AMOUNT = 2.0;
  const FLAGS = 1;

  const nopValues = new Array<number>(size);
  for (let i = 0; i < size; i++) {
    nopValues[i] = Math.floor((i * 0xffff + (size >> 1)) / (size - 1));
  }

  buffer.writeUInt32LE(BTT_RGB_TABLE, offset);
  offset += 4;
  buffer.writeUInt32LE(RGB_TABLE_VERSION_1, offset);
  offset += 4;
  buffer.writeUInt32LE(DIMENSIONS_3D, offset);
  offset += 4;
  buffer.writeUInt32LE(size, offset);
  offset += 4;

  for (let i = 0; i < count; i++) {
    const rIndex = Math.floor(i / (size * size));
    const gIndex = Math.floor((i % (size * size)) / size);
    const bIndex = i % size;

    const sourceIndex = cubeDataIndex(size, rIndex, gIndex, bIndex, cubeOrder);
    const [r, g, b] = convertInputToAdobeRgbEncoded(
      lut.data[sourceIndex],
      inputColorSpace
    );
    const r16 = Math.round(clamp01(r) * 0xffff);
    const g16 = Math.round(clamp01(g) * 0xffff);
    const b16 = Math.round(clamp01(b) * 0xffff);

    buffer.writeUInt16LE((r16 - nopValues[rIndex]) & 0xffff, offset);
    offset += 2;
    buffer.writeUInt16LE((g16 - nopValues[gIndex]) & 0xffff, offset);
    offset += 2;
    buffer.writeUInt16LE((b16 - nopValues[bIndex]) & 0xffff, offset);
    offset += 2;
  }

  buffer.writeUInt32LE(PRIMARIES_ADOBE, offset);
  offset += 4;
  buffer.writeUInt32LE(GAMMA_2_2, offset);
  offset += 4;
  buffer.writeUInt32LE(GAMUT_CLIP, offset);
  offset += 4;
  buffer.writeDoubleLE(MIN_AMOUNT, offset);
  offset += 8;
  buffer.writeDoubleLE(MAX_AMOUNT, offset);
  offset += 8;
  buffer.writeUInt32LE(FLAGS, offset);

  return buffer;
}

function encodeCompressedLookTable(
  lut: CubeLut,
  inputColorSpace: InputColorSpace,
  cubeOrder: CubeOrder
): Buffer {
  const uncompressed = encodeRgbTableBinary(lut, inputColorSpace, cubeOrder);
  const compressed = deflateSync(uncompressed);
  const withSize = Buffer.alloc(4 + compressed.length);

  withSize.writeUInt32LE(uncompressed.length, 0);
  compressed.copy(withSize, 4);

  return withSize;
}

const ADOBE_DNG_BASE85_ALPHABET =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.-:+=^!/*?`'|()[]{}@%$#";

function encodeAdobeBase85(data: Buffer): string {
  const chars: string[] = [];
  let remaining = data.length;

  for (let i = 0; remaining > 0; i += 4) {
    const b0 = data[i] ?? 0;
    const b1 = data[i + 1] ?? 0;
    const b2 = data[i + 2] ?? 0;
    const b3 = data[i + 3] ?? 0;

    const x0 = (b0 + (b1 << 8) + (b2 << 16) + ((b3 << 24) >>> 0)) >>> 0;

    const x1 = Math.floor(x0 / 85);
    chars.push(ADOBE_DNG_BASE85_ALPHABET[x0 - x1 * 85]);

    const x2 = Math.floor(x1 / 85);
    chars.push(ADOBE_DNG_BASE85_ALPHABET[x1 - x2 * 85]);
    remaining -= 1;
    if (remaining === 0) break;

    const x3 = Math.floor(x2 / 85);
    chars.push(ADOBE_DNG_BASE85_ALPHABET[x2 - x3 * 85]);
    remaining -= 1;
    if (remaining === 0) break;

    const x4 = Math.floor(x3 / 85);
    chars.push(ADOBE_DNG_BASE85_ALPHABET[x3 - x4 * 85]);
    remaining -= 1;
    if (remaining === 0) break;

    chars.push(ADOBE_DNG_BASE85_ALPHABET[x4]);
    remaining -= 1;
  }

  return chars.join("");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface GenerateXmpOptions {
  profileName: string;
  inputColorSpace: InputColorSpace;
  cubeOrder: CubeOrder;
  description?: string;
  copyright?: string;
}

export function generateXmp(lut: CubeLut, options: GenerateXmpOptions): string {
  const uuid = randomUUID().replace(/-/g, "").toUpperCase();
  const lookTableId = randomUUID().replace(/-/g, "").toUpperCase();
  const encoded = encodeAdobeBase85(
    encodeCompressedLookTable(lut, options.inputColorSpace, options.cubeOrder)
  );
  const name = escapeXml(options.profileName);
  const description = escapeXml(
    options.description ?? `Generated from ${lut.title ?? "3D LUT"}`
  );
  const copyright = escapeXml(options.copyright ?? "");

  return `<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 7.0-c000 1.000000, 0000/00/00-00:00:00        ">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
   crs:PresetType="Look"
   crs:Cluster=""
   crs:UUID="${uuid}"
   crs:SupportsAmount="False"
   crs:SupportsColor="True"
   crs:SupportsMonochrome="False"
   crs:SupportsHighDynamicRange="True"
   crs:SupportsNormalDynamicRange="True"
   crs:SupportsSceneReferred="True"
   crs:SupportsOutputReferred="False"
   crs:RequiresRGBTables="False"
   crs:CameraModelRestriction=""
   crs:Copyright="${copyright}"
   crs:ContactInfo=""
   crs:Version="17.0"
   crs:ProcessVersion="15.4"
   crs:ConvertToGrayscale="False"
   crs:CameraProfile=""
   crs:RGBTable="${lookTableId}"
   crs:Table_${lookTableId}="${encoded}"
   crs:HasSettings="True">
   <crs:Name>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${name}</rdf:li>
    </rdf:Alt>
   </crs:Name>
   <crs:ShortName>
    <rdf:Alt>
     <rdf:li xml:lang="x-default"/>
    </rdf:Alt>
   </crs:ShortName>
   <crs:SortName>
    <rdf:Alt>
     <rdf:li xml:lang="x-default"/>
    </rdf:Alt>
   </crs:SortName>
   <crs:Group>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">Camera</rdf:li>
    </rdf:Alt>
   </crs:Group>
   <crs:Description>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${description}</rdf:li>
    </rdf:Alt>
   </crs:Description>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>`;
}
