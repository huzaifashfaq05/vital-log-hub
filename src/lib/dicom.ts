import dicomParser from "dicom-parser";

export type DicomFrameSource =
  | { kind: "pixels"; values: Float32Array }
  | { kind: "encoded"; bytes: Uint8Array; mime: string };

export type DicomImage = {
  rows: number;
  columns: number;
  frames: number;
  samplesPerPixel: number;
  photometric: string;
  windowCenter: number;
  windowWidth: number;
  minValue: number;
  maxValue: number;
  patientName: string | null;
  modality: string | null;
  studyDescription: string | null;
  seriesDescription: string | null;
  bodyPart: string | null
  frameSource: (index: number) => DicomFrameSource;
};

const ENCODED_MIME: Record<string, string> = {
  "1.2.840.10008.1.2.4.50": "image/jpeg",
  "1.2.840.10008.1.2.4.51": "image/jpeg",
  "1.2.840.10008.1.2.4.57": "image/jpeg",
  "1.2.840.10008.1.2.4.70": "image/jpeg",
  "1.2.840.10008.1.2.4.80": "image/jpeg",
  "1.2.840.10008.1.2.4.81": "image/jpeg",
  "1.2.840.10008.1.2.4.90": "image/jp2",
  "1.2.840.10008.1.2.4.91": "image/jp2",
  "1.2.840.10008.1.2.4.201": "image/jxl",
  "1.2.840.10008.1.2.4.202": "image/jxl",
  "1.2.840.10008.1.2.4.203": "image/jxl",
};

function firstNumber(raw: string | undefined, fallback: number) {
  if (!raw) return fallback;
  const n = Number.parseFloat(raw.split("\\")[0]);
  return Number.isFinite(n) ? n : fallback;
}

/** True when the buffer looks like a DICOM part-10 file (DICM magic at offset 128). */
export function looksLikeDicom(buffer: ArrayBuffer) {
  if (buffer.byteLength < 132) return false;
  const b = new Uint8Array(buffer, 128, 4);
  return b[0] === 0x44 && b[1] === 0x49 && b[2] === 0x43 && b[3] === 0x4d;
}

