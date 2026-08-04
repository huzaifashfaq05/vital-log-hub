import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { analyzeReport } from "@/lib/reports.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/upload")({
  head: () => ({
    meta: [
      { title: "Upload Medical Image | MedVault AI" },
      { name: "description", content: "Upload a medical image or report for private AI-assisted interpretation." },
      { property: "og:title", content: "Upload Medical Image | MedVault AI" },
      { property: "og:description", content: "Add a scan or medical report to your private MedVault AI workspace." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UploadPage,
});

const ACCEPT =
  ".pdf,.jpg,.jpeg,.png,.dcm,.dicom,application/pdf,image/jpeg,image/png,application/dicom";
const MAX_BYTES = 20 * 1024 * 1024;

function UploadPage() {
  const router = useRouter();
  const { user } = Route.useRouteContext();
  const analyze = useServerFn(analyzeReport);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function handleUpload() {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast.error("File is larger than 20MB.");
      return;
    }
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() ?? "bin";
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("medical-reports").upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (up.error) throw up.error;

      const { data: inserted, error: ierr } = await supabase
        .from("reports")
        .insert({
          user_id: user.id,
          title: file.name.replace(/\.[^.]+$/, ""),
          report_type: "other",
          file_path: path,
          file_mime: file.type || "application/octet-stream",
          file_size: file.size,
          ai_status: "processing",
        })
        .select("id")
        .single();
      if (ierr || !inserted) {
        await supabase.storage.from("medical-reports").remove([path]);
        throw ierr ?? new Error("Insert failed");
      }

      toast.success("Uploaded. Analyzing with AI…");
      router.navigate({ to: "/reports/$reportId", params: { reportId: inserted.id } });

      // Fire and forget
      analyze({ data: { reportId: inserted.id } }).catch((e) => {
        toast.error(e instanceof Error ? e.message : "AI analysis failed");
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-6 py-12 animate-entrance">
      <p className="label-mono">(New) Add to your vault</p>
      <h1 className="mt-3 font-serif italic text-4xl">Upload a medical report</h1>
      <p className="mt-3 text-sm text-muted-foreground max-w-[55ch]">
        PDFs, DICOM studies, X-rays, prescriptions, or lab results. We&apos;ll extract the key fields and
        write a short plain-language explanation.
      </p>

      <label
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) setFile(f);
        }}
        className={`mt-10 block border-2 border-dashed rounded-lg p-16 text-center cursor-pointer transition-colors ${
          dragOver ? "border-primary bg-primary/5" : "border-border bg-white/30 hover:bg-white/60"
        }`}
      >
        <input
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <div className="mb-4 inline-flex size-12 items-center justify-center rounded-full bg-background border border-border">
          <span className="font-serif italic text-xl text-primary">+</span>
        </div>
        <p className="text-sm font-medium">
          {file ? file.name : "Click to browse, or drop a file here"}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          PDF, JPG, PNG, DICOM (.dcm) · up to 20MB
        </p>
      </label>

      <div className="mt-8 flex items-center gap-4">
        <button
          onClick={handleUpload}
          disabled={!file || uploading}
          className="px-6 py-3 bg-primary text-primary-foreground text-sm font-medium rounded-sm shadow-sm hover:brightness-110 transition-all disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Upload & analyze"}
        </button>
        {file && !uploading && (
          <button
            onClick={() => setFile(null)}
            className="label-mono hover:text-foreground transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      <p className="mt-12 text-[10px] leading-relaxed italic text-muted-foreground max-w-[55ch]">
        MedVault provides educational summaries only. It is not a substitute for
        professional medical advice, diagnosis, or treatment. Always consult a qualified
        healthcare professional.
      </p>
    </main>
  );
}
