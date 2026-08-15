import { jsPDF } from "jspdf";
import type { Extracted } from "./reports.helpers";

export type PdfReport = {
  id: string;
  title: string;
  report_type: string;
  hospital: string | null;
  doctor: string | null;
  report_date: string | null;
  clinical_history: string | null;
  patient_name?: string | null;
  patient_age?: string | null;
  patient_sex?: string | null;
  patient_id_ref?: string | null;
  referring_doctor?: string | null;
  explanation: string | null;
  extracted: Extracted | null;
  created_at: string;
};

const BRAND: [number, number, number] = [74, 93, 78]; // sage
const INK: [number, number, number] = [28, 28, 26];
const MUTED: [number, number, number] = [120, 118, 112];
const RULE: [number, number, number] = [200, 198, 190];

const M = 48; // margin
const PW = 595.28; // A4 width pt
const PH = 841.89;
const CW = PW - M * 2;

function fmtDate(v?: string | null) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

export async function generateReportPdf(
  report: PdfReport,
  opts: { imageDataUrl?: string | null } = {},
): Promise<Blob> {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  let y = 0;
  let page = 1;

  const footer = () => {
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.5);
    doc.line(M, PH - 58, PW - M, PH - 58);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(
      "AI-generated interpretation — informational purposes only. Confirm with a qualified radiologist or physician.",
      M,
      PH - 44,
    );
    doc.text(`MedVault AI · Report ${report.id.slice(0, 8).toUpperCase()} · Page ${page}`, M, PH - 32);
  };

  const letterhead = () => {
    doc.setFillColor(...BRAND);
    doc.rect(0, 0, PW, 6, "F");
    doc.setFont("times", "italic");
    doc.setFontSize(24);
    doc.setTextColor(...INK);
    doc.text("MedVault AI", M, 62);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);
    doc.text("PERSONAL MEDICAL RECORD VAULT", M, 76);
    doc.text("AI RADIOLOGY INTERPRETATION", PW - M, 62, { align: "right" });
    doc.text(`ISSUED ${fmtDate(new Date().toISOString()).toUpperCase()}`, PW - M, 76, { align: "right" });
    doc.setDrawColor(...BRAND);
    doc.setLineWidth(1);
    doc.line(M, 90, PW - M, 90);
    y = 118;
  };

  const newPage = () => {
    footer();
    doc.addPage();
    page += 1;
    letterhead();
  };

  const space = (h: number) => {
    if (y + h > PH - 80) newPage();
  };

  const heading = (label: string) => {
    space(46);
    y += 10;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...BRAND);
    doc.text(label.toUpperCase(), M, y);
    y += 6;
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.5);
    doc.line(M, y, PW - M, y);
    y += 16;
  };

  const body = (text: string, indent = 0) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);
    const lines = doc.splitTextToSize(text, CW - indent) as string[];
    for (const line of lines) {
      space(16);
      doc.text(line, M + indent, y);
      y += 13.5;
    }
  };

  const bullets = (items: string[]) => {
    for (const it of items) {
      doc.setTextColor(...BRAND);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      space(16);
      doc.text("·", M, y);
      body(it, 14);
      y += 2;
    }
  };

  letterhead();

  // Title block
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(report.report_type.replace(/_/g, " ").toUpperCase(), M, y);
  y += 20;
  doc.setFont("times", "italic");
  doc.setFontSize(20);
  doc.setTextColor(...INK);
  const titleLines = doc.splitTextToSize(report.title, CW) as string[];
  for (const l of titleLines) {
    doc.text(l, M, y);
    y += 24;
  }
  y += 4;

  const ext = report.extracted;
  const meta: Array<[string, string]> = [
    ["Patient", ext?.patient_name ?? "—"],
    ["Study date", fmtDate(report.report_date ?? report.created_at)],
    ["Facility", report.hospital ?? "—"],
    ["Referring / reading", report.doctor ?? "—"],
    ["Examination", ext?.examination ?? "—"],
    ["Technique", ext?.technique ?? "—"],
    ["Image quality", ext?.image_quality ?? "—"],
    [
      "Severity · confidence",
      `${ext?.severity ?? "unknown"}${
        ext?.confidence_score != null ? ` · ${Math.round(Math.max(0, Math.min(1, ext.confidence_score)) * 100)}%` : ""
      }`,
    ],
  ];

  doc.setDrawColor(...RULE);
  doc.setLineWidth(0.5);
  const colW = CW / 2;
  for (let i = 0; i < meta.length; i += 2) {
    space(34);
    const rowY = y;
    for (const [ci, pair] of [meta[i], meta[i + 1]].entries()) {
      if (!pair) continue;
      const x = M + ci * colW;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(...MUTED);
      doc.text(pair[0].toUpperCase(), x, rowY);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...INK);
      const v = doc.splitTextToSize(pair[1], colW - 16) as string[];
      doc.text(v.slice(0, 2), x, rowY + 13);
    }
    y = rowY + 40;
  }

  if (report.clinical_history) {
    heading("Clinical history");
    body(report.clinical_history);
  }

  if (ext?.findings?.length) {
    heading("Findings");
    bullets(ext.findings);
  }

  if (ext?.pathologies?.length) {
    heading("Detected pathologies");
    for (const p of ext.pathologies) {
      space(30);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...INK);
      doc.text(p.name, M, y);
      const tags = [p.location, p.severity, p.confidence != null ? `${Math.round(p.confidence * 100)}% conf.` : null]
        .filter(Boolean)
        .join("  ·  ");
      if (tags) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(...MUTED);
        doc.text(tags, PW - M, y, { align: "right" });
      }
      y += 14;
      if (p.description) body(p.description);
      y += 4;
    }
  }

  if (ext?.impression) {
    heading("Impression");
    doc.setFont("times", "italic");
    doc.setFontSize(11.5);
    doc.setTextColor(...INK);
    const lines = doc.splitTextToSize(ext.impression, CW - 16) as string[];
    for (const l of lines) {
      space(18);
      doc.text(l, M + 8, y);
      y += 16;
    }
  }

  if (ext?.differential_diagnosis?.length) {
    heading("Differential diagnosis");
    bullets(ext.differential_diagnosis);
  }

  if (ext?.recommendations?.length) {
    heading("Recommendations");
    bullets(ext.recommendations);
  }

  if (ext?.values?.length) {
    heading("Measured values");
    for (const v of ext.values) {
      space(18);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.setTextColor(...INK);
      doc.text(doc.splitTextToSize(v.name, CW * 0.5) as string[], M, y, { maxWidth: CW * 0.5 });
      doc.setFont("helvetica", "bold");
      doc.text(`${v.value}${v.unit ? ` ${v.unit}` : ""}`, M + CW * 0.55, y);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...MUTED);
      doc.setFontSize(8);
      doc.text(v.range ?? v.flag ?? "—", PW - M, y, { align: "right" });
      y += 16;
    }
  }

  if (ext?.medicines?.length) {
    heading("Medicines");
    body(ext.medicines.join(" · "));
  }

  if (report.explanation) {
    heading("Plain-language explanation");
    body(report.explanation);
  }

  if (opts.imageDataUrl) {
    try {
      const props = doc.getImageProperties(opts.imageDataUrl);
      const maxH = 420;
      let w = CW;
      let h = (props.height / props.width) * w;
      if (h > maxH) {
        h = maxH;
        w = (props.width / props.height) * h;
      }
      newPage();
      heading("Source image");
      doc.addImage(opts.imageDataUrl, M + (CW - w) / 2, y, w, h);
      y += h + 10;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.setTextColor(...MUTED);
      doc.text("Image as uploaded to MedVault AI.", M, y);
    } catch {
      /* image not embeddable — skip */
    }
  }

  footer();
  return doc.output("blob");
}
