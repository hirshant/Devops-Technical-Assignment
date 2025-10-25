require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const helmet = require('helmet');
const morgan = require('morgan');
const client = require('prom-client');
const db = require('./db');

const app = express();
const port = process.env.APP_PORT || 3000;

// Prometheus metrics
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics({ timeout: 5000 });

const httpRequestDurationMicroseconds = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'code'],
  // buckets for response time from 5ms to 5s
  buckets: [0.005, 0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5]
});

app.use(helmet());
app.use(bodyParser.json());
app.use(morgan('combined'));

// DB init
(async () => {
  let tries = 0;
  while (tries < 12) {
    try {
      await db.init();
      console.log('DB initialized');
      break;
    } catch (err) {
      tries++;
      console.log('Waiting for DB to be ready... attempt', tries);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
})();

// metrics endpoint
app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
  } catch (ex) {
    res.status(500).end(ex);
  }
});

// middleware to observe durations
app.use((req, res, next) => {
  const end = httpRequestDurationMicroseconds.startTimer();
  res.on('finish', () => {
    end({ method: req.method, route: req.route ? req.route.path : req.path, code: res.statusCode });
  });
  next();
});

// CRUD endpoints
app.get('/items', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM items ORDER BY id');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db error' });
  }
});

app.get('/items/:id', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM items WHERE id=$1', [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db error' });
  }
});

app.post('/items', async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const { rows } = await db.query(
      'INSERT INTO items(name, description) VALUES($1, $2) RETURNING *',
      [name, description || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db error' });
  }
});

app.put('/items/:id', async (req, res) => {
  try {
    const { name, description } = req.body;
    const { rows } = await db.query(
      'UPDATE items SET name=$1, description=$2 WHERE id=$3 RETURNING *',
      [name, description, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db error' });
  }
});

app.delete('/items/:id', async (req, res) => {
  try {
    const { rowCount } = await db.query('DELETE FROM items WHERE id=$1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'db error' });
  }
});

// simple readiness/liveness
app.get('/healthz', (req, res) => res.status(200).json({ status: 'ok' }));

app.listen(port, () => {
  console.log(`App listening on port ${port}`);
});
