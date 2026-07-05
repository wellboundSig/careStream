#!/usr/bin/env node
/**
 * build.js — package wellbound-api for Lambda.
 *
 * 1. Copies the generated registry (db/registry.json) into the bundle root.
 * 2. Installs production deps.
 * 3. Zips src/ + registry.json + node_modules → dist/wellbound-api.zip
 *
 * Deploy (from an AWS-credentialed shell):
 *   aws lambda update-function-code --function-name wellbound-api \
 *     --zip-file fileb://dist/wellbound-api.zip --region us-east-2
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTRY_SRC = path.join(HERE, '../../db/registry.json');

if (!fs.existsSync(REGISTRY_SRC)) {
  console.error('db/registry.json missing — run `node db/generate-ddl.js` first.');
  process.exit(1);
}
fs.copyFileSync(REGISTRY_SRC, path.join(HERE, 'registry.json'));

execSync('npm install --omit=dev --no-audit --no-fund', { cwd: HERE, stdio: 'inherit' });
fs.mkdirSync(path.join(HERE, 'dist'), { recursive: true });
execSync('rm -f dist/wellbound-api.zip && zip -qr dist/wellbound-api.zip src registry.json node_modules package.json', {
  cwd: HERE, stdio: 'inherit',
});
console.log('Built dist/wellbound-api.zip');
