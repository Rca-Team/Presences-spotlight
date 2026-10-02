import fs from 'fs';
import path from 'path';

function searchDir(dir, pattern) {
  const results = [];
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const f of files) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) {
      if (f.name !== 'node_modules' && f.name !== '.next' && f.name !== '.git' && f.name !== 'dist') {
        results.push(...searchDir(full, pattern));
      }
    } else if (/\.(ts|tsx|js|jsx)$/.test(f.name)) {
      const content = fs.readFileSync(full, 'utf8');
      if (content.includes(pattern)) {
        results.push({ file: full });
      }
    }
  }
  return results;
}

const matches = searchDir('src', 'functions.invoke');
console.log('Found functions.invoke in:', JSON.stringify(matches, null, 2));

const edgeMatches = searchDir('src', 'supabase.functions');
console.log('Found supabase.functions in:', JSON.stringify(edgeMatches, null, 2));
