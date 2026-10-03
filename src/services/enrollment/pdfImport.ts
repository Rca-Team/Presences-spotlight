import { parseCardText } from './pdfParser';
import type { ImportCard } from './types';

export async function extractCards(file: File, columns: number, rows: number, progress: (message: string) => void, signal: AbortSignal): Promise<ImportCard[]> {
  if (file.size > 25 * 1024 * 1024) throw new Error('Use a PDF smaller than 25 MB.');
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer(), isEvalSupported: false }).promise;
  let worker: Awaited<ReturnType<typeof import('tesseract.js')['createWorker']>> | undefined;
  const cards: ImportCard[] = [];
  try {
    if (pdf.numPages > 30 || pdf.numPages * rows * columns > 150) throw new Error('Import at most 30 pages / 150 cards per batch.');
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      if (signal.aborted) throw new DOMException('Import cancelled', 'AbortError');
      progress(`Reading page ${pageNumber} of ${pdf.numPages}`);
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2.5, 2200 / Math.max(base.width, base.height)) });
      const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
      const content = await page.getTextContent();
      for (let row = 0; row < rows; row++) for (let col = 0; col < columns; col++) {
        if (signal.aborted) throw new DOMException('Import cancelled', 'AbortError');
        const x = col * canvas.width / columns, y = row * canvas.height / rows;
        const crop = document.createElement('canvas'); crop.width = canvas.width / columns; crop.height = canvas.height / rows;
        crop.getContext('2d')!.drawImage(canvas, x, y, crop.width, crop.height, 0, 0, crop.width, crop.height);
        const items = content.items.filter((item): item is import('pdfjs-dist/types/src/display/api').TextItem => 'str' in item).map(item => {
          const p = viewport.convertToViewportPoint(item.transform[4], item.transform[5]); return { text: item.str, x: p[0], y: p[1] };
        }).filter(p => p.x >= x && p.x < x + crop.width && p.y >= y && p.y < y + crop.height).sort((a, b) => Math.abs(a.y - b.y) < 5 ? a.x - b.x : a.y - b.y);
        let text = ''; let lastY = -100;
        for (const item of items) { text += (Math.abs(item.y - lastY) < 5 ? ' ' : '\n') + item.text; lastY = item.y; }
        if (text.replace(/\s/g, '').length < 30) {
          progress(`Reading scanned card ${row * columns + col + 1} on page ${pageNumber}`);
          if (!worker) { const { createWorker } = await import('tesseract.js'); worker = await createWorker('eng'); }
          text = (await worker.recognize(crop)).data.text;
        }
        if (text.trim().length < 5) continue;
        let portrait: string | undefined;
        try {
          const { loadRegistrationModels } = await import('@/services/face-recognition/OptimizedRegistrationService');
          await loadRegistrationModels();
          const faceapi = await import('face-api.js');
          const faces = await faceapi.detectAllFaces(crop, new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.45 }));
          if (faces.length === 1) {
            const b = faces[0].box, pad = b.width * 0.2;
            const sx = Math.max(0, b.x - pad), sy = Math.max(0, b.y - pad);
            const pic = document.createElement('canvas'); pic.width = 320; pic.height = 400;
            pic.getContext('2d')!.drawImage(crop, sx, sy, Math.min(crop.width - sx, b.width + 2 * pad), Math.min(crop.height - sy, b.height + 2 * pad), 0, 0, 320, 400);
            portrait = pic.toDataURL('image/jpeg', 0.85);
          }
        } catch { /* Portrait is optional; unreadable fields remain visible for staff review. */ }
        cards.push({ id: crypto.randomUUID(), student: parseCardText(text), page: pageNumber, text, preview: crop.toDataURL('image/jpeg', 0.8), portrait });
        crop.width = crop.height = 0;
      }
      canvas.width = canvas.height = 0; page.cleanup();
    }
    return cards;
  } finally { await worker?.terminate(); await pdf.destroy(); }
}
