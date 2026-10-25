'use strict';

// Fallback entry point for hosts that default to `node index.js` (e.g. Render).
// If the compiled Nest bundle is missing, build it before starting so deploys
// remain reliable when the platform skips the usual `npm run build` step.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const distMain = path.join(__dirname, 'dist', 'main.js');

if (!fs.existsSync(distMain)) {
  console.log('Compiled app not found at dist/main.js. Building before startup...');
  execSync('npm run build', { stdio: 'inherit' });
}

require(distMain);
