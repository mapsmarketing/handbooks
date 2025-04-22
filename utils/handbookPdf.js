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
    consoleLog: path.join(debugDir, 'console-log.txt')
  };

  let browser;
  let page;
  const consoleMessages = [];

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
        '--disable-web-security'
      ],
      timeout: 60000,
      dumpio: true // Pipe browser console to Node.js
    });
    console.log('[PDF] Browser launched');

    page = await browser.newPage();
    
    // Capture console messages
    page.on('console', msg => {
      consoleMessages.push(`[BROWSER CONSOLE] ${msg.text()}`);
    });

    // Configure viewport and user agent
    await page.setViewport({ 
      width: 794, 
      height: 1123, 
      deviceScaleFactor: 2 
    });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
    console.log('[PDF] Viewport set');

    // Configure request handling - ALLOW CSS THIS TIME
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      // Only block images and fonts to preserve CSS
      const blockedResources = ['image', 'font'];
      if (blockedResources.includes(req.resourceType())) {
        req.abort();
      } else {
        req.continue();
      }
    });

    console.log('[PDF] Navigating to target URL');
    const response = await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 90000
    });

    if (!response.ok()) {
      throw new Error(`Page load failed with status ${response.status()}`);
    }

    // Wait for all CSS to load
    await page.evaluate(async () => {
      const selectors = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
      await Promise.all(selectors.map(link => {
        return new Promise((resolve) => {
          if (link.sheet) return resolve();
          link.addEventListener('load', resolve);
          link.addEventListener('error', resolve);
        });
      }));
    });

    // Initial debug saves
    await page.screenshot({ path: debugPaths.initialScreen, fullPage: true });
    fs.writeFileSync(debugPaths.pageHTML, await page.content());
    fs.writeFileSync(debugPaths.consoleLog, consoleMessages.join('\n'));
    console.log('[PDF] Initial debug files saved');

    // Wait for content with multiple fallback strategies
    console.log('[PDF] Waiting for content');
    try {
      await page.waitForSelector('#handbook-pages .type-handbook-page', {
        timeout: 60000,
        visible: true
      });
    } catch (err) {
      console.log('[PDF] Primary selector wait failed, trying fallback');
      await page.waitForFunction(() => {
        return document.querySelectorAll('.type-handbook-page').length > 0;
      }, { timeout: 30000 });
    }

    // Verify content exists
    const sections = await page.$$('#handbook-pages .type-handbook-page');
    if (sections.length === 0) {
      throw new Error('No handbook sections found');
    }
    console.log(`[PDF] Found ${sections.length} sections`);

    // Generate PDFs with individual error handling
    const buffers = [];
    for (let i = 0; i < sections.length; i++) {
      console.log(`[PDF] Processing section ${i + 1}/${sections.length}`);
      
      try {
        await page.evaluate((idx) => {
          const pages = document.querySelectorAll('.type-handbook-page');
          pages.forEach((el, j) => {
            el.style.display = j === idx ? 'block' : 'none';
            // Ensure visibility for printing
            el.style.opacity = '1';
            el.style.visibility = 'visible';
          });
        }, i);

        // Add small delay between operations
        await new Promise(resolve => setTimeout(resolve, 1000));

        const buf = await page.pdf({
          printBackground: true,
          width: '794px',
          height: '1123px',
          margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
          timeout: 30000,
          preferCSSPageSize: true
        });
        buffers.push(buf);
      } catch (sectionErr) {
        console.error(`[PDF] Error processing section ${i + 1}:`, sectionErr);
        await page.screenshot({ path: path.join(debugDir, `section-error-${i}.png`) });
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
      await browser.close().catch(err => {
        console.error('[PDF] Browser close error:', err);
      });
    }
  }
};