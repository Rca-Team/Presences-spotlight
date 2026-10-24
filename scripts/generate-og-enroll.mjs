import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

async function generateEnrollOgImage() {
  const rootDir = process.cwd();
  const publicDir = path.join(rootDir, 'public');

  // Load and prepare logos as base64
  const kvsLogoBuf = await sharp(path.join(publicDir, 'kvs-logo.png'))
    .resize(110, 110, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();
  const kvsBase64 = `data:image/png;base64,${kvsLogoBuf.toString('base64')}`;

  const presencesLogoBuf = await sharp(path.join(publicDir, 'logo.png'))
    .resize(110, 110, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();
  const presencesBase64 = `data:image/png;base64,${presencesLogoBuf.toString('base64')}`;

  const gauravPhotoBuf = await sharp(path.join(publicDir, 'gaurav-photo.png'))
    .resize(96, 96, { fit: 'cover' })
    .png()
    .toBuffer();
  const gauravBase64 = `data:image/png;base64,${gauravPhotoBuf.toString('base64')}`;

  // SVG canvas 1200 x 630 (standard Open Graph format)
  const svg = `
  <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- Background Gradients -->
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#050814" />
        <stop offset="45%" stop-color="#0a1226" />
        <stop offset="100%" stop-color="#040b18" />
      </linearGradient>

      <!-- Glow Orbs -->
      <radialGradient id="cyanGlow" cx="15%" cy="20%" r="55%">
        <stop offset="0%" stop-color="#06b6d4" stop-opacity="0.28" />
        <stop offset="100%" stop-color="#06b6d4" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="emeraldGlow" cx="85%" cy="40%" r="60%">
        <stop offset="0%" stop-color="#10b981" stop-opacity="0.32" />
        <stop offset="100%" stop-color="#10b981" stop-opacity="0" />
      </radialGradient>
      <radialGradient id="indigoGlow" cx="50%" cy="100%" r="50%">
        <stop offset="0%" stop-color="#6366f1" stop-opacity="0.22" />
        <stop offset="100%" stop-color="#6366f1" stop-opacity="0" />
      </radialGradient>

      <!-- Text Gradients -->
      <linearGradient id="goldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#fbbf24" />
        <stop offset="100%" stop-color="#f59e0b" />
      </linearGradient>
      <linearGradient id="emeraldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#34d399" />
        <stop offset="50%" stop-color="#10b981" />
        <stop offset="100%" stop-color="#06b6d4" />
      </linearGradient>
      <linearGradient id="cyanGrad" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="#38bdf8" />
        <stop offset="100%" stop-color="#818cf8" />
      </linearGradient>
      <linearGradient id="cardGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="#0f172a" stop-opacity="0.85" />
        <stop offset="100%" stop-color="#020617" stop-opacity="0.95" />
      </linearGradient>

      <!-- Clip paths -->
      <clipPath id="circleDev">
        <circle cx="56" cy="56" r="44" />
      </clipPath>
      <clipPath id="circleKvs">
        <circle cx="48" cy="48" r="42" />
      </clipPath>
      <clipPath id="circleLogo">
        <circle cx="48" cy="48" r="42" />
      </clipPath>

      <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="120%">
        <feDropShadow dx="0" dy="16" stdDeviation="24" flood-color="#000000" flood-opacity="0.6" />
      </filter>
      <filter id="glowEffect" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="8" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>

    <style>
      .title-school { font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif; font-weight: 900; }
      .text-sub { font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif; font-weight: 600; }
      .text-body { font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, sans-serif; }
      .code-font { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    </style>

    <!-- Base Canvas -->
    <rect width="1200" height="630" fill="url(#bgGrad)" />
    <rect width="1200" height="630" fill="url(#cyanGlow)" />
    <rect width="1200" height="630" fill="url(#emeraldGlow)" />
    <rect width="1200" height="630" fill="url(#indigoGlow)" />

    <!-- Subtle Tech Dot Grid Overlay -->
    <pattern id="dotPattern" x="0" y="0" width="32" height="32" patternUnits="userSpaceOnUse">
      <circle cx="2" cy="2" r="1.2" fill="#38bdf8" fill-opacity="0.12" />
    </pattern>
    <rect width="1200" height="630" fill="url(#dotPattern)" />

    <!-- Top Border Line -->
    <rect x="0" y="0" width="1200" height="4" fill="url(#emeraldGrad)" />

    <!-- Header Section: Badges & School Identity -->
    <g transform="translate(60, 48)">
      <!-- KVS Logo Circular Container -->
      <g transform="translate(0, 0)">
        <circle cx="48" cy="48" r="46" fill="#ffffff" stroke="#38bdf8" stroke-width="2" />
        <g clip-path="url(#circleKvs)">
          <image href="${kvsBase64}" x="0" y="0" width="96" height="96" />
        </g>
      </g>

      <!-- Presences AI Logo Circular Container -->
      <g transform="translate(80, 0)">
        <circle cx="48" cy="48" r="46" fill="#0f172a" stroke="#10b981" stroke-width="2" />
        <g clip-path="url(#circleLogo)">
          <image href="${presencesBase64}" x="0" y="0" width="96" height="96" />
        </g>
      </g>

      <!-- Header Labels -->
      <g transform="translate(190, 16)">
        <!-- Pill Badge -->
        <rect x="0" y="0" width="410" height="28" rx="14" fill="#06b6d4" fill-opacity="0.15" stroke="#06b6d4" stroke-width="1.2" stroke-opacity="0.4" />
        <circle cx="14" cy="14" r="5" fill="#10b981" />
        <text x="28" y="19" class="text-sub code-font" font-size="11" font-weight="700" fill="#38bdf8" letter-spacing="1.5">OFFICIAL STUDENT BIOMETRIC ENROLLMENT</text>

        <!-- Affiliation -->
        <text x="0" y="52" class="text-sub" font-size="14" font-weight="700" fill="#94a3b8" letter-spacing="0.5">
          KENDRIYA VIDYALAYA SANGATHAN • DELHI REGION
        </text>
      </g>
    </g>

    <!-- Main Content Left Side: School & Portal Title -->
    <g transform="translate(60, 185)">
      <!-- School Full Name -->
      <text x="0" y="44" class="title-school" font-size="44" font-weight="900" fill="#ffffff" letter-spacing="-0.5">
        PM SHRI KENDRIYA VIDYALAYA
      </text>

      <!-- School Location / Campus -->
      <text x="0" y="86" class="title-school" font-size="34" font-weight="800" fill="url(#cyanGrad)" letter-spacing="0.2">
        NFC VIGYAN VIHAR, DELHI
      </text>

      <!-- Portal Feature Title -->
      <g transform="translate(0, 115)">
        <rect x="0" y="0" width="460" height="42" rx="10" fill="#10b981" fill-opacity="0.12" stroke="#10b981" stroke-width="1.5" stroke-opacity="0.4" />
        <text x="18" y="27" class="title-school" font-size="20" font-weight="800" fill="url(#emeraldGrad)" letter-spacing="1">
          ✦ STUDENT FACE REGISTRATION PORTAL
        </text>
      </g>

      <!-- Description Subtext -->
      <text x="0" y="190" class="text-body" font-size="18" font-weight="500" fill="#cbd5e1" width="600">
        AI-Powered Contactless Attendance &amp; Security Platform
      </text>
      <text x="0" y="218" class="text-body" font-size="15" font-weight="400" fill="#94a3b8">
        Register student face biometrics in 10 seconds for automated daily attendance.
      </text>

      <!-- Feature Badges -->
      <g transform="translate(0, 246)">
        <!-- Badge 1 -->
        <rect x="0" y="0" width="180" height="34" rx="8" fill="#1e293b" fill-opacity="0.8" stroke="#334155" stroke-width="1" />
        <text x="14" y="22" class="text-sub" font-size="12" font-weight="700" fill="#38bdf8">⚡ 10-Second Setup</text>

        <!-- Badge 2 -->
        <rect x="195" y="0" width="200" height="34" rx="8" fill="#1e293b" fill-opacity="0.8" stroke="#334155" stroke-width="1" />
        <text x="210" y="22" class="text-sub" font-size="12" font-weight="700" fill="#34d399">🛡️ Bank-Grade Security</text>

        <!-- Badge 3 -->
        <rect x="410" y="0" width="190" height="34" rx="8" fill="#1e293b" fill-opacity="0.8" stroke="#334155" stroke-width="1" />
        <text x="424" y="22" class="text-sub" font-size="12" font-weight="700" fill="#fbcfe8">📱 Parent Portal Sync</text>
      </g>
    </g>

    <!-- Right Side: Futuristic Face AI Scanner HUD Card -->
    <g transform="translate(740, 68)" filter="url(#cardShadow)">
      <!-- Glass Card Background -->
      <rect x="0" y="0" width="400" height="425" rx="24" fill="url(#cardGrad)" stroke="#38bdf8" stroke-width="1.5" stroke-opacity="0.3" />
      
      <!-- Ambient Inner Top Gradient -->
      <rect x="1" y="1" width="398" height="60" rx="23" fill="#38bdf8" fill-opacity="0.08" />

      <!-- Status Header Inside HUD -->
      <g transform="translate(24, 28)">
        <circle cx="8" cy="8" r="5" fill="#10b981" />
        <text x="22" y="12" class="text-sub code-font" font-size="12" font-weight="700" fill="#34d399" letter-spacing="1">LIVE AI NEURAL SENSOR</text>
        <rect x="250" y="0" width="95" height="20" rx="10" fill="#10b981" fill-opacity="0.2" stroke="#10b981" stroke-width="1" />
        <text x="262" y="14" class="text-sub code-font" font-size="10" font-weight="700" fill="#34d399">VERIFIED</text>
      </g>

      <!-- Face Scanner Box Graphic -->
      <g transform="translate(60, 75)">
        <!-- Outer Scan Frame -->
        <rect x="0" y="0" width="280" height="240" rx="16" fill="#090d16" stroke="#1e293b" stroke-width="2" />
        
        <!-- Corner Targeting Brackets -->
        <!-- Top Left -->
        <path d="M 12 32 L 12 12 L 32 12" fill="none" stroke="#38bdf8" stroke-width="3" stroke-linecap="round" />
        <!-- Top Right -->
        <path d="M 248 12 L 268 12 L 268 32" fill="none" stroke="#38bdf8" stroke-width="3" stroke-linecap="round" />
        <!-- Bottom Left -->
        <path d="M 12 208 L 12 228 L 32 228" fill="none" stroke="#38bdf8" stroke-width="3" stroke-linecap="round" />
        <!-- Bottom Right -->
        <path d="M 248 228 L 268 228 L 268 208" fill="none" stroke="#38bdf8" stroke-width="3" stroke-linecap="round" />

        <!-- Center Face Silhouette Representation -->
        <g transform="translate(140, 110)">
          <!-- Face Oval -->
          <ellipse cx="0" cy="0" rx="46" ry="60" fill="none" stroke="#38bdf8" stroke-width="1.8" stroke-opacity="0.6" stroke-dasharray="4 3" />
          <!-- Eyes line -->
          <circle cx="-16" cy="-10" r="4" fill="#34d399" />
          <circle cx="16" cy="-10" r="4" fill="#34d399" />
          <!-- Nose Bridge -->
          <path d="M 0 -10 L 0 8 L 6 12" fill="none" stroke="#38bdf8" stroke-width="1.5" />
          <!-- Smile curve -->
          <path d="M -16 26 Q 0 36 16 26" fill="none" stroke="#34d399" stroke-width="1.8" />
          <!-- Forehead / Jaw Keypoints -->
          <circle cx="0" cy="-45" r="2.5" fill="#38bdf8" />
          <circle cx="0" cy="48" r="2.5" fill="#38bdf8" />
          <circle cx="-35" cy="8" r="2" fill="#38bdf8" />
          <circle cx="35" cy="8" r="2" fill="#38bdf8" />
          <!-- Laser Scan Line -->
          <line x1="-80" y1="6" x2="80" y2="6" stroke="#10b981" stroke-width="2" stroke-opacity="0.9" />
          <line x1="-80" y1="6" x2="80" y2="6" stroke="#34d399" stroke-width="6" stroke-opacity="0.2" />
        </g>

        <!-- Dynamic Detection Metrics inside box -->
        <text x="18" y="218" class="code-font" font-size="10" fill="#64748b">128-D ENCRYPTED DESCRIPTOR • CONF: 99.8%</text>
      </g>

      <!-- Bottom Card Detail -->
      <g transform="translate(30, 345)">
        <text x="0" y="16" class="title-school" font-size="14" font-weight="700" fill="#ffffff">PM SHRI KV NFC • ENROLLMENT</text>
        <text x="0" y="36" class="code-font" font-size="11" font-weight="500" fill="#38bdf8">https://presences.dev/enroll</text>
        <!-- Lock icon & security badge -->
        <g transform="translate(280, 0)">
          <rect x="0" y="0" width="60" height="28" rx="6" fill="#1e293b" stroke="#334155" stroke-width="1" />
          <text x="12" y="18" class="text-sub code-font" font-size="10" font-weight="700" fill="#10b981">AES-GCM</text>
        </g>
      </g>
    </g>

    <!-- Bottom Developer Branding Bar (Prominent & Stylish) -->
    <g transform="translate(60, 520)">
      <!-- Developer Glass Bar -->
      <rect x="0" y="0" width="1080" height="78" rx="20" fill="#0b1329" fill-opacity="0.9" stroke="#1e293b" stroke-width="1.5" />
      
      <!-- Glowing accent line inside bar -->
      <rect x="0" y="0" width="1080" height="2" rx="1" fill="url(#emeraldGrad)" />

      <!-- Left: Developer Avatar & Title -->
      <g transform="translate(18, -9)">
        <!-- Circular Glow around Developer Photo -->
        <circle cx="48" cy="48" r="38" fill="#10b981" fill-opacity="0.2" />
        <circle cx="48" cy="48" r="34" fill="#0f172a" stroke="#34d399" stroke-width="2.5" />
        <g clip-path="url(#circleDev)" transform="translate(-8, -8)">
          <image href="${gauravBase64}" x="0" y="0" width="112" height="112" />
        </g>
      </g>

      <!-- Developer Info Text -->
      <g transform="translate(115, 20)">
        <g transform="translate(0, 0)">
          <text x="0" y="16" class="title-school" font-size="17" font-weight="800" fill="#ffffff">
            Architected &amp; Engineered by <tspan fill="#38bdf8">Gaurav</tspan> <tspan fill="#94a3b8" font-size="14" font-weight="600">(Lead Developer)</tspan>
          </text>
          <text x="0" y="38" class="text-sub" font-size="12" font-weight="600" fill="#64748b">
            Team Leader • <tspan fill="#34d399">Team RCA</tspan> • Full-Stack AI &amp; School Systems
          </text>
        </g>
      </g>

      <!-- Right: Presences Ecosystem Tag -->
      <g transform="translate(730, 20)">
        <rect x="0" y="0" width="320" height="38" rx="12" fill="#1e293b" fill-opacity="0.6" stroke="#334155" stroke-width="1" />
        <text x="16" y="24" class="text-sub code-font" font-size="12" font-weight="700" fill="#f8fafc">
          PRESENCES AI <tspan fill="#38bdf8">• SMART SCHOOL PLATFORM</tspan>
        </text>
      </g>
    </g>

  </svg>
  `;

  // Render SVG to 1200x630 PNG using sharp
  const pngBuffer = await sharp(Buffer.from(svg))
    .png({ quality: 95, compressionLevel: 8 })
    .toBuffer();

  const targetPath = path.join(publicDir, 'og-enroll.png');
  fs.writeFileSync(targetPath, pngBuffer);
  console.log('✅ Generated og-enroll.png successfully at:', targetPath, `(${pngBuffer.length} bytes)`);

  // Also check if dist exists, if so copy it
  const distDir = path.join(rootDir, 'dist');
  if (fs.existsSync(distDir)) {
    fs.writeFileSync(path.join(distDir, 'og-enroll.png'), pngBuffer);
    console.log('✅ Copied og-enroll.png to dist/');
  }
}

generateEnrollOgImage().catch(console.error);
