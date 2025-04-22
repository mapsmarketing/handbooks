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
  const initialScreenPath = path.join(outDir, 'initial-load.png');
  const failedLoadPath = path.join(outDir, 'failed-load.html');

  // Ensure output directory exists
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  try {
    const browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
      ],
    });
    console.log('[PDF] Browser launched');

    const page = await browser.newPage();
    await page.setViewport({ width: 794, height: 1123 });
    console.log('[PDF] Viewport set');

    // Set user agent to mimic a real browser
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    );

    // Enable request interception to monitor network activity
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      request.continue();
    });

    console.log('[PDF] Navigating to target URL');
    const response = await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000,
    });

    if (!response.ok()) {
      throw new Error(`Page load failed with status ${response.status()}`);
    }

    // Take initial screenshot for debugging
    await page.screenshot({ path: initialScreenPath });
    console.log('[PDF] Initial screenshot saved');

    // Verify handbook container exists
    console.log('[PDF] Checking for handbook container');
    const containerExists = await page.evaluate(() => {
      return !!document.querySelector('#handbook-pages');
    });

    if (!containerExists) {
      const html = await page.content();
      fs.writeFileSync(failedLoadPath, html);
      throw new Error(
        'Handbook container not found in DOM - saved failed-load.html'
      );
    }

    // Wait for pages to load with increased timeout
    console.log('[PDF] Waiting for handbook pages');
    await page.waitForSelector('#handbook-pages .type-handbook-page', {
      timeout: 60000,
      visible: true,
    });

    console.log('[PDF] Handbook pages are now present');
    await page.emulateMediaType('screen');

    // Get all sections
    const sections = await page.$$('#handbook-pages .type-handbook-page');
    console.log('[PDF] Sections found:', sections.length);

    if (sections.length === 0) {
      await page.screenshot({ path: screenPath, fullPage: true });
      const html = await page.content();
      fs.writeFileSync(htmlPath, html);
      throw new Error(
        '[PDF] No sections found — likely rendering issue on page'
      );
    }

    // Process each section
    const buffers = [];
    for (let i = 0; i < sections.length; i++) {
      console.log(`[PDF] Rendering section ${i + 1}/${sections.length}`);
      await page.evaluate((idx) => {
        document
          .querySelectorAll('#handbook-pages .type-handbook-page')
          .forEach(
            (el, j) => (el.style.display = j === idx ? 'block' : 'none')
          );
      }, i);

      const buf = await page.pdf({
        printBackground: true,
        width: '794px',
        height: '1123px',
        margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
      });
      buffers.push(buf);
    }

    // Save debug files
    await page.screenshot({ path: screenPath, fullPage: true });
    const html = await page.content();
    fs.writeFileSync(htmlPath, html);
    console.log('[PDF] Screenshot and HTML saved');

    await browser.close();
    console.log('[PDF] Browser closed');

    // Merge PDFs
    const merged = await PDFDocument.create();
    for (const buf of buffers) {
      const doc = await PDFDocument.load(buf);
      const [page] = await merged.copyPages(doc, [0]);
      merged.addPage(page);
    }

    // Save final PDF
    const finalPdf = await merged.save();
    const filename = `handbook-${uuidv4()}.pdf`;
    const filepath = path.join(outDir, filename);
    fs.writeFileSync(filepath, finalPdf);
    console.log('[PDF] Final PDF saved at:', filepath);

    return { filename, filepath };
  } catch (err) {
    console.error('[PDF] ERROR:', err);
    console.error('[PDF] Stack:', err.stack);

    // Try to save any available debug info
    try {
      if (page) {
        await page.screenshot({
          path: path.join(outDir, 'error-screenshot.png'),
        });
        const html = await page.content();
        fs.writeFileSync(path.join(outDir, 'error-page.html'), html);
      }
    } catch (debugErr) {
      console.error('[PDF] Debug save failed:', debugErr);
    }

    if (browser) await browser.close();
    return Promise.reject(err);
  }
};
