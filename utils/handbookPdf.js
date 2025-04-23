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

  // Ensure output directories exist
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
  }

  // Debug text logs only
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
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--no-zygote',
        '--no-first-run',
        '--disable-features=site-per-process',
      ],
      timeout: 60000,
    });
    console.log('[PDF] Browser launched');

    page = await browser.newPage();

    // Capture browser logs
    page.on('console', (msg) => {
      consoleMessages.push(`[BROWSER CONSOLE] ${msg.text()}`);
    });

    page.on('request', (req) => {
      networkRequests.push(`Request: ${req.url()} (${req.resourceType()})`);
    });
    page.on('requestfinished', (req) => {
      networkRequests.push(`Finished: ${req.url()} (${req.resourceType()})`);
    });
    page.on('requestfailed', (req) => {
      networkRequests.push(`Failed: ${req.url()} (${req.resourceType()})`);
    });

    await page.setViewport({
      width: 794,
      height: 1123,
      deviceScaleFactor: 2,
    });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    );
    console.log('[PDF] Viewport set');

    console.log('[PDF] Navigating to target URL');
    const response = await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 120000,
    });

    if (!response.ok()) {
      throw new Error(`Page load failed with status ${response.status()}`);
    }

    console.log('[PDF] Waiting for assets to load');
    await page.evaluate(async () => {
      const waitForAssets = async () => {
        await Promise.all(
          Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(
            (link) =>
              new Promise((resolve) => {
                if (link.sheet) return resolve();
                link.addEventListener('load', resolve);
                link.addEventListener('error', resolve);
              })
          )
        );
        await document.fonts.ready;
        await Promise.all(
          Array.from(document.images).map((img) => {
            if (img.complete) return Promise.resolve();
            return new Promise((resolve) => {
              img.addEventListener('load', resolve);
              img.addEventListener('error', resolve);
            });
          })
        );
        await Promise.all(
          Array.from(document.querySelectorAll('iframe')).map(
            (iframe) =>
              new Promise((resolve) => {
                if (iframe.contentDocument?.readyState === 'complete')
                  return resolve();
                iframe.addEventListener('load', resolve);
                iframe.addEventListener('error', resolve);
              })
          )
        );
      };

      for (let i = 0; i < 3; i++) {
        await waitForAssets();
        await new Promise((r) => setTimeout(r, 500));
      }
    });

    await page.waitForFunction(() => document.fonts.ready, { timeout: 30000 });

    // Save logs
    fs.writeFileSync(debugPaths.pageHTML, await page.content());
    fs.writeFileSync(debugPaths.consoleLog, consoleMessages.join('\n'));
    fs.writeFileSync(debugPaths.networkLog, networkRequests.join('\n'));
    console.log('[PDF] Debug files saved');

    console.log('[PDF] Waiting for content');
    await page.waitForSelector('#handbook-pages .type-handbook-page', {
      timeout: 60000,
      visible: true,
    });

    const sections = await page.$$('#handbook-pages .type-handbook-page');
    if (sections.length === 0) {
      throw new Error('No handbook sections found');
    }
    console.log(`[PDF] Found ${sections.length} sections`);

    const buffers = [];
    for (let i = 0; i < sections.length; i++) {
      console.log(`[PDF] Processing section ${i + 1}/${sections.length}`);

      await page.evaluate((idx) => {
        document.querySelectorAll('.type-handbook-page').forEach((el) => {
          el.classList.remove('pdf-visible', 'pdf-hidden');
        });

        const pages = document.querySelectorAll('.type-handbook-page');
        pages[idx].classList.add('pdf-visible');

        Array.from(pages).forEach((el, j) => {
          if (j !== idx) el.classList.add('pdf-hidden');
        });
      }, i);

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const buf = await page.pdf({
        printBackground: true,
        width: '794px',
        height: '1123px',
        margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
        preferCSSPageSize: true,
        displayHeaderFooter: false,
      });
      buffers.push(buf);
    }

    console.log('[PDF] PDF generation complete');

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
    console.log(`[PDF] Saved PDF to ${filepath}`);
  } catch (err) {
    console.error('[PDF] ERROR:', err);
    if (page) {
      fs.writeFileSync(debugPaths.errorHTML, await page.content());
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};
