import fs from 'fs';

const vercelJsonPath = 'vercel.json';
const vercelConfig = JSON.parse(fs.readFileSync(vercelJsonPath, 'utf-8'));

// Check if /enroll rewrite already exists
const hasEnrollRewrite = vercelConfig.rewrites.some((r) => r.source === '/enroll');
if (!hasEnrollRewrite) {
  // Insert before the catch-all SPA rewrite
  const catchAllIndex = vercelConfig.rewrites.findIndex((r) => r.source.includes('?!api/'));
  const enrollRewrites = [
    {
      source: '/enroll',
      destination: '/enroll/index.html',
    },
    {
      source: '/enroll/',
      destination: '/enroll/index.html',
    },
  ];

  if (catchAllIndex !== -1) {
    vercelConfig.rewrites.splice(catchAllIndex, 0, ...enrollRewrites);
  } else {
    vercelConfig.rewrites.push(...enrollRewrites);
  }

  fs.writeFileSync(vercelJsonPath, JSON.stringify(vercelConfig, null, 2), 'utf-8');
  console.log('✅ Added /enroll rewrite to vercel.json');
} else {
  console.log('ℹ️ vercel.json already contains /enroll rewrite');
}
