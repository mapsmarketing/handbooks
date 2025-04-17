const express = require('express');
const app = express();
const handbookPdf = require('./utils/handbookPdf');
const path = require('path');
const fs = require('fs');

app.use(express.json());

// Update route to the root instead of '/node'
app.get('/print/handbook', async (req, res) => {
  const { targetUrl } = req.query;

  if (!targetUrl || !targetUrl.includes('print=true')) {
    return res.status(400).json({ error: 'Invalid target URL.' });
  }

  try {
    const { filename, filepath } = await handbookPdf(targetUrl);
    const url = `/output/${filename}`; // update to `/output/` as a relative URL
    res.json({ url });
  } catch (err) {
    console.error('🔥 PDF generation error:', err);
    res.status(500).json({ error: 'PDF generation failed.' });
  }
});

// Serve static files directly from the root for the 'output' folder
app.use('/output', express.static(path.join(__dirname, 'output')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Node app running on port ${PORT}`));