export function parseDicom(buffer: ArrayBuffer): DicomImage {
  const byteArray = new Uint8Array(buffer);
  const dataSet = dicomParser.parseDicom(byteArray);

  const rows = dataSet.uint16("x00280010") ?? 0;
  const columns = dataSet.uint16("x00280011") ?? 0;
  if (!rows || !columns) throw new Error("This DICOM file has no displayable image data.");

  const samplesPerPixel = dataSet.uint16("x00280002") ?? 1;
  const photometric = (dataSet.string("x00280004") ?? "MONOCHROME2").trim();
  const frames = Math.max(1, Number.parseInt(dataSet.string("x00280008") ?? "1", 10) || 1);
  const bitsAllocated = dataSet.uint16("x00280100") ?? 16;
  const pixelRepresentation = dataSet.uint16("x00280103") ?? 0;
  const slope = firstNumber(dataSet.string("x00281053"), 1) || 1;
  const intercept = firstNumber(dataSet.string("x00281052"), 0);
  const planarConfiguration = dataSet.uint16("x00280006") ?? 0;
  const transferSyntax = (dataSet.string("x00020010") ?? "1.2.840.10008.1.2.1").trim();

  const pixelElement = dataSet.elements["x7fe00010"];
  if (!pixelElement) throw new Error("This DICOM file contains no pixel data.");

  const encodedMime = ENCODED_MIME[transferSyntax];
  const isEncapsulated = Boolean(pixelElement.fragments?.length) || Boolean(encodedMime);

  const pixelsPerFrame = rows * columns * samplesPerPixel;
  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  const frameCache = new Map<number, DicomFrameSource>();

  const readPixelFrame = (index: number): Float32Array => {
    const out = new Float32Array(pixelsPerFrame);
    if (bitsAllocated === 8) {
      const base = pixelElement.dataOffset + index * pixelsPerFrame;
      for (let i = 0; i < pixelsPerFrame; i++) {
        const v = byteArray[base + i] ?? 0;
        out[i] = (pixelRepresentation === 1 && v > 127 ? v - 256 : v) * slope + intercept;
      }
    } else {
      const base = pixelElement.dataOffset + index * pixelsPerFrame * 2;
      const view = new DataView(buffer);
      for (let i = 0; i < pixelsPerFrame; i++) {
        const off = base + i * 2;
        if (off + 1 >= byteArray.length) break;
        const v =
          pixelRepresentation === 1 ? view.getInt16(off, true) : view.getUint16(off, true);
        out[i] = v * slope + intercept;
      }
    }
    if (samplesPerPixel === 3 && planarConfiguration === 1) {
      // Convert planar RGB (RRR GGG BBB) to interleaved.
      const plane = rows * columns;
      const interleaved = new Float32Array(pixelsPerFrame);
      for (let p = 0; p < plane; p++) {
        interleaved[p * 3] = out[p];
        interleaved[p * 3 + 1] = out[plane + p];
        interleaved[p * 3 + 2] = out[plane * 2 + p];
      }
      return interleaved;
    }
    return out;
  };

  const frameSource = (index: number): DicomFrameSource => {
    const cached = frameCache.get(index);
    if (cached) return cached;

    let source: DicomFrameSource;
    if (isEncapsulated) {
      const fragments = pixelElement.fragments ?? [];
      let bytes: Uint8Array;
      if (fragments.length >= frames && frames > 1) {
        const f = fragments[Math.min(index, fragments.length - 1)];
        bytes = byteArray.subarray(f.position, f.position + f.length);
      } else if (fragments.length > 0) {
        const total = fragments.reduce((sum, f) => sum + f.length, 0);
        bytes = new Uint8Array(total);
        let at = 0;
        for (const f of fragments) {
          bytes.set(byteArray.subarray(f.position, f.position + f.length), at);
          at += f.length;
        }
      } else {
        bytes = byteArray.subarray(
          pixelElement.dataOffset,
          pixelElement.dataOffset + pixelElement.length,
        );
      }
      source = { kind: "encoded", bytes, mime: encodedMime ?? "image/jpeg" };
    } else {
      const values = readPixelFrame(index);
      for (let i = 0; i < values.length; i++) {
        if (values[i] < minValue) minValue = values[i];
        if (values[i] > maxValue) maxValue = values[i];
      }
      source = { kind: "pixels", values };
    }
    frameCache.set(index, source);
    return source;
  };

  // Prime frame 0 so min/max are known for a sensible default window.
  const first = frameSource(0);
  if (first.kind !== "pixels" || !Number.isFinite(minValue)) {
    minValue = 0;
    maxValue = 255;
  }

  const storedCenter = firstNumber(dataSet.string("x00281050"), Number.NaN);
  const storedWidth = firstNumber(dataSet.string("x00281051"), Number.NaN);

  return {
    rows,
    columns,
    frames,
    samplesPerPixel,
    photometric,
    windowCenter: Number.isFinite(storedCenter) ? storedCenter : (minValue + maxValue) / 2,
    windowWidth: Number.isFinite(storedWidth) && storedWidth > 0 ? storedWidth : Math.max(1, maxValue - minValue),
    minValue,
    maxValue,
    patientName: dataSet.string("x00100010")?.trim() || null,
    modality: dataSet.string("x00080060")?.trim() || null,
    studyDescription: dataSet.string("x00081030")?.trim() || null,
    seriesDescription: dataSet.string("x0008103e")?.trim() || null,
    bodyPart: dataSet.string("x00180015")?.trim() || null,
    frameSource,
  };
}

/** Window a monochrome/RGB frame into an RGBA ImageData buffer. */
export function renderFrameToImageData(
  image: DicomImage,
  values: Float32Array,
  center: number,
  width: number,
  invert: boolean,
): ImageData {
  const { rows, columns, samplesPerPixel, photometric } = image;
  const data = new Uint8ClampedArray(rows * columns * 4);
  const w = Math.max(1, width);
  const low = center - w / 2;
  const monoInverted = photometric === "MONOCHROME1" ? !invert : invert;

  const scale = (v: number) => {
    let out = ((v - low) / w) * 255;
    if (out < 0) out = 0;
    else if (out > 255) out = 255;
    return monoInverted ? 255 - out : out;
  };

  for (let p = 0; p < rows * columns; p++) {
    const o = p * 4;
    if (samplesPerPixel === 3) {
      data[o] = scale(values[p * 3]);
      data[o + 1] = scale(values[p * 3 + 1]);
      data[o + 2] = scale(values[p * 3 + 2]);
    } else {
      const g = scale(values[p]);
      data[o] = g;
      data[o + 1] = g;
      data[o + 2] = g;
    }
    data[o + 3] = 255;
  }
  return new ImageData(data, columns, rows);
}

export const WINDOW_PRESETS: Array<{ label: string; center: number; width: number }> = [
  { label: "Soft tissue", center: 40, width: 400 },
  { label: "Lung", center: -600, width: 1500 },
  { label: "Bone", center: 300, width: 1500 },
  { label: "Brain", center: 40, width: 80 },
  { label: "Abdomen", center: 60, width: 400 },
];
