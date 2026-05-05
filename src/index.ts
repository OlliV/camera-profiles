import * as fs from "fs";
import * as path from "path";
import { parseCube } from "./parseCube";
import { generateXmp } from "./generateXmp";

interface CliOptions {
  input: string;
  output: string;
  name: string;
  inputColorSpace: InputColorSpace;
  cubeOrder: CubeOrder;
  description?: string;
  copyright?: string;
}

type InputColorSpace =
  | "rec709"
  | "rec709-oetf"
  | "rec709-gamma24"
  | "srgb"
  | "adobe-rgb"
  | "linear-rec709"
  | "linear-adobe-rgb";

type CubeOrder = "blue-fast" | "red-fast";

const INPUT_COLOR_SPACES: ReadonlyArray<InputColorSpace> = [
  "rec709",
  "rec709-oetf",
  "rec709-gamma24",
  "srgb",
  "adobe-rgb",
  "linear-rec709",
  "linear-adobe-rgb"
];

const CUBE_ORDERS: ReadonlyArray<CubeOrder> = ["blue-fast", "red-fast"];

function parseArgs(argv: string[]): CliOptions {
  const args = [...argv];
  const input = args.shift();

  if (!input) {
    throw new Error(
      "Usage: node dist/index.js <input.cube> [-o output.xmp] [--name profile-name] [--input-color-space rec709|rec709-gamma24|rec709-oetf|srgb|adobe-rgb|linear-rec709|linear-adobe-rgb] [--cube-order blue-fast|red-fast] [--description text] [--copyright text]"
    );
  }

  let output = input.replace(/\.cube$/i, ".xmp");
  let name = path.basename(output, ".xmp");
  let inputColorSpace: InputColorSpace = "rec709-gamma24";
  let cubeOrder: CubeOrder = "red-fast";
  let description: string | undefined;
  let copyright: string | undefined;

  while (args.length > 0) {
    const arg = args.shift();

    switch (arg) {
      case "-o":
      case "--output":
        output = args.shift() ?? output;
        break;
      case "--name":
        name = args.shift() ?? name;
        break;
      case "--input-color-space": {
        const value = (args.shift() ?? "").toLowerCase() as InputColorSpace;
        if (!INPUT_COLOR_SPACES.includes(value)) {
          throw new Error(
            `Invalid --input-color-space value: ${value}. Expected one of: ${INPUT_COLOR_SPACES.join(", ")}`
          );
        }
        inputColorSpace = value;
        break;
      }
      case "--cube-order": {
        const value = (args.shift() ?? "").toLowerCase() as CubeOrder;
        if (!CUBE_ORDERS.includes(value)) {
          throw new Error(
            `Invalid --cube-order value: ${value}. Expected one of: ${CUBE_ORDERS.join(", ")}`
          );
        }
        cubeOrder = value;
        break;
      }
      case "--description":
        description = args.shift();
        break;
      case "--copyright":
        copyright = args.shift();
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return {
    input,
    output,
    name,
    inputColorSpace,
    cubeOrder,
    description,
    copyright
  };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const cubeContent = fs.readFileSync(options.input, "utf8");
  const lut = parseCube(cubeContent);

  const xmp = generateXmp(lut, {
    profileName: options.name,
    inputColorSpace: options.inputColorSpace,
    cubeOrder: options.cubeOrder,
    description: options.description,
    copyright: options.copyright
  });

  fs.writeFileSync(options.output, xmp, "utf8");
  console.log(`Wrote ${options.output}`);
}

main();
