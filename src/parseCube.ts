export interface CubeLut {
  title?: string;
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  data: Array<[number, number, number]>;
}

export function parseCube(content: string): CubeLut {
  const lines = content.split(/\r?\n/);

  let title: string | undefined;
  let size: number | undefined;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  const data: Array<[number, number, number]> = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    if (line.startsWith("TITLE ")) {
      const match = line.match(/^TITLE\s+"(.*)"$/);
      title = match ? match[1] : line.slice("TITLE ".length).replace(/^"|"$/g, "");
      continue;
    }

    if (line.startsWith("LUT_3D_SIZE ")) {
      size = Number(line.split(/\s+/)[1]);
      continue;
    }

    if (line.startsWith("DOMAIN_MIN ")) {
      const parts = line.split(/\s+/).slice(1).map(Number);
      domainMin = [parts[0], parts[1], parts[2]];
      continue;
    }

    if (line.startsWith("DOMAIN_MAX ")) {
      const parts = line.split(/\s+/).slice(1).map(Number);
      domainMax = [parts[0], parts[1], parts[2]];
      continue;
    }

    const parts = line.split(/\s+/).map(Number);
    if (parts.length === 3 && parts.every((v) => Number.isFinite(v))) {
      data.push([parts[0], parts[1], parts[2]]);
    }
  }

  if (!size) {
    throw new Error("Missing LUT_3D_SIZE in .cube file");
  }

  const expectedEntries = size * size * size;
  if (data.length !== expectedEntries) {
    throw new Error(
      `Invalid LUT data length: expected ${expectedEntries}, got ${data.length}`
    );
  }

  return {
    title,
    size,
    domainMin,
    domainMax,
    data
  };
}
