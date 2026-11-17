// Vercel serverless entry point. The Express app is a (req, res) handler, so
// Vercel can call it directly; vercel.json rewrites every /api/* request here
// and Express routes on the original URL. Locally, backend/src/server.js is
// still the entry point (it adds the startup DB check and app.listen).
const app = require('../backend/src/app');
const { ensureSchema } = require('../backend/src/config/migrate');

// Before the first database request on a new instance, make sure the tables
// exist (creates them on an empty database; a no-op afterwards).
const NO_DB = new Set(['/api/health', '/api/uploads/config']);

module.exports = (req, res) => {
  if (NO_DB.has(req.url.split('?')[0])) return app(req, res);
  ensureSchema(req, res, (err) => {
    if (err) {
      console.error('Schema check failed:', err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ success: false, message: `Database not reachable: ${err.message}` }));
    }
    app(req, res);
  });
};
