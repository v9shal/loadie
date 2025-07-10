const express = require('express');
const app = express();
const port = process.argv[2] || 3001;

app.use((req, res, next) => {
  console.log(`[${port}] ${req.method} ${req.url}`);
  next();
});
app.get('/health', (req, res) => res.status(200).send('OK'));

app.get('/users/:id', (req, res) => {
  res.json({ user: req.params.id, port });
});


app.listen(port, () => console.log(`Backend running at http://localhost:${port}`));
