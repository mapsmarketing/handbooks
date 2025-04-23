const puppeteer = require('puppeteer');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

module.exports = async function generateHandbookPdf(targetUrl) {
  console.log('[PDF] Starting PDF generation');
  console.log('[PDF] Target URL:', targetUrl);

  const outDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  let browser, page;
  const consoleMessages = [];

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    console.log('[PDF] Browser launched');

    page = await browser.newPage();

    // Capture console logs
    page.on('console', (msg) => {
      consoleMessages.push(`[BROWSER CONSOLE] ${msg.text()}`);
    });

    // Block JavaScript only (allow CSS, images, fonts, etc.)
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      req.resourceType() === 'script' ? req.abort() : req.continue();
    });

    console.log('[PDF] Loading page (JS disabled)');
    await page.goto(targetUrl, {
      waitUntil: 'networkidle0',
      timeout: 120000,
    });

    // Wait for content (no style modifications)
    console.log('[PDF] Waiting for content');
    await page.waitForSelector('#handbook-pages .type-handbook-page', {
      timeout: 60000,
      visible: true,
    });

    // Generate PDFs (NO STYLE OVERRIDES)
    const buffers = [];
    const sections = await page.$$('#handbook-pages .type-handbook-page');
    console.log(`[PDF] Found ${sections.length} sections`);

    for (let i = 0; i < sections.length; i++) {
      console.log(`[PDF] Processing section ${i + 1}/${sections.length}`);

      // Simply show the current section (no inline styles)
      // await page.evaluate((idx) => {
      //   document.querySelectorAll('.type-handbook-page').forEach((el, j) => {
      //     el.style.display = j === idx ? '' : 'none'; // Reset to default if showing
      //   });
      // }, i);

      await new Promise((resolve) => setTimeout(resolve, 1000)); // Small delay

      const buf = await page.pdf({
        printBackground: true,
        width: '794px',
        height: '1123px',
        margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
      });
      buffers.push(buf);
    }

    // Merge PDFs
    const mergedPdf = await PDFDocument.create();
    for (const buf of buffers) {
      const doc = await PDFDocument.load(buf);
      const [page] = await mergedPdf.copyPages(doc, [0]);
      mergedPdf.addPage(page);
    }

    // Save final PDF
    const finalPdf = await mergedPdf.save();
    const filename = `handbook-${uuidv4()}.pdf`;
    const filepath = path.join(outDir, filename);
    fs.writeFileSync(filepath, finalPdf);
    console.log('[PDF] Final PDF saved:', filepath);

    return { filename, filepath };
  } catch (err) {
    console.error('[PDF] ERROR:', err);
    throw err;
  } finally {
    if (browser) await browser.close();
  }
};
