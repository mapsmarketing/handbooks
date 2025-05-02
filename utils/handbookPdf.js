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

  let browser;
  let page;

  try {
    // Launch browser with more robust settings
    browser = await puppeteer.launch({
      headless: true, //'new',
      timeout: 90000,
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
    await page.setExtraHTTPHeaders({
      'x-custom-auth':
        '18aa1c8ad36525b7c974a672d1ad08ee8bccd35b670c16f980dab3d32cc253a5',
    });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_3_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.5735.133 Safari/537.36'
    );
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

    await page.evaluate(async () => {
      const images = Array.from(document.images);
      await Promise.all(
        images.map((img) => {
          if (img.complete) return;
          return new Promise((resolve) => {
            img.onload = img.onerror = resolve;
          });
        })
      );
    });

    // Show all pages
    await page.evaluate(() => {
      const pages = document.querySelectorAll('.type-handbook-page');
      pages.forEach((el) => {
        el.style.display = 'block';
        el.style.opacity = '1';
        el.style.visibility = 'visible';
      });
    });

    // Allow some time for all to render
    await new Promise((resolve) => setTimeout(resolve, 2500));

    // Generate one PDF for all
    const buf = await page.pdf({
      printBackground: true,
      width: '794px',
      height: '1123px',
      margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
      timeout: 30000,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
    });

    // Save result
    const mergedPdf = await PDFDocument.load(buf);
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
    if (browser) {
      await browser.close().catch((err) => {
        console.error('[PDF] Browser close error:', err);
      });
    }
  }
};
