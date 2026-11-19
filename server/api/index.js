// Vercel serverless entry. `pnpm build` (nest build) produces dist/ before this is bundled.
module.exports = require('../dist/serverless').default;
