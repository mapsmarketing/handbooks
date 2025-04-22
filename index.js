const express = require('express');
const path = require('path');
const generateHandbookPdf = require('./utils/handbookPdf');

const app = express();
app.use(express.json());

// 1) PDF generation endpoint
app.get('/print/handbook', async (req, res) => {
  const { targetUrl } = req.query;
  if (!targetUrl || !targetUrl.includes('print=true')) {
    return res.status(400).json({ error: 'Invalid targetUrl (must include print=true)' });
  }

  try {
    const { filename } = await generateHandbookPdf(targetUrl);
    // return the public URL to download
    res.json({ url: `/output/${filename}` });
  } catch (err) {
    console.error('🔥 PDF generation error:', err);
    res.status(500).json({ error: 'PDF generation failed' });
  }
});

// 2) Serve the output folder
app.use('/output', express.static(path.join(__dirname, 'output')));

// Listen on the port Render assigns
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ PDF service listening on port ${PORT}`));
