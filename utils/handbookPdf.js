const puppeteer = require('puppeteer');
const { PDFDocument } = require('pdf-lib');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

module.exports = async function generateHandbookPdf(targetUrl) {
  console.log('[PDF] Starting PDF generation');
  console.log('[PDF] Target URL:', targetUrl);

  const outDir   = path.join(__dirname, '..', 'output');
  const debugDir = path.join(outDir, 'debug');

  // Ensure output directories exist
  if (!fs.existsSync(outDir))   fs.mkdirSync(outDir,   { recursive: true });
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

  const debugPaths = {
    initialScreen: path.join(debugDir, 'initial-load.png'),
    finalScreen:   path.join(debugDir, 'final-screenshot.png'),
    errorScreen:   path.join(debugDir, 'error-screenshot.png'),
    pageHTML:      path.join(debugDir, 'page-content.html'),
    errorHTML:     path.join(debugDir, 'error-content.html'),
    consoleLog:    path.join(debugDir, 'console-log.txt')
  };

  let browser, page;
  const consoleMessages = [];

  try {
    // 1) Launch Puppeteer
    browser = await puppeteer.launch({
      headless: true,   // use classic headless
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--single-process',
        '--no-zygote',
        '--disable-features=site-per-process',
        '--disable-web-security'
      ],
      timeout: 60000,
      dumpio: true
    });
    console.log('[PDF] Browser launched');

    page = await browser.newPage();

    // 2) Capture console & debug logs
    page.on('console', msg => consoleMessages.push(`[BROWSER] ${msg.text()}`));
    await page.setRequestInterception(true);
    page.on('request', req => {
      // allow everything except images/fonts (keeps CSS)
      if (['image','font'].includes(req.resourceType())) req.abort();
      else                                         req.continue();
    });

    // 3) Viewport & UA
    await page.setViewport({ width: 794, height: 1123, deviceScaleFactor: 2 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
      'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    console.log('[PDF] Viewport set');

    // 4) Go to page & wait
    console.log('[PDF] Navigating to target URL');
    const response = await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 90000 });
    if (!response.ok()) throw new Error(`Page load failed: ${response.status()}`);

    // 5) Wait for CSS
    await page.evaluate(async () => {
      const loads = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
        .map(link => new Promise(r => {
          if (link.sheet) return r();
          link.addEventListener('load', r);
          link.addEventListener('error', r);
        }));
      await Promise.all(loads);
    });

    // 6) Initial debug snapshot + logs
    await page.screenshot({ path: debugPaths.initialScreen, fullPage: true });
    fs.writeFileSync(debugPaths.pageHTML, await page.content());
    fs.writeFileSync(debugPaths.consoleLog, consoleMessages.join('\n'));
    console.log('[PDF] Initial debug saved');

    // 7) Wait for your handbook pages
    console.log('[PDF] Waiting for content');
    try {
      await page.waitForSelector('#handbook-pages .type-handbook-page', {
        visible: true, timeout: 60000
      });
    } catch {
      console.log('[PDF] Fallback selector');
      await page.waitForFunction(
        () => document.querySelectorAll('.type-handbook-page').length > 0,
        { timeout: 30000 }
      );
    }

    const sections = await page.$$('.type-handbook-page');
    if (!sections.length) throw new Error('No handbook sections found');
    console.log(`[PDF] Found ${sections.length} sections`);

    // 8) Inject CSS for toggling
    await page.addStyleTag({
      content: `
        .pdf-hidden  { display: none !important; }
        .pdf-visible { display: block !important; }
      `
    });

    // 9) Generate one PDF buffer per section
    const buffers = [];
    for (let i = 0; i < sections.length; i++) {
      console.log(`[PDF] Processing section ${i+1}/${sections.length}`);
      await page.evaluate(idx => {
        document.querySelectorAll('.type-handbook-page').forEach((el, j) => {
          el.classList.toggle('pdf-visible', j === idx);
          el.classList.toggle('pdf-hidden',  j !== idx);
        });
      }, i);

      await new Promise(r => setTimeout(r, 1000));

      buffers.push(
        await page.pdf({
          printBackground: true,
          width: '794px',
          height: '1123px',
          margin: { top:0, right:0, bottom:0, left:0 },
          preferCSSPageSize: true
        })
      );
    }

    // 10) Final screenshot
    await page.screenshot({ path: debugPaths.finalScreen, fullPage: true });
    console.log('[PDF] Sections rendered');

    // 11) Merge & Save
    const mergedPdf = await PDFDocument.create();
    for (const buf of buffers) {
      const doc  = await PDFDocument.load(buf);
      const [pg] = await mergedPdf.copyPages(doc, [0]);
      mergedPdf.addPage(pg);
    }

    const finalPdf = await mergedPdf.save();
    const filename = `handbook-${uuidv4()}.pdf`;
    const filepath = path.join(outDir, filename);
    fs.writeFileSync(filepath, finalPdf);
    console.log('[PDF] Final PDF saved:', filepath);

    return { filename, filepath };

  } catch (err) {
    console.error('[PDF] CRITICAL ERROR:', err);

    // Debug error snapshot + HTML
    try {
      if (page) {
        await page.screenshot({ path: debugPaths.errorScreen, fullPage: true });
        fs.writeFileSync(debugPaths.errorHTML, await page.content());
      }
    } catch (dbgErr) {
      console.error('[PDF] Debug save failed:', dbgErr);
    }

    throw err;

  } finally {
    if (browser) await browser.close().catch(() => {});
  }
};
