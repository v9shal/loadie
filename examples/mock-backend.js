const express = require('express');
const app = express();
const port = process.argv[2] || 3001;

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const doCpuWork = (duration) => {
  const start = Date.now();
  while (Date.now() - start < duration) {
  }
};

app.get('/health', (req, res) => res.status(200).send('OK'));

app.get('/users/:id', async (req, res) => {
  const ioWait = Math.random() * 50 + 50;
  await sleep(ioWait);

  doCpuWork(5);

  const response = {
    message: `Request handled by service on port ${port}`,
    path: req.path,
    serverPort: port,
    ioWaitMs: Math.round(ioWait),
    data: Array.from({ length: 10 }, (_, i) => ({
      id: `${req.params.id || 'item'}-${i}`,
      value: Math.random() * 1000,
      processed: true,
    }))
  };

  res.status(200).json(response);
});

app.listen(port, () => {
  console.log(`✅ Realistic mock service listening on http://localhost:${port}`);
});