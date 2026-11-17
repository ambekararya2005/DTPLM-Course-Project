const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const { pool, config } = require('./db');

// Creates the schema on an empty database the first time the API is used, so a
// fresh cloud database (TiDB, Aiven, Railway...) needs no manual SQL step.
// It runs database/artisoul_full_schema.sql, which only uses
// CREATE TABLE IF NOT EXISTS, so it never touches existing tables or data.
const SCHEMA_FILE = path.join(__dirname, '..', '..', '..', 'database', 'artisoul_full_schema.sql');
const TABLES = ['Users', 'Shops', 'Products', 'Orders', 'ChatConversations', 'ChatMessages', 'ProductMedia', 'Product360'];

function statements(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean);
}

// The database itself may not exist yet (e.g. DB_NAME=artisoul on a fresh
// TiDB Cloud cluster), so create it over a connection that doesn't select one.
async function ensureDatabase() {
  if (!config.database) throw new Error('No database selected: set DB_NAME or add one to DATABASE_URL');
  const { database, connectionLimit, waitForConnections, queueLimit, ...rest } = config;
  const conn = await mysql.createConnection(rest);
  try {
    await conn.query('CREATE DATABASE IF NOT EXISTS ?? CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci', [database]);
  } finally {
    await conn.end();
  }
}

async function migrate() {
  await ensureDatabase();
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`,
    [TABLES]
  );
  if (rows[0].n === TABLES.length) return;

  console.log(`Creating ArtiSoul schema (${rows[0].n}/${TABLES.length} tables present)`);
  const conn = await pool.getConnection();
  try {
    for (const stmt of statements(fs.readFileSync(SCHEMA_FILE, 'utf8'))) {
      await conn.query(stmt);
    }
  } finally {
    conn.release();
  }
}

// Runs once per server instance; a failure is retried on the next request.
let ready;
function ensureSchema(req, res, next) {
  ready ??= migrate().catch((err) => {
    ready = undefined;
    throw err;
  });
  ready.then(() => next(), next);
}

module.exports = { ensureSchema, migrate };
