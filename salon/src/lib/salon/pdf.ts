import { workFromText } from "./memory";

export async function ingestPdfFile(file: File) {
  if (file.size > 12 * 1024 * 1024) {
    return { ok: false as const, error: "pdf trop lourd" };
  }
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url,
  ).toString();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  const limit = Math.min(doc.numPages, 80);
  for (let i = 1; i <= limit; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    pages.push(line);
    if (pages.join(" ").length > 90_000) break;
  }
  const text = pages.join("\n").replace(/\s+/g, " ").trim();
  if (text.length < 200) return { ok: false as const, error: "pdf sans texte" };
  const title = file.name.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ");
  const packed = workFromText(title, `pdf:${file.name}`, "pdf", text.slice(0, 90_000));
  return { ok: true as const, work: packed.work, passages: packed.passages };
}

export async function ingestTextFile(file: File) {
  if (file.size > 4 * 1024 * 1024) {
    return { ok: false as const, error: "texte trop lourd" };
  }
  const text = (await file.text()).replace(/\u0000/g, "").trim();
  if (text.length < 200) return { ok: false as const, error: "texte trop court" };
  const title = file.name.replace(/\.(txt|text|md)$/i, "").replace(/[_-]+/g, " ");
  const packed = workFromText(title, `file:${file.name}`, "txt", text.slice(0, 90_000));
  return { ok: true as const, work: packed.work, passages: packed.passages };
}

export async function ingestLocalFile(file: File) {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) {
    return ingestPdfFile(file);
  }
  if (
    file.type.startsWith("text/") ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".text")
  ) {
    return ingestTextFile(file);
  }
  return { ok: false as const, error: "format" };
}
