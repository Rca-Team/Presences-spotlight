import fs from 'fs';

const pkgPath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

pkg.scripts.prebuild = 'node scripts/update-version.js && node scripts/generate-og-enroll.mjs';
pkg.scripts.build = 'node --max-old-space-size=8192 ./node_modules/vite/bin/vite.js build && node scripts/postbuild-pages.mjs';
pkg.scripts['generate:og'] = 'node scripts/generate-og-enroll.mjs';

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');
console.log('✅ Updated package.json build & prebuild scripts');
