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
  };

  let browser;
  let page;
  const consoleMessages = [];

  try {
    // Launch browser with minimal restrictions
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
      timeout: 60000,
    });
    console.log('[PDF] Browser launched');

    page = await browser.newPage();

    // Capture console messages
    page.on('console', (msg) => {
      consoleMessages.push(`[BROWSER CONSOLE] ${msg.text()}`);
    });

    // Configure viewport
    await page.setViewport({
      width: 794,
      height: 1123,
      deviceScaleFactor: 2,
    });
    console.log('[PDF] Viewport set');

    // Configure request handling - ONLY BLOCK UNNECESSARY SCRIPTS
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      // Block only non-essential JavaScript requests
      if (req.resourceType() === 'script') {
        const allowedScripts = [
          'mapsmarketing.com.au', // Your domain
          'jquery', // Common libraries
          'wp-content', // WordPress scripts
        ];
        if (!allowedScripts.some((url) => req.url().includes(url))) {
          req.abort();
        } else {
          req.continue();
        }
      } else {
        // Allow all other resources (CSS, images, fonts, etc.)
        req.continue();
      }
    });

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
      const selectors = Array.from(
        document.querySelectorAll('img, link[rel="stylesheet"]')
      );
      await Promise.all(
        selectors.map((el) => {
          if (el.complete || (el.tagName === 'LINK' && el.sheet)) return;
          return new Promise((resolve) => {
            el.addEventListener('load', resolve);
            el.addEventListener('error', resolve);
          });
        })
      );
    });

    // Initial debug saves
    await page.screenshot({ path: debugPaths.initialScreen, fullPage: true });
    fs.writeFileSync(debugPaths.pageHTML, await page.content());
    fs.writeFileSync(debugPaths.consoleLog, consoleMessages.join('\n'));
    console.log('[PDF] Initial debug files saved');

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

    // Generate PDFs
    const buffers = [];
    for (let i = 0; i < sections.length; i++) {
      console.log(`[PDF] Processing section ${i + 1}/${sections.length}`);

      try {
        // Simply focus on the current section without modifying styles
        await page.evaluate((idx) => {
          document.querySelectorAll('.type-handbook-page').forEach((el, j) => {
            el.scrollIntoView();
          });
          // Let the natural CSS handle visibility
        }, i);

        // Add delay to ensure proper rendering
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const buf = await page.pdf({
          printBackground: true,
          width: '794px',
          height: '1123px',
          margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
          timeout: 30000,
          preferCSSPageSize: true,
        });
        buffers.push(buf);
      } catch (sectionErr) {
        console.error(`[PDF] Error processing section ${i + 1}:`, sectionErr);
        await page.screenshot({
          path: path.join(debugDir, `section-error-${i}.png`),
        });
        throw sectionErr;
      }
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
