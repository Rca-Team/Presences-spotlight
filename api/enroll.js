import fs from 'fs';
import path from 'path';

export default async function handler(req, res) {
  try {
    const rootDir = process.cwd();
    const candidatePaths = [
      path.join(rootDir, 'dist', 'enroll', 'index.html'),
      path.join(rootDir, 'dist', 'enroll.html'),
      path.join(rootDir, 'dist', 'index.html'),
      path.join(rootDir, 'index.html'),
    ];

    let html = '';
    for (const p of candidatePaths) {
      if (fs.existsSync(p)) {
        html = fs.readFileSync(p, 'utf-8');
        break;
      }
    }

    if (!html) {
      return res.status(404).send('Not Found');
    }

    // Ensure metadata is injected if loading fallback index.html
    if (!html.includes('og-enroll.png')) {
      html = html.replace(
        /<title>.*?<\/title>/i,
        '<title>Student Face Enrollment | PM Shri Kendriya Vidyalaya NFC Vigyan Vihar</title>'
      );
      html = html.replace(
        /<meta\s+name="description"\s+content=".*?"\s*\/?>/i,
        '<meta name="description" content="Official Student Face Recognition &amp; Biometric Profile Enrollment Portal for PM Shri Kendriya Vidyalaya NFC Vigyan Vihar. Engineered by Gaurav (Team RCA) on Presences AI." />'
      );
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
        '<meta property="og:image" content="https://www.presences.dev/og-enroll.png" />\n  <meta property="og:image:width" content="1200" />\n  <meta property="og:image:height" content="630" />'
      );
      html = html.replace(
        /<meta\s+name="twitter:image"\s+content=".*?"\s*\/?>/i,
        '<meta name="twitter:image" content="https://www.presences.dev/og-enroll.png" />'
      );
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400');
    return res.status(200).send(html);
  } catch (error) {
    console.error('Error serving /enroll metadata:', error);
    return res.status(500).send('Internal Server Error');
  }
}
