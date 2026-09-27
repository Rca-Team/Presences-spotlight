import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const targetFile = path.resolve(__dirname, '../public/version.json');

const versionData = {
  version: '2.4.2',
  buildTime: Date.now(),
  releaseTag: 'v2.4.2',
  updatedAt: new Date().toISOString(),
  appName: 'Presences Smart School',
  channel: 'production'
};

try {
  fs.writeFileSync(targetFile, JSON.stringify(versionData, null, 2) + '\n', 'utf8');
  console.log(`[update-version] Successfully updated ${targetFile} (buildTime: ${versionData.buildTime})`);
} catch (err) {
  console.error('[update-version] Failed to write version.json:', err);
}
