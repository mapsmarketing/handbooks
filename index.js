const express = require('express');
const app = express();
const handbookPdf = require('./utils/handbookPdf');
const path = require('path');
const fs = require('fs');

app.use(express.json());

app.get('/node/print/handbook', async (req, res) => {
  // res.send('Node PDF API is live at /node/print/handbook!');

  const { targetUrl } = req.query;

  if (!targetUrl || !targetUrl.includes('print=true')) {
    return res.status(400).json({ error: 'Invalid target URL.' });
  }

  try {
    const { filename, filepath } = await handbookPdf(targetUrl);
    const url = `/node/output/${filename}`;
    res.json({ url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'PDF generation failed.' });
  }
});

// Serve static files
app.use('/node/output', express.static(path.join(__dirname, 'output')));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Node app running on port ${PORT}`));
