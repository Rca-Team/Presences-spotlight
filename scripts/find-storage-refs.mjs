import fs from 'fs';
import path from 'path';

function searchDir(dir, patterns) {
  const results = [];
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const f of files) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) {
      if (f.name !== 'node_modules' && f.name !== '.next' && f.name !== '.git' && f.name !== 'dist') {
        results.push(...searchDir(full, patterns));
      }
    } else if (/\.(ts|tsx|js|jsx|mjs)$/.test(f.name)) {
      const content = fs.readFileSync(full, 'utf8');
      for (const pattern of patterns) {
        if (content.includes(pattern)) {
          results.push({ file: full, pattern });
        }
      }
    }
  }
  return results;
}

const matches = searchDir('src', ['face-images', 'student-registration-faces', 'attendance-training-faces', 'storage', 'appwrite']);
console.log('Found matches:', JSON.stringify(matches, null, 2));
