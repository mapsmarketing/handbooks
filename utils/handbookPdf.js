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

  // Debug file paths
  const debugPaths = {
    initialScreen: path.join(debugDir, 'initial-load.png'),
    finalScreen: path.join(debugDir, 'final-screenshot.png'),
    errorScreen: path.join(debugDir, 'error-screenshot.png'),
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
    // Launch browser with more robust settings
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-features=site-per-process',
      ],
      timeout: 60000,
      dumpio: true,
    });
    console.log('[PDF] Browser launched');

    page = await browser.newPage();

    // Capture console messages
    page.on('console', (msg) => {
      consoleMessages.push(`[BROWSER CONSOLE] ${msg.text()}`);
    });

    // Log network requests
    page.on('request', (request) => {
      networkRequests.push(
        `Request: ${request.url()} (${request.resourceType()})`
      );
    });
    page.on('requestfinished', (request) => {
      networkRequests.push(
        `Finished: ${request.url()} (${request.resourceType()})`
      );
    });
    page.on('requestfailed', (request) => {
      networkRequests.push(
        `Failed: ${request.url()} (${request.resourceType()})`
      );
    });

    // Configure viewport and user agent
    await page.setViewport({
      width: 794,
      height: 1123,
      deviceScaleFactor: 2,
    });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    );
    console.log('[PDF] Viewport set');

    // Allow ALL resources to load
    console.log('[PDF] Navigating to target URL');
    const response = await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 120000,
    });

    if (!response.ok()) {
      throw new Error(`Page load failed with status ${response.status()}`);
    }

    // Wait for all assets to load
    console.log('[PDF] Waiting for assets to load');
    await page.evaluate(async () => {
      const waitForAssets = async () => {
        // Wait for stylesheets
        await Promise.all(
          Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(
            (link) => {
              return new Promise((resolve) => {
                if (link.sheet) return resolve();
                link.addEventListener('load', resolve);
                link.addEventListener('error', resolve);
              });
            }
          )
        );

        // Wait for fonts
        await document.fonts.ready;

        // Wait for images (including background images)
        await Promise.all(
          Array.from(document.images).map((img) => {
            if (img.complete) return Promise.resolve();
            return new Promise((resolve) => {
              img.addEventListener('load', resolve);
              img.addEventListener('error', resolve);
            });
          })
        );

        // Wait for iframes
        await Promise.all(
          Array.from(document.querySelectorAll('iframe')).map((iframe) => {
            return new Promise((resolve) => {
              if (iframe.contentDocument?.readyState === 'complete')
                return resolve();
              iframe.addEventListener('load', resolve);
              iframe.addEventListener('error', resolve);
            });
          })
        );
      };

      // Try multiple times to ensure everything loads
      for (let i = 0; i < 3; i++) {
        await waitForAssets();
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    });

    // Additional wait for dynamic content
    await page.waitForFunction(() => document.fonts.ready, { timeout: 30000 });

    // Debug saves
    await page.screenshot({ path: debugPaths.initialScreen, fullPage: true });
    fs.writeFileSync(debugPaths.pageHTML, await page.content());
    fs.writeFileSync(debugPaths.consoleLog, consoleMessages.join('\n'));
    fs.writeFileSync(debugPaths.networkLog, networkRequests.join('\n'));
    console.log('[PDF] Debug files saved');

    // Wait for content
    console.log('[PDF] Waiting for content');
    await page.waitForSelector('#handbook-pages .type-handbook-page', {
      timeout: 60000,
      visible: true,
    });

    // Verify content exists
    const sections = await page.$$('#handbook-pages .type-handbook-page');
    if (sections.length === 0) {
      throw new Error('No handbook sections found');
    }
    console.log(`[PDF] Found ${sections.length} sections`);

    // Generate PDFs - NEW APPROACH THAT PRESERVES STYLES
    const buffers = [];
    for (let i = 0; i < sections.length; i++) {
      console.log(`[PDF] Processing section ${i + 1}/${sections.length}`);

      // NEW: Toggle visibility using class names instead of inline styles
      await page.evaluate((idx) => {
        // First reset all sections
        document.querySelectorAll('.type-handbook-page').forEach((el) => {
          el.classList.remove('pdf-visible', 'pdf-hidden');
        });

        // Then set current section
        const pages = document.querySelectorAll('.type-handbook-page');
        pages[idx].classList.add('pdf-visible');

        // Hide others without affecting their styles
        Array.from(pages).forEach((el, j) => {
          if (j !== idx) el.classList.add('pdf-hidden');
        });
      }, i);

      // Add delay to ensure proper rendering
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Generate PDF for current section
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

    // Final debug saves
    await page.screenshot({ path: debugPaths.finalScreen, fullPage: true });
    console.log('[PDF] PDF generation complete');

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
    console.error('[PDF] CRITICAL ERROR:', err);

    try {
      if (page) {
        await page.screenshot({ path: debugPaths.errorScreen });
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
