const express = require('express');
const path    = require('path');
const genPdf  = require('./utils/handbookPdf');

const app = express();
app.use(express.json());

app.get('/print/handbook', async (req, res) => {
  const { targetUrl } = req.query;
  if (!targetUrl?.includes('print=true')) {
    return res.status(400).json({ error: 'Invalid targetUrl' });
  }
  try {
    const { filename } = await genPdf(targetUrl);
    res.json({ url: `/output/${filename}` });
  } catch (e) {
    console.error('PDF error:', e);
    res.status(500).json({ error: 'PDF generation failed' });
  }
});

app.use('/output', express.static(path.join(__dirname, 'output')));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`✅ PDF service on port ${PORT}`));
