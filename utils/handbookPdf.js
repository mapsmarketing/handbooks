// const puppeteer = require('puppeteer');
// const fs = require('fs');
// const { PDFDocument } = require('pdf-lib');
// const path = require('path');
// const { v4: uuidv4 } = require('uuid');

// async function handbookPdf(targetUrl) {
//   const browser = await puppeteer.launch({ headless: 'new' });
//   const page = await browser.newPage();

//   await page.setViewport({ width: 794, height: 1123 });
//   await page.goto(targetUrl, { waitUntil: 'networkidle0' });
//   await page.emulateMediaType('screen');

//   const sections = await page.$$('#handbook-pages .type-handbook-page');
//   const buffers = [];

//   for (let i = 0; i < sections.length; i++) {
//     await page.evaluate((idx) => {
//       document
//         .querySelectorAll('#handbook-pages .type-handbook-page')
//         .forEach((el, j) => (el.style.display = j === idx ? 'block' : 'none'));
//     }, i);

//     const buf = await page.pdf({
//       printBackground: true,
//       width: '794px',
//       height: '1123px',
//       margin: { top: '0px', right: '0px', bottom: '0px', left: '0px' },
//     });
//     buffers.push(buf);
//   }

//   await browser.close();

//   const merged = await PDFDocument.create();
//   for (const buf of buffers) {
//     const doc = await PDFDocument.load(buf);
//     const [page] = await merged.copyPages(doc, [0]);
//     merged.addPage(page);
//   }

//   const finalPdf = await merged.save();
//   const filename = `handbook-${uuidv4()}.pdf`;
//   const filepath = path.join(__dirname, '..', 'output', filename);

//   fs.writeFileSync(filepath, finalPdf);
//   return { filename, filepath };
// }

// module.exports = handbookPdf;

const puppeteer = require('puppeteer');

async function handbookPdf(targetUrl) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.goto('https://example.com'); // Simple static URL

  await page.pdf({ path: '/home/xozhnvdeslsswdxb/handbooks.mapsmarketing.com.au/node/output/test.pdf' });

  await browser.close();

  return {
    filename: 'test.pdf',
    filepath: '/node/output/test.pdf'
  };
}

module.exports = handbookPdf;
