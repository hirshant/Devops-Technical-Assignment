const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.POSTGRES_HOST || 'db',
  port: process.env.POSTGRES_PORT ? Number(process.env.POSTGRES_PORT) : 5432,
  user: process.env.POSTGRES_USER || 'syvora',
  password: process.env.POSTGRES_PASSWORD || 'syvora_pass',
  database: process.env.POSTGRES_DB || 'syvoradb',
  max: 5,
});

async function init() {
  const createTable = `
  CREATE TABLE IF NOT EXISTS items (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
  `;
  await pool.query(createTable);
}

module.exports = {
  query: (text, params) => pool.query(text, params),
  init,
};
