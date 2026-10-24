import fs from 'fs';

// Update src/App.tsx ROUTE_SEO
let appCode = fs.readFileSync('src/App.tsx', 'utf-8');
if (!appCode.includes('"/enroll": {')) {
  const target = '"/enrollment-monitor": {';
  const replacement = `"/enroll": {
    title: "Student Face Enrollment | PM Shri KV NFC Vigyan Vihar",
    description:
      "Official Student Face Biometric & Profile Registration Portal for PM Shri Kendriya Vidyalaya NFC Vigyan Vihar. Engineered by Gaurav (Team RCA) on Presences AI.",
  },
  "/enrollment-monitor": {`;
  appCode = appCode.replace(target, replacement);
  fs.writeFileSync('src/App.tsx', appCode, 'utf-8');
  console.log('✅ Updated ROUTE_SEO in src/App.tsx');
} else {
  console.log('ℹ️ ROUTE_SEO in src/App.tsx already contains /enroll');
}
