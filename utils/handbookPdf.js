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
      // timeout: 90000,
      args: [
        '--no-sandbox',
        // '--disable-extensions',
        // '--enable-software-rasterizer',
        // '--disable-setuid-sandbox',
        // '--disable-dev-shm-usage',
        // '--disable-accelerated-2d-canvas',
        // '--no-first-run',
        // '--no-zygote',
        // '--disable-gpu',
        // '--disable-features=site-per-process',
        // '--disable-features=VizDisplayCompositor',
      ],
      // dumpio: true,
    });
    console.log('[PDF] Browser launched');

    page = await browser.newPage();

    // Configure viewport and user agent
    await page.setViewport({
      width: 794,
      height: 1123,
      // deviceScaleFactor: 2,
    });
    // await page.setUserAgent(
    //   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
    // );
    console.log('[PDF] Viewport set');

    // Allow ALL resources to load (remove request interception)
    console.log('[PDF] Navigating to target URL');
    const response = await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 120000, // Increased to 2 minutes for heavy pages
    });
    await page.emulateMediaType('screen');

    if (!response.ok()) {
      throw new Error(`Page load failed with status ${response.status()}`);
    }

    // Debug saves
    fs.writeFileSync(debugPaths.pageHTML, await page.content());
    fs.writeFileSync(debugPaths.consoleLog, consoleMessages.join('\n'));
    fs.writeFileSync(debugPaths.networkLog, networkRequests.join('\n'));
    console.log('[PDF] Debug files saved');

    // Wait for CSS files to be loaded
    await page.evaluate(async () => {
      const stylesheets = Array.from(document.styleSheets);

      // Filter for external stylesheets only
      const pendingStylesheets = stylesheets
        .filter((sheet) => !sheet.disabled && sheet.href)
        .map(
          (sheet) =>
            new Promise((resolve) => {
              if (sheet.ownerNode && sheet.ownerNode.tagName === 'LINK') {
                const linkEl = sheet.ownerNode;
                if (linkEl.sheet) {
                  resolve();
                } else {
                  linkEl.addEventListener('load', resolve);
                  linkEl.addEventListener('error', resolve); // fallback
                }
              } else {
                resolve(); // inline style or already loaded
              }
            })
        );

      await Promise.all(pendingStylesheets);
    });
    console.log('[PDF] CSS files loaded');

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

      await page.evaluate((idx) => {
        const pages = document.querySelectorAll('.type-handbook-page');
        pages.forEach((el, j) => {
          el.style.display = j === idx ? 'block' : 'none';
          el.style.opacity = '1';
          el.style.visibility = 'visible';
        });
      }, i);

      // Add delay to ensure proper rendering
      await new Promise((resolve) => setTimeout(resolve, 1500));

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
