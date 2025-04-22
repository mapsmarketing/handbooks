const chromeLauncher = require('chrome-launcher');
const puppeteer = require('puppeteer-core');
const { PDFDocument } = require('pdf-lib');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

module.exports = async function generateHandbookPdf(targetUrl) {
  // 1) Launch system-installed Chrome
  const chrome = await chromeLauncher.launch({
    chromePath: process.env.CHROME_PATH || undefined,
    chromeFlags: [
      '--headless',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-setuid-sandbox'
    ]
  });

  // 2) Connect Puppeteer to that Chrome instance
  const browser = await puppeteer.connect({
    browserWSEndpoint: `ws://localhost:${chrome.port}`,
    defaultViewport: { width: 794, height: 1123 }
  });

  const page = await browser.newPage();
  await page.goto(targetUrl, { waitUntil: 'networkidle0' });
  await page.emulateMediaType('screen');

  // 3) Capture each .type-handbook-page as its own PDF buffer
  const sections = await page.$$('#handbook-pages .type-handbook-page');
  const buffers = [];
  for (let i = 0; i < sections.length; i++) {
    await page.evaluate(idx => {
      document
        .querySelectorAll('#handbook-pages .type-handbook-page')
        .forEach((el, j) => {
          el.style.display = (j === idx ? 'block' : 'none');
        });
    }, i);

    buffers.push(
      await page.pdf({
        printBackground: true,
        width: '794px',
        height: '1123px',
        margin: { top: 0, right: 0, bottom: 0, left: 0 }
      })
    );
  }

  await browser.close();
  await chrome.kill();

  // 4) Merge with pdf-lib
  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    const doc = await PDFDocument.load(buf);
    const [p] = await merged.copyPages(doc, [0]);
    merged.addPage(p);
  }

  const finalPdf = await merged.save();
  const filename = `handbook-${uuidv4()}.pdf`;
  const outDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const filepath = path.join(outDir, filename);
  fs.writeFileSync(filepath, finalPdf);

  return { filename, filepath };
};
