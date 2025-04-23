const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

module.exports = async function generateHandbookPdf(targetUrl) {
  console.log('[PDF] Starting PDF generation');
  console.log('[PDF] Target URL:', targetUrl);

  const outDir = path.join(__dirname, '..', 'output');
  const debugDir = path.join(outDir, 'debug');

  // Ensure output directories exist
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

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

  let browser, page;
  const consoleMessages = [];
  const networkRequests = [];

  try {
    // Launch browser (no special optimizations)
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

    // Log network requests (for debugging)
    page.on('request', (req) =>
      networkRequests.push(`REQUEST: ${req.url()} (${req.resourceType()})`)
    );
    page.on('requestfinished', (req) =>
      networkRequests.push(`FINISHED: ${req.url()} (${req.resourceType()})`)
    );
    page.on('requestfailed', (req) =>
      networkRequests.push(`FAILED: ${req.url()} (${req.resourceType()})`)
    );

    // Block JavaScript only (allow CSS, images, fonts, etc.)
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      req.resourceType() === 'script' ? req.abort() : req.continue();
    });

    // Load page with all non-JS resources
    console.log('[PDF] Loading page (JavaScript disabled)');
    await page.goto(targetUrl, {
      waitUntil: 'networkidle0',
      timeout: 120000,
    });

    // Save initial debug files
    await page.screenshot({ path: debugPaths.initialScreen, fullPage: true });
    fs.writeFileSync(debugPaths.pageHTML, await page.content());
    fs.writeFileSync(debugPaths.consoleLog, consoleMessages.join('\n'));
    fs.writeFileSync(debugPaths.networkLog, networkRequests.join('\n'));
    console.log('[PDF] Debug files saved');

    // Generate PDF (NO STYLE MODIFICATIONS)
    const pdfPath = path.join(outDir, `handbook-${uuidv4()}.pdf`);
    await page.pdf({
      path: pdfPath,
      printBackground: true,
      width: '794px',
      height: '1123px',
      margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
    });
    console.log('[PDF] PDF generated:', pdfPath);

    // Final debug screenshot
    await page.screenshot({ path: debugPaths.finalScreen, fullPage: true });
    console.log('[PDF] Final screenshot saved');

    return { filename: path.basename(pdfPath), filepath: pdfPath };
  } catch (err) {
    console.error('[PDF] ERROR:', err);

    // Save error debug files
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
    if (browser)
      await browser
        .close()
        .catch((err) => console.error('[PDF] Browser close error:', err));
  }
};
