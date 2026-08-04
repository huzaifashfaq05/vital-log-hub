import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  parseDicom,
  renderFrameToImageData,
  WINDOW_PRESETS,
  type DicomImage,
} from "@/lib/dicom";

type Props = { url: string; fileName?: string };

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 12;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

async function decodeEncodedFrame(
  bytes: Uint8Array,
  mime: string,
  image: DicomImage,
): Promise<Float32Array> {
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime });
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = image.columns;
  canvas.height = image.rows;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, image.columns, image.rows);
  bitmap.close?.();
  const { data } = ctx.getImageData(0, 0, image.columns, image.rows);
  const px = image.rows * image.columns;
  const out = new Float32Array(px * (image.samplesPerPixel === 3 ? 3 : 1));
  for (let p = 0; p < px; p++) {
    if (image.samplesPerPixel === 3) {
      out[p * 3] = data[p * 4];
      out[p * 3 + 1] = data[p * 4 + 1];
      out[p * 3 + 2] = data[p * 4 + 2];
    } else {
      out[p] = data[p * 4];
    }
  }
  return out;
}

export default function DicomViewer({ url, fileName }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [image, setImage] = useState<DicomImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [values, setValues] = useState<Float32Array | null>(null);
  const [center, setCenter] = useState(0);
  const [width, setWidth] = useState(1);
  const [invert, setInvert] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [tool, setTool] = useState<"window" | "pan">("window");
  const [fit, setFit] = useState(1);

  // Load + parse the file
  useEffect(() => {
    let cancelled = false;
    setImage(null);
    setValues(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Could not download the file (${res.status}).`);
        const buf = await res.arrayBuffer();
        const parsed = parseDicom(buf);
        if (cancelled) return;
        setImage(parsed);
        setFrame(0);
        setCenter(parsed.windowCenter);
        setWidth(parsed.windowWidth);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not read this DICOM file.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  // Load the active frame's pixel values
  useEffect(() => {
    if (!image) return;
    let cancelled = false;
    (async () => {
      try {
        const src = image.frameSource(frame);
        const vals =
          src.kind === "pixels"
            ? src.values
            : await decodeEncodedFrame(src.bytes, src.mime, image);
        if (cancelled) return;
        setValues(vals);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "This frame could not be decoded.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [image, frame]);

  // Fit-to-container scale
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el || !image) return;
    const compute = () => {
      const rect = el.getBoundingClientRect();
      const next = Math.min(rect.width / image.columns, rect.height / image.rows) || 1;
      setFit(next);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [image]);

  const imageData = useMemo(() => {
    if (!image || !values) return null;
    return renderFrameToImageData(image, values, center, width, invert);
  }, [image, values, center, width, invert]);

  // Paint
  useEffect(() => {
    const canvas = canvasRef.current;
    const el = containerRef.current;
    if (!canvas || !el || !image || !imageData) return;
    const rect = el.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const off = document.createElement("canvas");
    off.width = image.columns;
    off.height = image.rows;
    off.getContext("2d")?.putImageData(imageData, 0, 0);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, rect.width, rect.height);
    const scale = fit * zoom;
    const drawW = image.columns * scale;
    const drawH = image.rows * scale;
    const x = (rect.width - drawW) / 2 + offset.x;
    const y = (rect.height - drawH) / 2 + offset.y;
    ctx.imageSmoothingEnabled = scale < 3;
    ctx.drawImage(off, x, y, drawW, drawH);
  }, [imageData, image, zoom, offset, fit]);

  // Wheel zoom anchored at the cursor (non-passive listener)
  const zoomAtRef = useRef<(clientX: number, clientY: number, deltaY: number, mode: number) => void>(
    () => {},
  );
  zoomAtRef.current = (clientX, clientY, deltaY, mode) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const dy = deltaY * (mode === 1 ? 16 : mode === 2 ? 100 : 1);
    const next = clamp(zoom * Math.exp(-dy * 0.0015), MIN_ZOOM, MAX_ZOOM);
    if (next === zoom) return;
    const k = next / zoom;
    const px = clientX - rect.left - rect.width / 2;
    const py = clientY - rect.top - rect.height / 2;
    setOffset((o) => ({ x: px - (px - o.x) * k, y: py - (py - o.y) * k }));
    setZoom(next);
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAtRef.current(e.clientX, e.clientY, e.deltaY, e.deltaMode);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const drag = useRef<{ x: number; y: number; center: number; width: number; ox: number; oy: number; pan: boolean } | null>(null);

  const onPointerDown = (e: React.PointerEvent) => {
    if (!image) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      center,
      width,
      ox: offset.x,
      oy: offset.y,
      pan: tool === "pan" || e.button === 1 || e.shiftKey,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !image) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (d.pan) {
      setOffset({ x: d.ox + dx, y: d.oy + dy });
    } else {
      const range = Math.max(1, image.maxValue - image.minValue);
      const step = range / 400;
      setWidth(Math.max(1, d.width + dx * step));
      setCenter(d.center + dy * step);
    }
  };

  const endDrag = (e: React.PointerEvent) => {
    drag.current = null;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  };

  const reset = useCallback(() => {
    if (!image) return;
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setCenter(image.windowCenter);
    setWidth(image.windowWidth);
    setInvert(false);
  }, [image]);

  // Slice navigation with arrow keys
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!image || image.frames < 2) return;
    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
      e.preventDefault();
      setFrame((f) => Math.min(image.frames - 1, f + 1));
    } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
      e.preventDefault();
      setFrame((f) => Math.max(0, f - 1));
    }
  };

  if (error) {
    return (
      <div className="p-6 bg-card ring-1 ring-destructive/20 rounded-sm">
        <p className="label-mono mb-2">DICOM viewer</p>
        <p className="text-sm text-destructive">{error}</p>
      </div>
    );
  }

  return (
    <section className="bg-card ring-1 ring-black/5 rounded-sm overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 border-b border-border">
        <p className="label-mono">DICOM viewer</p>
        {image && (
          <p className="label-mono text-muted-foreground">
            {[image.modality, image.bodyPart, image.seriesDescription].filter(Boolean).join(" · ") ||
              fileName ||
              "Series"}
          </p>
        )}
        <div className="ml-auto flex items-center gap-1">
          {(["window", "pan"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTool(t)}
              className={`px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider transition-colors ${
                tool === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {t === "window" ? "W/L" : "Pan"}
            </button>
          ))}
          <button
            onClick={() => setInvert((v) => !v)}
            className={`px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider transition-colors ${
              invert ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            Invert
          </button>
          <button
            onClick={reset}
            className="px-2.5 py-1 rounded-full text-[10px] font-mono uppercase tracking-wider bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            Reset
          </button>
        </div>
      </header>

      <div
        ref={containerRef}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        className={`relative h-[420px] bg-black outline-none touch-none select-none ${
          tool === "pan" ? "cursor-grab" : "cursor-crosshair"
        }`}
      >
        <canvas ref={canvasRef} className="block h-full w-full" />
        {!imageData && (
          <p className="absolute inset-0 grid place-items-center label-mono text-white/60">
            Decoding image…
          </p>
        )}
        {image && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between p-3 text-[10px] font-mono uppercase tracking-wider text-white/70">
            <span>
              WC {Math.round(center)} / WW {Math.round(width)}
            </span>
            <span>
              {image.columns}×{image.rows} · {Math.round(zoom * 100)}% ·{" "}
              {image.frames > 1 ? `Slice ${frame + 1}/${image.frames}` : "Single frame"}
            </span>
          </div>
        )}
      </div>

      <div className="px-5 py-4 space-y-4">
        {image && image.frames > 1 && (
          <label className="block">
            <span className="label-mono">Slice</span>
            <input
              type="range"
              min={0}
              max={image.frames - 1}
              value={frame}
              onChange={(e) => setFrame(Number(e.target.value))}
              className="mt-2 w-full accent-primary"
            />
          </label>
        )}

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="label-mono">Window center {Math.round(center)}</span>
            <input
              type="range"
              min={Math.round((image?.minValue ?? 0) - 200)}
              max={Math.round((image?.maxValue ?? 255) + 200)}
              value={Math.round(center)}
              onChange={(e) => setCenter(Number(e.target.value))}
              className="mt-2 w-full accent-primary"
            />
          </label>
          <label className="block">
            <span className="label-mono">Window width {Math.round(width)}</span>
            <input
              type="range"
              min={1}
              max={Math.max(2, Math.round(((image?.maxValue ?? 255) - (image?.minValue ?? 0)) * 2) || 4096)}
              value={Math.round(width)}
              onChange={(e) => setWidth(Number(e.target.value))}
              className="mt-2 w-full accent-primary"
            />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="label-mono">Presets</span>
          {WINDOW_PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => {
                setCenter(p.center);
                setWidth(p.width);
              }}
              className="px-3 py-1 text-xs font-mono border border-border rounded-full hover:border-primary hover:text-primary transition-colors"
            >
              {p.label}
            </button>
          ))}
          <span className="ml-auto label-mono">
            Scroll to zoom · drag to {tool === "pan" ? "pan" : "window"} · shift-drag to pan
          </span>
        </div>
      </div>
    </section>
  );
}
