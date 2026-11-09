/** Export helpers shared by the editor (pure where possible, unit-tested). */

export type ExportFormat = 'png' | 'jpg' | 'pdf';

/** A filesystem-safe ASCII file name from the design title (browsers drop non-ASCII blob download names). */
export function exportFileName(title: string, format: ExportFormat, width: number, height: number): string {
  const base =
    title
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .toLowerCase()
      .slice(0, 60) || 'design';
  return `${base}-${width}x${height}.${format}`;
}

/** PDF page geometry in points for a pixel canvas (72pt per inch at 96 dpi → 0.75pt/px). */
export function pdfPage(width: number, height: number): { orientation: 'portrait' | 'landscape'; format: [number, number] } {
  const w = width * 0.75;
  const h = height * 0.75;
  return { orientation: w > h ? 'landscape' : 'portrait', format: [w, h] };
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body = ''] = dataUrl.split(',');
  const mime = /data:([^;]+)/.exec(head ?? '')?.[1] ?? 'application/octet-stream';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Single-page PDF with the rendered design filling the page. */
export async function buildPdf(jpegDataUrl: string, width: number, height: number): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const page = pdfPage(width, height);
  const pdf = new jsPDF({ orientation: page.orientation, unit: 'pt', format: page.format, compress: true });
  pdf.addImage(jpegDataUrl, 'JPEG', 0, 0, page.format[0], page.format[1]);
  return pdf.output('blob');
}
