/**
 * OCR Worker Script
 * Called as a child process to render PDF pages to PNG and run Tesseract OCR.
 * Runs isolated from the Express server to avoid @napi-rs/canvas context conflicts.
 * 
 * Input (stdin JSON): { pdfPath, pages, tesseractCachePath }
 * Output (stdout JSON): { text, pageCount, pagesOcrd }
 * Errors (stderr): error message, exit code 1
 */

import { pdfToPng } from 'pdf-to-png-converter';
import Tesseract from 'tesseract.js';
import { readFileSync } from 'fs';

const input = JSON.parse(readFileSync('/dev/fd/3', 'utf8').trim());

const { pdfPath, pages, tesseractCachePath } = input;

try {
  const worker = await Tesseract.createWorker('eng', 1, {
    cachePath: tesseractCachePath,
    logger: () => {},
  });

  const ocrParts = [];
  let pagesOcrd = 0;

  for (const pageNum of pages) {
    try {
      const rendered = await pdfToPng(pdfPath, {
        disableFontFace: true,
        useSystemFonts: false,
        viewportScale: 1.5,
        pagesToProcess: [pageNum],
        concurrencyLimit: 1,
      });

      if (rendered[0]?.content) {
        const { data } = await worker.recognize(rendered[0].content);
        if (data.text.trim().length > 0) {
          ocrParts.push(data.text.trim());
          pagesOcrd++;
        }
      }
    } catch {
      // Skip pages that fail to render
    }
  }

  await worker.terminate();

  process.stdout.write(JSON.stringify({
    text: ocrParts.join('\n\n---\n\n'),
    pageCount: pages.length,
    pagesOcrd,
  }));
  process.exit(0);
} catch (err) {
  process.stderr.write(err.message || String(err));
  process.exit(1);
}
