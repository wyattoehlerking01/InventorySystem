const express = require('express');
const path = require('path');

const app = express();
const PORT = 3000;

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Serve static assets from project root
app.use(express.static(path.join(__dirname)));

// Fallback to index.html
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`LCHS Inventory System running on http://0.0.0.0:${PORT}`);
});
