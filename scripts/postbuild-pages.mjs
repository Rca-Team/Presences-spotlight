import fs from 'fs';
import path from 'path';

function postbuild() {
  const rootDir = process.cwd();
  const distDir = path.join(rootDir, 'dist');
  const distIndexPath = path.join(distDir, 'index.html');

  if (!fs.existsSync(distIndexPath)) {
    console.warn('⚠️ dist/index.html not found, skipping postbuild pages.');
    return;
  }

  // Ensure og-enroll.png is copied to dist
  const publicOgEnroll = path.join(rootDir, 'public', 'og-enroll.png');
  const distOgEnroll = path.join(distDir, 'og-enroll.png');
  if (fs.existsSync(publicOgEnroll) && !fs.existsSync(distOgEnroll)) {
    fs.copyFileSync(publicOgEnroll, distOgEnroll);
    console.log('✅ Copied public/og-enroll.png to dist/og-enroll.png');
  }

  let html = fs.readFileSync(distIndexPath, 'utf-8');

  // Replace Title & Description
  html = html.replace(
    /<title>.*?<\/title>/i,
    '<title>Student Face Enrollment | PM Shri Kendriya Vidyalaya NFC Vigyan Vihar</title>'
  );

  html = html.replace(
    /<meta\s+name="description"\s+content=".*?"\s*\/?>/i,
    '<meta name="description" content="Official Student Face Recognition &amp; Biometric Profile Enrollment Portal for PM Shri Kendriya Vidyalaya NFC Vigyan Vihar. Engineered by Gaurav (Team RCA) on Presences AI." />'
  );

  html = html.replace(
    /<meta\s+name="author"\s+content=".*?"\s*\/?>/i,
    '<meta name="author" content="Gaurav • Team RCA" />'
  );

  // Replace Open Graph Meta Tags
  html = html.replace(
    /<meta\s+property="og:title"\s+content=".*?"\s*\/?>/i,
    '<meta property="og:title" content="Student Face Enrollment • PM Shri Kendriya Vidyalaya NFC Vigyan Vihar" />'
  );

  html = html.replace(
    /<meta\s+property="og:description"\s+content=".*?"\s*\/?>/i,
    '<meta property="og:description" content="Official Student Face Recognition &amp; Biometric Profile Enrollment Portal for PM Shri Kendriya Vidyalaya NFC Vigyan Vihar. Engineered by Gaurav (Team RCA) on Presences AI." />'
  );

  html = html.replace(
    /<meta\s+property="og:image"\s+content=".*?"\s*\/?>/i,
    '<meta property="og:image" content="https://www.presences.dev/og-enroll.png" />\n  <meta property="og:image:secure_url" content="https://www.presences.dev/og-enroll.png" />\n  <meta property="og:image:type" content="image/png" />\n  <meta property="og:image:width" content="1200" />\n  <meta property="og:image:height" content="630" />\n  <meta property="og:image:alt" content="Student Face Enrollment • PM Shri KV NFC Vigyan Vihar • Developed by Gaurav (Team RCA)" />\n  <meta property="og:site_name" content="Presences • PM Shri Kendriya Vidyalaya NFC Vigyan Vihar" />'
  );

  // Replace Twitter Meta Tags
  html = html.replace(
    /<meta\s+name="twitter:title"\s+content=".*?"\s*\/?>/i,
    '<meta name="twitter:title" content="Student Face Enrollment • PM Shri Kendriya Vidyalaya NFC Vigyan Vihar" />'
  );

  html = html.replace(
    /<meta\s+name="twitter:description"\s+content=".*?"\s*\/?>/i,
    '<meta name="twitter:description" content="Official Student Face Recognition &amp; Biometric Profile Enrollment Portal for PM Shri Kendriya Vidyalaya NFC Vigyan Vihar. Engineered by Gaurav (Team RCA) on Presences AI." />'
  );

  html = html.replace(
    /<meta\s+name="twitter:image"\s+content=".*?"\s*\/?>/i,
    '<meta name="twitter:image" content="https://www.presences.dev/og-enroll.png" />'
  );

  // Write to dist/enroll/index.html
  const enrollDir = path.join(distDir, 'enroll');
  if (!fs.existsSync(enrollDir)) {
    fs.mkdirSync(enrollDir, { recursive: true });
  }
  fs.writeFileSync(path.join(enrollDir, 'index.html'), html, 'utf-8');
  fs.writeFileSync(path.join(distDir, 'enroll.html'), html, 'utf-8');

  console.log('✅ Successfully generated dist/enroll/index.html & dist/enroll.html with custom school & developer OG metadata!');
}

postbuild();
