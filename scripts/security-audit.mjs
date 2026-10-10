#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

/**
 * Presences AI - Automated Security & Vulnerability Audit Suite
 *
 * Scans the entire codebase, environment configuration, production build,
 * route guards, and deployment headers for hacking risks, API key leaks,
 * and sensitive data exposure.
 */

const ROOT_DIR = process.cwd();
const SRC_DIR = path.join(ROOT_DIR, 'src');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

let totalChecks = 0;
let passedChecks = 0;
let failedChecks = 0;
let warnings = 0;

function report(category, name, passed, details = '', isWarning = false) {
  totalChecks++;
  if (passed) {
    passedChecks++;
    console.log(`  \x1b[32m✔\x1b[0m [${category}] ${name}`);
  } else if (isWarning) {
    warnings++;
    console.log(`  \x1b[33m⚠\x1b[0m [${category}] ${name} - ${details}`);
  } else {
    failedChecks++;
    console.log(`  \x1b[31m✖\x1b[0m [${category}] ${name} - \x1b[31m${details}\x1b[0m`);
  }
}

// Recursively find files
function getAllFiles(dir, extensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.html', '.css', '.env', '.mjs', '.cjs']) {
  const files = [];
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', '.gemini'].includes(entry.name)) continue;
      files.push(...getAllFiles(fullPath, extensions));
    } else if (entry.isFile()) {
      if (extensions.some((ext) => entry.name.endsWith(ext))) {
        files.push(fullPath);
      }
    }
  }
  return files;
}

console.log('\n================================================================');
console.log('       PRESENCES AI - FULL SECURITY & PENETRATION AUDIT        ');
console.log('================================================================\n');

// -------------------------------------------------------------
// 1. SENSITIVE CREDENTIAL & SECRET LEAK SCANNER
// -------------------------------------------------------------
console.log('\x1b[1m[TEST 1] Secret & Private API Key Leak Scanner\x1b[0m');

