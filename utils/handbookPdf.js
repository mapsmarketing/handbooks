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

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    console.log('[PDF] Browser launched');

    page = await browser.newPage();

    // Optional: block JS if needed
    // await page.setRequestInterception(true);
    // page.on('request', req => {
    //   if (req.resourceType() === 'script') req.abort(); else req.continue();
    // });

    console.log('[PDF] Loading page');
    await page.setViewport({ width: 794, height: 1123 });
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 120000 });

    console.log('[PDF] Waiting for content');
    await page.waitForSelector('#handbook-pages .type-handbook-page', {
      timeout: 60000,
      visible: true,
    });

    const sections = await page.$$('#handbook-pages .type-handbook-page');
    console.log(`[PDF] Found ${sections.length} sections`);

    const buffers = [];
    for (let i = 0; i < sections.length; i++) {
      console.log(`[PDF] Processing section ${i + 1}/${sections.length}`);
      await page.evaluate((idx) => {
        const pages = document.querySelectorAll(
          '#handbook-pages .type-handbook-page'
        );
        pages.forEach((el, j) => {
          el.style.display = j === idx ? 'block' : 'none';
        });
      }, i);

      await new Promise((r) => setTimeout(r, 1000));

      const buf = await page.pdf({
        printBackground: true,
        width: '794px',
        height: '1123px',
        margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
      });
      buffers.push(buf);
    }

    console.log('[PDF] Merging PDFs');
    const mergedPdf = await PDFDocument.create();
    for (const buf of buffers) {
      const doc = await PDFDocument.load(buf);
      const [p] = await mergedPdf.copyPages(doc, [0]);
      mergedPdf.addPage(p);
    }

    const finalPdf = await mergedPdf.save();
    const filename = `handbook-${uuidv4()}.pdf`;
    const filepath = path.join(outDir, filename);
    fs.writeFileSync(filepath, finalPdf);

    console.log('[PDF] Final PDF saved:', filepath);
    return { filename, filepath };
  } catch (err) {
    console.error('[PDF] CRITICAL ERROR:', err);
    throw err;
  } finally {
    if (browser) await browser.close();
  }
};
