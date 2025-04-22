const puppeteer = require('puppeteer');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

module.exports = async function generateHandbookPdf(targetUrl) {
  console.log('[PDF] Starting PDF generation');
  console.log('[PDF] Target URL:', targetUrl);

  const outDir = path.join(__dirname, '..', 'output');
  const screenPath = path.join(outDir, 'debug-screenshot.png');
  const htmlPath = path.join(outDir, 'debug-page.html');

  try {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    console.log('[PDF] Browser launched');

    await page.setViewport({ width: 794, height: 1123 });
    console.log('[PDF] Viewport set');

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    console.log('[PDF] Page loaded');

    await page.waitForSelector('#handbook-pages .type-handbook-page', { timeout: 10000 });
    console.log('[PDF] Selector found: #handbook-pages .type-handbook-page');

    await page.emulateMediaType('screen');
    console.log('[PDF] Emulating media type screen');

    const sections = await page.$$('#handbook-pages .type-handbook-page');
    console.log('[PDF] Sections found:', sections.length);

    if (sections.length === 0) {
      await page.screenshot({ path: screenPath, fullPage: true });
      const html = await page.content();
      fs.writeFileSync(htmlPath, html);
      throw new Error('[PDF] No sections found — likely rendering issue on page');
    }

    const buffers = [];
    for (let i = 0; i < sections.length; i++) {
      console.log(`[PDF] Rendering section ${i + 1}/${sections.length}`);
      await page.evaluate((idx) => {
        document
          .querySelectorAll('#handbook-pages .type-handbook-page')
          .forEach((el, j) => (el.style.display = j === idx ? 'block' : 'none'));
      }, i);

      const buf = await page.pdf({
        printBackground: true,
        width: '794px',
        height: '1123px',
        margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
      });
      buffers.push(buf);
    }

    await page.screenshot({ path: screenPath, fullPage: true });
    const html = await page.content();
    fs.writeFileSync(htmlPath, html);
    console.log('[PDF] Screenshot and HTML saved');

    await browser.close();
    console.log('[PDF] Browser closed');

    const merged = await PDFDocument.create();
    for (const buf of buffers) {
      const doc = await PDFDocument.load(buf);
      const [page] = await merged.copyPages(doc, [0]);
      merged.addPage(page);
    }

    const finalPdf = await merged.save();
    const filename = `handbook-${uuidv4()}.pdf`;
    const filepath = path.join(outDir, filename);

    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
    fs.writeFileSync(filepath, finalPdf);
    console.log('[PDF] Final PDF saved at:', filepath);

    return { filename, filepath };
  } catch (err) {
    console.error('[PDF] ERROR:', err.message || err);
    return Promise.reject(err);
  }
};
