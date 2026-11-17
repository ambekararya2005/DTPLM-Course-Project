// Vercel serverless entry point. The Express app is a (req, res) handler, so
// Vercel can call it directly; vercel.json rewrites every /api/* request here
// and Express routes on the original URL. Locally, backend/src/server.js is
// still the entry point (it adds the startup DB check and app.listen).
module.exports = require('../backend/src/app');
