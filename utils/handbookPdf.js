const puppeteer = require('puppeteer');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

module.exports = async function generateHandbookPdf(targetUrl) {
  console.log('[PDF] Starting PDF generation');
  console.log('[PDF] Target URL:', targetUrl);

  const outDir = path.join(__dirname, '..', 'output');
  const debugDir = path.join(outDir, 'debug');

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

  const debugPaths = {
    pageHTML: path.join(debugDir, 'page-content.html'),
    errorHTML: path.join(debugDir, 'error-content.html'),
    consoleLog: path.join(debugDir, 'console-log.txt'),
    networkLog: path.join(debugDir, 'network-requests.txt'),
  };

  let browser;
  let page;
  const consoleMessages = [];
  const networkRequests = [];

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      timeout: 90000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--enable-software-rasterizer',
        '--disable-gpu',
        '--disable-accelerated-2d-canvas',
        '--disable-features=site-per-process',
        '--disable-features=VizDisplayCompositor',
        '--no-first-run',
        '--no-zygote',
      ],
      dumpio: true,
    });
    console.log('[PDF] Browser launched');

    page = await browser.newPage();

    await page.setViewport({
      width: 794,
      height: 1123,
      deviceScaleFactor: 2,
    });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    );

    // Track console messages
    page.on('console', msg => {
      const type = msg.type().toUpperCase();
      const args = msg.args().map(a => a.toString()).join(' ');
      consoleMessages.push(`[${type}] ${args}`);
    });

    // Track failed requests
    page.on('requestfailed', request => {
      const errMsg = `[FAILED] ${request.url()} - ${request.failure()?.errorText}`;
      networkRequests.push(errMsg);
      console.error(errMsg);
    });

    // Track successful requests
    page.on('requestfinished', request => {
      networkRequests.push(`[OK] ${request.url()}`);
    });

    console.log('[PDF] Navigating to target URL');
    const response = await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 120000,
    });

    if (!response.ok()) {
      throw new Error(`Page load failed with status ${response.status()}`);
    }

    fs.writeFileSync(debugPaths.pageHTML, await page.content());
    fs.writeFileSync(debugPaths.consoleLog, consoleMessages.join('\n'));
    fs.writeFileSync(debugPaths.networkLog, networkRequests.join('\n'));

    console.log('[PDF] Waiting for content');
    await page.waitForSelector('#handbook-pages .type-handbook-page', {
      timeout: 60000,
      visible: true,
    });

    // Extra assurance that styles like background images are loaded
    await page.waitForFunction(() => {
      const el = document.querySelector('.type-handbook-page');
      return el && window.getComputedStyle(el).backgroundImage !== 'none';
    }, { timeout: 30000 });

    const sections = await page.$$('#handbook-pages .type-handbook-page');
    if (sections.length === 0) {
      throw new Error('No handbook sections found');
    }
    console.log(`[PDF] Found ${sections.length} sections`);

    const buffers = [];
    for (let i = 0; i < sections.length; i++) {
      console.log(`[PDF] Processing section ${i + 1}/${sections.length}`);

      await page.evaluate((idx) => {
        const pages = document.querySelectorAll('.type-handbook-page');
        pages.forEach((el, j) => {
          el.style.display = j === idx ? 'block' : 'none';
          el.style.opacity = '1';
          el.style.visibility = 'visible';
        });
      }, i);

      // Give rendering time before snapshot
      await new Promise(resolve => setTimeout(resolve, 1500));
      await page.evaluate(() => {
        return new Promise(resolve => {
          requestAnimationFrame(() => {
            document.body.offsetHeight; // force reflow
            setTimeout(resolve, 500);
          });
        });
      });

      const buf = await page.pdf({
        printBackground: true,
        width: '794px',
        height: '1123px',
        margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
        timeout: 30000,
        preferCSSPageSize: true,
        displayHeaderFooter: false,
      });

      buffers.push(buf);
    }

    const mergedPdf = await PDFDocument.create();
    for (const buf of buffers) {
      const doc = await PDFDocument.load(buf);
      const [page] = await mergedPdf.copyPages(doc, [0]);
      mergedPdf.addPage(page);
    }

    const finalPdf = await mergedPdf.save();
    const filename = `handbook-${uuidv4()}.pdf`;
    const filepath = path.join(outDir, filename);
    fs.writeFileSync(filepath, finalPdf);
    console.log('[PDF] Final PDF saved:', filepath);

    return { filename, filepath };

  } catch (err) {
    console.error('[PDF] CRITICAL ERROR:', err);

    try {
      if (page) {
        fs.writeFileSync(debugPaths.errorHTML, await page.content());
      }
      fs.appendFileSync(debugPaths.consoleLog, `\n\nERROR: ${err.stack}`);
      fs.appendFileSync(debugPaths.networkLog, `\n\nERROR: ${err.stack}`);
    } catch (debugErr) {
      console.error('[PDF] Debug save failed:', debugErr);
    }

    throw err;
  } finally {
    if (browser) {
      await browser.close().catch((err) => {
        console.error('[PDF] Browser close error:', err);
      });
    }
  }
};
