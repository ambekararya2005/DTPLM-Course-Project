const mysql = require('mysql2/promise');
require('dotenv').config();

// Hosted MySQL (TiDB Cloud, Aiven, Railway, ...) needs TLS. DB_SSL=true turns
// it on; DB_SSL_CA optionally pins the provider's CA certificate (PEM text,
// literal "\n" sequences are accepted so it fits in a single env var).
function sslOptions() {
  if (String(process.env.DB_SSL).toLowerCase() !== 'true') return undefined;
  const ssl = { minVersion: 'TLSv1.2', rejectUnauthorized: true };
  if (process.env.DB_SSL_CA) ssl.ca = process.env.DB_SSL_CA.replace(/\\n/g, '\n');
  return ssl;
}

// A pooled connection is reused across requests instead of opening a
// fresh MySQL connection per API call (much faster under load).
// On Vercel every function instance gets its own pool, so keep it small
// (DB_CONNECTION_LIMIT) to stay under the database's connection cap.
const common = {
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_CONNECTION_LIMIT) || (process.env.VERCEL ? 3 : 10),
  queueLimit: 0,
  decimalNumbers: true, // return DECIMAL columns (lat/lng/price) as JS numbers, not strings
  ssl: sslOptions(),
};

// DATABASE_URL (mysql://user:pass@host:port/db) wins if set; otherwise the
// individual DB_* variables are used, as in local development. DB_NAME, when
// set, overrides the database named in DATABASE_URL.
function connectionConfig() {
  if (process.env.DATABASE_URL) {
    const u = new URL(process.env.DATABASE_URL);
    return {
      host: decodeURIComponent(u.hostname),
      port: Number(u.port) || 3306,
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: process.env.DB_NAME || decodeURIComponent(u.pathname.slice(1)) || undefined,
    };
  }
  return {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT || 3306,
  };
}

const config = { ...connectionConfig(), ...common };
const pool = mysql.createPool(config);

// Quick startup check so a bad .env fails loudly instead of on the first request.
async function testConnection() {
  try {
    const conn = await pool.getConnection();
    console.log('✅ MySQL connected:', config.database);
    conn.release();
  } catch (err) {
    console.error('❌ MySQL connection failed:', err.message);
    process.exit(1);
  }
}

module.exports = { pool, testConnection, config };
