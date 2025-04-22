const chromium = require('chrome-aws-lambda');
const puppeteer = require('puppeteer-core');
const { PDFDocument } = require('pdf-lib');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

module.exports = async function generateHandbookPdf(targetUrl) {
  const browser = await puppeteer.launch({
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/google-chrome-stable',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: true
  });

  // 2) Render each page
  const page = await browser.newPage();
  await page.setViewport({ width: 794, height: 1123 });
  await page.goto(targetUrl, { waitUntil: 'networkidle0' });
  await page.emulateMediaType('screen');

  const sections = await page.$$('#handbook-pages .type-handbook-page');
  const buffers = [];
  for (let i = 0; i < sections.length; i++) {
    await page.evaluate(idx => {
      document
        .querySelectorAll('#handbook-pages .type-handbook-page')
        .forEach((el, j) => el.style.display = j === idx ? 'block' : 'none');
    }, i);

    buffers.push(await page.pdf({
      printBackground: true,
      width: '794px',
      height: '1123px',
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    }));
  }

  await browser.close();

  // 3) Merge into one PDF
  const merged = await PDFDocument.create();
  for (const buf of buffers) {
    const doc = await PDFDocument.load(buf);
    const [p] = await merged.copyPages(doc, [0]);
    merged.addPage(p);
  }

  const finalPdf = await merged.save();
  const filename = `handbook-${uuidv4()}.pdf`;
  const outDir  = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
  const filepath = path.join(outDir, filename);
  fs.writeFileSync(filepath, finalPdf);

  return { filename, filepath };
};
