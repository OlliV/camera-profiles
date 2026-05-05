# Camera Profile Generator

Node.js + TypeScript CLI for converting a `.cube` 3D LUT into a XMP camera-profile-like container.

## Install

```bash
npm install
npm run build
```

## Usage

```bash
node dist/index.js input.cube -o Profile.xmp --name "My Profile" --input-color-space rec709-gamma24
```

## Input Color Space

Use `--input-color-space` to tell the converter how the `.cube` values are encoded.

Supported values:

- `rec709` (alias of `rec709-gamma24`)
- `rec709-gamma24` (default, typical for display-referred grading LUTs from Resolve)
- `rec709-oetf` (legacy camera OETF interpretation)
- `srgb`
- `adobe-rgb`
- `linear-rec709`
- `linear-adobe-rgb`

If a Rec.709 LUT looks too bright/flat in Lightroom, use `rec709-gamma24`.

The LUT samples are transformed into Adobe RGB table space before embedding, to match Lightroom RGB profile table expectations.

## Cube Order

Use `--cube-order` to specify how the `.cube` sample lines are ordered:

- `red-fast` (default): red index changes fastest, then green, then blue
- `blue-fast`: blue index changes fastest, then green, then red

If colors look strongly rotated (for example red turning blue), try the other cube order.
