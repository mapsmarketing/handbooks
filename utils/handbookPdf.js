const puppeteer = require('puppeteer');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

module.exports = async function generateHandbookPdf(targetUrl) {
  console.log('[PDF] Starting PDF generation');
  console.log('[PDF] Target URL:', targetUrl);

  const outDir = path.join(__dirname, '..', 'output');
  const debugDir = path.join(outDir, 'debug');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

  const debugPaths = {
    screenshot: path.join(debugDir, 'screenshot.png'),
    html: path.join(debugDir, 'page.html'),
    console: path.join(debugDir, 'console.txt'),
    errorShot: path.join(debugDir, 'error.png'),
    errorHtml: path.join(debugDir, 'error.html'),
  };

  const consoleMessages = [];
  let browser, page;

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox'],
      timeout: 60000,
      dumpio: true,
    });
    page = await browser.newPage();

    page.on('console', (msg) =>
      consoleMessages.push(`[BROWSER] ${msg.text()}`)
    );

    // Block only JS files, load everything else
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.resourceType() === 'script') req.abort();
      else req.continue();
    });

    await page.setViewport({ width: 1200, height: 1600 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91 Safari/537.36'
    );

    console.log('[PDF] Navigating...');
    const response = await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 90000,
    });
    if (!response.ok())
      throw new Error(`Page load failed with status ${response.status()}`);

    await new Promise((r) => setTimeout(r, 2000)); // Just give it a couple seconds

    // Save debug snapshot
    await page.screenshot({ path: debugPaths.screenshot, fullPage: true });
    fs.writeFileSync(debugPaths.html, await page.content());
    fs.writeFileSync(debugPaths.console, consoleMessages.join('\n'));

    const pdfPath = path.join(outDir, `handbook-${uuidv4()}.pdf`);
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      printBackground: true,
      margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
    });

    console.log('[PDF] PDF saved:', pdfPath);
    return { filepath: pdfPath };
  } catch (err) {
    console.error('[PDF] CRITICAL ERROR:', err);
    if (page) {
      try {
        await page.screenshot({ path: debugPaths.errorShot });
        fs.writeFileSync(debugPaths.errorHtml, await page.content());
      } catch (dbgErr) {
        console.error('[PDF] Debug save failed:', dbgErr);
      }
    }
    throw err;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
};