const SECRET_PATTERNS = [
  { name: 'Private RSA/EC/OpenSSH Key', regex: /-----BEGIN\s+(?:RSA|EC|DSA|OPENSSH)?\s*PRIVATE\s+KEY-----/i },
  { name: 'Supabase Service Role Key (Hardcoded)', regex: /service_role[a-zA-Z0-9_\-\.]{20,}/i },
  { name: 'Appwrite Server Secret Key (Hardcoded)', regex: /APPWRITE_API_KEY\s*=\s*['"]?[a-zA-Z0-9]{32,}['"]?/i },
  { name: 'Resend Production API Key', regex: /\bre_[a-zA-Z0-9]{24,}\b/i },
  { name: 'AWS Access Key ID', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub Personal Access Token', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[a-zA-Z0-9]{36,}\b/ },
  { name: 'Database Connection String with Password', regex: /(?:postgres|postgresql|mongodb|mysql):\/\/[^:]+:[^@]+@[^/]+/i },
];

const srcFiles = getAllFiles(SRC_DIR, ['.ts', '.tsx', '.js', '.jsx', '.json']);
let leakedFiles = [];

for (const file of srcFiles) {
  // Exclude test audit file itself
  if (file.includes('security-audit')) continue;
  const content = fs.readFileSync(file, 'utf8');
  for (const pat of SECRET_PATTERNS) {
    if (pat.regex.test(content)) {
      leakedFiles.push({ file: path.relative(ROOT_DIR, file), rule: pat.name });
    }
  }
}

report(
  'Codebase Secrets',
  'Source code contains zero hardcoded private credentials or master keys',
  leakedFiles.length === 0,
  leakedFiles.map((f) => `${f.file} (${f.rule})`).join(', ')
);

// -------------------------------------------------------------
// 2. PRODUCTION BUNDLE LEAK INSPECTION (DIST)
// -------------------------------------------------------------
console.log('\n\x1b[1m[TEST 2] Production JavaScript Bundle Secret Exposure\x1b[0m');

if (fs.existsSync(DIST_DIR)) {
  const distFiles = getAllFiles(DIST_DIR, ['.js', '.html']);
  let distLeaks = [];

  for (const file of distFiles) {
    const content = fs.readFileSync(file, 'utf8');
    for (const pat of SECRET_PATTERNS) {
      if (pat.regex.test(content)) {
        distLeaks.push({ file: path.relative(ROOT_DIR, file), rule: pat.name });
      }
    }
    // Check if server-side environment variables were bundled
    if (/APPWRITE_API_KEY|RESEND_API_KEY/.test(content)) {
      distLeaks.push({ file: path.relative(ROOT_DIR, file), rule: 'Server env variable token bundled in client' });
    }
  }

  report(
    'Production Bundle',
    'Production build (dist/) is free of server secrets and private API keys',
    distLeaks.length === 0,
    distLeaks.map((f) => `${f.file} (${f.rule})`).join(', ')
  );
} else {
  report(
    'Production Bundle',
    'Production build directory exists for verification',
    false,
    'Run `npm run build` before running bundle verification',
    true
  );
}

// -------------------------------------------------------------
// 3. ENVIRONMENT VARIABLE HYGIENE & VITE EXPOSURE
// -------------------------------------------------------------
console.log('\n\x1b[1m[TEST 3] Environment Variable Prefix & Leak Validation\x1b[0m');

const envExamplePath = path.join(ROOT_DIR, '.env.example');
if (fs.existsSync(envExamplePath)) {
  const envContent = fs.readFileSync(envExamplePath, 'utf8');
  const lines = envContent.split('\n');
  let dangerousViteVars = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const [key] = trimmed.split('=');
    // Ensure no secret keys are accidentally prefixed with VITE_
    if (key.startsWith('VITE_') && (key.includes('SECRET') || key.includes('SERVICE_ROLE') || key.includes('ADMIN_KEY') || key.includes('PRIVATE'))) {
      dangerousViteVars.push(key);
    }
  }

  report(
    'Env Architecture',
    '.env.example does not expose server secrets via VITE_ client prefix',
    dangerousViteVars.length === 0,
    `Found dangerous VITE_ prefix on: ${dangerousViteVars.join(', ')}`
  );
} else {
  report('Env Architecture', '.env.example file exists for security onboarding', false, 'Missing .env.example');
}

// -------------------------------------------------------------
// 4. GIT SECRET EXCLUSION (.gitignore)
// -------------------------------------------------------------
console.log('\n\x1b[1m[TEST 4] Git Secret Exclusion & Repository Hygiene\x1b[0m');

const gitignorePath = path.join(ROOT_DIR, '.gitignore');
if (fs.existsSync(gitignorePath)) {
  const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
  const mustIgnore = ['.env', '.env.*', '*.pem', '*.key', '*.cert', '*.dump', '*.sqlite'];
  const missingIgnores = mustIgnore.filter((pattern) => !gitignoreContent.includes(pattern));

  report(
    'Git Hygiene',
    '.gitignore strictly excludes local environment files and certificates',
    missingIgnores.length === 0,
    `Missing patterns in .gitignore: ${missingIgnores.join(', ')}`
  );
} else {
  report('Git Hygiene', '.gitignore exists to prevent secret leakage', false, 'Missing .gitignore');
}

// -------------------------------------------------------------
// 5. HTTP SECURITY HEADERS & CLICKJACKING PROTECTION
// -------------------------------------------------------------
console.log('\n\x1b[1m[TEST 5] HTTP Security Headers & Clickjacking Protection\x1b[0m');

// Check public/_headers
const headersPath = path.join(PUBLIC_DIR, '_headers');
const hasHeadersFile = fs.existsSync(headersPath);
let headersContent = hasHeadersFile ? fs.readFileSync(headersPath, 'utf8') : '';

report(
  'Security Headers',
  'public/_headers exists for Cloudflare Pages / Netlify hosting',
  hasHeadersFile,
  'public/_headers is missing'
);

report(
  'Clickjacking Defense',
  'X-Frame-Options configured to prevent Clickjacking attacks',
  headersContent.includes('X-Frame-Options'),
  'Missing X-Frame-Options in public/_headers'
);

report(
  'MIME-Sniffing Defense',
  'X-Content-Type-Options set to nosniff to prevent MIME type confusion',
  headersContent.includes('X-Content-Type-Options: nosniff'),
  'Missing X-Content-Type-Options in public/_headers'
);

report(
  'Referrer Protection',
  'Referrer-Policy set to strict-origin-when-cross-origin to avoid URL leaks',
  headersContent.includes('Referrer-Policy: strict-origin-when-cross-origin'),
  'Missing Referrer-Policy in public/_headers'
);

// Check vercel.json
const vercelPath = path.join(ROOT_DIR, 'vercel.json');
const hasVercelConfig = fs.existsSync(vercelPath);
let vercelContent = hasVercelConfig ? fs.readFileSync(vercelPath, 'utf8') : '';

report(
  'Vercel Security',
  'vercel.json configures security headers for Vercel edge deployment',
  hasVercelConfig && vercelContent.includes('X-Frame-Options'),
  'Missing or incomplete vercel.json'
);

// Check index.html meta tags
const indexPath = path.join(ROOT_DIR, 'index.html');
const indexContent = fs.readFileSync(indexPath, 'utf8');

report(
  'HTML Meta Security',
  'index.html defines referrer and nosniff protection meta tags',
  indexContent.includes('name="referrer"') && indexContent.includes('http-equiv="X-Content-Type-Options"'),
  'Missing security meta tags in index.html'
);

// -------------------------------------------------------------
// 6. ROUTE PROTECTION & ROLE-BASED ACCESS CONTROL (RBAC)
// -------------------------------------------------------------
console.log('\n\x1b[1m[TEST 6] Authentication Guard & Route Protection Analysis\x1b[0m');

const appPath = path.join(SRC_DIR, 'App.tsx');
const appContent = fs.readFileSync(appPath, 'utf8');

const SENSITIVE_ROUTES = [
  '/admin',
  '/backup',
  '/teacher',
  '/attendance',
  '/gate',
  '/guard',
  '/notifications',
  '/enrollment-monitor',
  '/jarvis',
];

let unprotectedRoutes = [];
for (const route of SENSITIVE_ROUTES) {
  // Regex to check if the route is enclosed within ProtectedRoute
  const routeRegex = new RegExp(`<Route\\s+path="${route}"[^>]*element=\\{\\s*<ProtectedRoute`, 'i');
  if (!routeRegex.test(appContent)) {
    // Check if route has children or custom wrapper
    const altRegex = new RegExp(`path="${route}"[\\s\\S]{1,120}ProtectedRoute`, 'i');
    if (!altRegex.test(appContent)) {
      unprotectedRoutes.push(route);
    }
  }
}

report(
  'Route Authorization',
  'All privileged management routes (/admin, /backup, /teacher, etc.) require authentication',
  unprotectedRoutes.length === 0,
  `Unprotected routes detected: ${unprotectedRoutes.join(', ')}`
);

// -------------------------------------------------------------
// 7. REVERSE TABNABBING (target="_blank" without rel)
// -------------------------------------------------------------
console.log('\n\x1b[1m[TEST 7] Reverse Tabnabbing (window.opener hijacking)\x1b[0m');

let vulnerableAnchors = [];
for (const file of srcFiles) {
  if (!file.endsWith('.tsx') && !file.endsWith('.jsx')) continue;
  const content = fs.readFileSync(file, 'utf8');
  const blankMatch = content.match(/<a\b[^>]*\btarget=["']_blank["'][^>]*>/gi);
  if (blankMatch) {
    for (const tag of blankMatch) {
      if (!/rel=["'][^"']*(?:noreferrer|noopener)[^"']*["']/i.test(tag)) {
        vulnerableAnchors.push({ file: path.relative(ROOT_DIR, file), tag });
      }
    }
  }
}

report(
  'Link Safety',
  'All target="_blank" links include rel="noopener noreferrer" to prevent window.opener hijacking',
  vulnerableAnchors.length === 0,
  vulnerableAnchors.map((v) => `${v.file}: ${v.tag}`).join(', ')
);

// -------------------------------------------------------------
// AUDIT SUMMARY
// -------------------------------------------------------------
console.log('\n================================================================');
console.log('                      AUDIT RESULTS SUMMARY                     ');
console.log('================================================================');
console.log(`  Total Security Checks : ${totalChecks}`);
console.log(`  Passed Checks         : \x1b[32m${passedChecks}\x1b[0m`);
console.log(`  Warnings              : \x1b[33m${warnings}\x1b[0m`);
console.log(`  Failed Checks         : \x1b[31m${failedChecks}\x1b[0m`);
console.log('================================================================\n');

if (failedChecks > 0) {
  console.error('\x1b[31m[FAILED] Security audit detected vulnerabilities. Please address the issues listed above.\x1b[0m\n');
  process.exit(1);
} else {
  console.log('\x1b[32m[PASSED] The application meets all enterprise security & zero-leak standards.\x1b[0m\n');
  process.exit(0);
}
