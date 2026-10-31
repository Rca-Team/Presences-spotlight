import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import gauravPhoto from '@/assets/gaurav-photo.png';
import swamiAnantVyasPhoto from '@/assets/swami-anant-vyas.png';
import jatinDhamaPhoto from '@/assets/jatin-dhama.jpg';
import teamRcaPhoto from '@/assets/team-rca.jpg';
import studentCampusBanner from '@/assets/student-campus-banner.jpg';
import { getPortfolioFromIndexedDb, savePortfolioToIndexedDb } from '@/utils/portfolioCacheDb';

export const PORTFOLIO_KEY = 'gaurav_portfolio';
export const PORTFOLIO_BUCKET = 'face-images';
export const PORTFOLIO_PREFIX = 'portfolio/';

export type PortfolioProject = {
  id: string;
  title: string;
  description: string;
  stack: string;
  image: string;
  link: string;
  githubUrl?: string;
  year?: string;
  tags?: string[];
  featured?: boolean;
};

export type PortfolioMember = {
  id: string;
  name: string;
  role: string;
  bio: string;
  details?: string;
  image: string;
  tags?: string[];
  isRetired?: boolean;
  retiredAt?: string;
};

export type PortfolioSocials = {
  github?: string;
  linkedin?: string;
  twitter?: string;
  instagram?: string;
  youtube?: string;
};

export type PortfolioGalleryItem = {
  id: string;
  url: string;
  title?: string;
  category?: string;
  caption?: string;
  featured?: boolean;
  date?: string;
};

export type PortfolioCustomSettings = {
  showOnHome?: boolean;
  showGalleryOnHome?: boolean;
  homeGalleryLayout?: 'bento' | 'grid' | 'carousel';
  customBadge?: string;
  statusMessage?: string;
  heroGradient?: string;
};

export type PortfolioData = {
  name: string;
  role: string;
  tagline: string;
  bio: string;
  location: string;
  email: string;
  phone: string;
  website: string;
  profileImage: string;
  coverImage: string;
  achievements: string[];
  skills: string[];
  gallery: PortfolioGalleryItem[];
  projects: PortfolioProject[];
  members: PortfolioMember[];
  socials: PortfolioSocials;
  settings?: PortfolioCustomSettings;
};

const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;

export const DEFAULT_GALLERY_ITEMS: PortfolioGalleryItem[] = [
  {
    id: 'gal-team-rca',
    url: teamRcaPhoto,
    title: 'Team RCA — Core Platform Architects',
    category: 'Team',
    caption: 'The core engineering & design team behind Presences Smart School Automation.',
    featured: true,
  },
  {
    id: 'gal-campus-testing',
    url: studentCampusBanner,
    title: 'Campus Rollout & Gate Testing',
    category: 'Campus',
    caption: 'Live kiosk testing and face-recognition gate operation at KV NFC Vigyan Vihar.',
    featured: true,
  },
  {
    id: 'gal-gaurav-lead',
    url: gauravPhoto,
    title: 'Gaurav Raj — Lead Architect & Developer',
    category: 'Team',
    caption: 'Full-stack engineering & AI recognition engine development.',
    featured: false,
  },
  {
    id: 'gal-hardware-proto',
    url: swamiAnantVyasPhoto,
    title: 'Hardware & Smart Gate Prototyping',
    category: 'AI Tech',
    caption: 'Validating hardware gate sensors and live kiosk vision modes.',
    featured: false,
  },
  {
    id: 'gal-jatin-qa',
    url: jatinDhamaPhoto,
    title: 'Deployment & Quality Assurance',
    category: 'Team',
    caption: 'Coordinating live school testing and deployment operations.',
    featured: false,
  },
];

export const DEFAULT_PORTFOLIO: PortfolioData = {
  name: 'Gaurav Raj',
  role: 'Creator, Lead Architect & Full-Stack Systems Engineer',
  tagline: 'Conceived, architected, coded, and deployed the complete Presences AI ecosystem — spanning custom hardware, neural vision models, real-time cloud services, and production school operations.',
  bio: 'Creator, the developer, and lead coder of Presences AI. Gaurav engineered the entire platform from the ground up: from prototyping hardware gate kiosks, Raspberry Pi edge controllers, and sensor triggers, to programming neural face-recognition engines (ONNX, MediaPipe, Face-api.js), scalable cloud backends, native Android APKs, and autonomous campus automation deployed live at PM Shri KV NFC Vigyan Vihar.',
  location: 'Delhi, India',
  email: 'gauravraj10226@gmail.com',
  phone: '+91 9414741664',
  website: 'https://presences.dev',
  profileImage: gauravPhoto,
  coverImage: '',
  achievements: [
    'Sole Creator & Lead Coder — Conceived, designed, and coded the entire Presences AI platform from ground zero.',
    'Hardware & IoT Engineering — Designed and implemented Raspberry Pi edge attendance stations, dual-camera gate kiosks, buzzer circuits, and Linux systemd daemons.',
    'High-Speed Computer Vision — Architected neural face-recognition pipelines using ONNX Runtime, MediaPipe, YuNet, and Face-api.js with sub-100ms multi-student matching.',
    'Full-Stack Realtime Infrastructure — Built dual-cloud architecture with Supabase (PostgreSQL, RLS), Appwrite Realtime websockets, and offline IndexedDB resilience.',
    'Autonomous Timetable Substitution Engine — Developed algorithmic period detection with instant automatic teacher substitution and multi-format PDF export.',
    'Jarvis AI Diagnostics & Safety Suite — Created self-healing audit engine and campus-wide emergency broadcast system (fire, earthquake, lockdown).',
    'Native Mobile APK & Cross-Platform PWA — Shipped production Android APK via Capacitor with native camera integrations and responsive offline-first PWA.',
    'Live Institutional Deployment — Successfully rolled out and battle-tested the complete system at PM Shri KV NFC Vigyan Vihar.',
  ],
  skills: [
    'Full-Stack Software Architecture',
    'Hardware & Embedded IoT (Raspberry Pi)',
    'Computer Vision & Neural Networks (ONNX, MediaPipe, TF.js)',
    'React 18 & TypeScript',
    'Python (OpenCV, YuNet, Edge Daemons)',
    'Supabase & PostgreSQL RLS',
    'Appwrite Realtime & Cloudflare Workers',
    'Android & Capacitor Native Engineering',
    'Tailwind CSS & Modern UI/UX',
    'Progressive Web Apps (PWA) & Offline Sync',
    'Real-time WebSocket Distributed Systems',
    'Edge Computing & Hardware Prototyping',
  ],
  gallery: DEFAULT_GALLERY_ITEMS,
  projects: [
    {
      id: 'proj-presences-platform',
      title: 'Presences Smart School Platform',
      description: 'Unified attendance, gate mode, analytics, and communication platform built for PM Shri KV NFC Vigyan Vihar.',
      stack: 'React, TypeScript, Appwrite, Supabase, Face API, PWA',
      image: teamRcaPhoto,
      link: 'https://presences.dev',
      githubUrl: 'https://github.com/Gauravrajmeena',
      year: '2025',
      tags: ['React', 'TypeScript', 'AI Vision', 'PWA', 'Realtime'],
      featured: true,
    },
    {
      id: 'proj-spotlight-engine',
      title: 'Presences Spotlight Engine & Dual-Camera Kiosk',
      description: 'Custom hardware & Python edge engine with dual-camera FOV sync, MediaPipe Face Landmarker, and ONNX Runtime for live multi-student verification.',
      stack: 'Python, OpenCV, MediaPipe, ONNX Runtime, Hardware Relays',
      image: studentCampusBanner,
      link: 'https://presences.dev/gate',
      githubUrl: 'https://github.com/Gauravrajmeena',
      year: '2025',
      tags: ['Hardware Kiosk', 'Edge AI', 'MediaPipe', 'ONNX', 'Python'],
      featured: true,
    },
    {
      id: 'proj-raspberry-pi-station',
      title: 'Raspberry Pi IoT Edge Attendance Station',
      description: 'Standalone embedded attendance hardware running YuNet ONNX, local SQLite cache fallback, audio buzzer feedback chime, and systemd daemons.',
      stack: 'Raspberry Pi, Linux Systemd, Python, YuNet ONNX, SQLite',
      image: studentCampusBanner,
      link: 'https://presences.dev',
      githubUrl: 'https://github.com/Gauravrajmeena',
      year: '2025',
      tags: ['Raspberry Pi', 'IoT', 'Embedded Linux', 'Computer Vision'],
      featured: true,
    },
    {
      id: 'proj-substitution-engine',
      title: 'Autonomous Timetable & Teacher Substitution Engine',
      description: 'Real-time teacher absence detection and instant algorithmic period substitution scheduler with multi-format timetable PDF generation.',
      stack: 'React, Appwrite Realtime, Tailwind CSS, Lucide',
      image: teamRcaPhoto,
      link: 'https://presences.dev/admin?tab=timetable',
      githubUrl: 'https://github.com/Gauravrajmeena',
      year: '2025',
      tags: ['Realtime', 'Automation', 'Smart Scheduling', 'Algorithms'],
      featured: true,
    },
    {
      id: 'proj-jarvis-ai',
      title: 'Jarvis AI Diagnostics & Self-Healing Health Auditor',
      description: 'Autonomous institutional health audit engine featuring conversational voice query, biometric gap detection, and self-healing database diagnostics.',
      stack: 'TypeScript, Voice Synthesis, Anomaly Detection, Appwrite',
      image: teamRcaPhoto,
      link: 'https://presences.dev/admin',
      githubUrl: 'https://github.com/Gauravrajmeena',
      year: '2025',
      tags: ['Jarvis AI', 'Diagnostics', 'Self-Healing', 'Voice AI'],
      featured: true,
    },
    {
      id: 'proj-android-app',
      title: 'Presences Android App & Mobile Suite',
      description: 'Production Android APK packaged with Capacitor, featuring offline biometric synchronization, native camera integration, and instant push notifications.',
      stack: 'Capacitor, Android Java, Gradle, WebAssembly, IndexedDB',
      image: studentCampusBanner,
      link: 'https://presences.dev/mobile',
      githubUrl: 'https://github.com/Gauravrajmeena',
      year: '2025',
      tags: ['Android', 'Capacitor', 'Mobile APK', 'Offline Sync'],
      featured: true,
    },
  ],
  members: [
    {
      id: uid(),
      name: 'Gaurav Raj',
      role: 'Creator, Lead Developer & System Architect',
      image: gauravPhoto,
      bio: 'Creator and the lead coder of Presences AI. Conceived and coded the entire ecosystem across hardware, software, and AI vision.',
      details: 'Architected and implemented the entire project end-to-end: physical Raspberry Pi edge stations, dual-camera gate kiosks, MediaPipe/ONNX neural embeddings, Supabase/Appwrite realtime backends, Android Capacitor app, Jarvis self-healing engine, and campus emergency broadcasting.',
      tags: ['Creator & Lead Coder', 'Full-Stack Architect', 'Hardware & AI Engineer'],
      isRetired: false,
    },
    {
      id: uid(),
      name: 'Swami Anant Vyas',
      role: 'Hardware Prototype & Core Systems',
      image: swamiAnantVyasPhoto,
      bio: 'Helped build the hardware prototype and contributed core engineering ideas for the live software experience.',
      details: 'Built and validated early hardware concepts for kiosk gate mode, physical enclosures, and camera triggers.',
      isRetired: true,
      tags: ['Hardware & Core', 'Retired'],
    },
    {
      id: uid(),
      name: 'Jatin Dhama',
      role: 'Team Member · Gaming Wale',
      image: jatinDhamaPhoto,
      bio: 'Contributes to system testing, execution support, and live deployment coordination across the platform.',
      details: 'Supports feature QA, user feedback loops, and collaborative delivery for KV NFC Vigyan Vihar.',
    },
    {
      id: uid(),
      name: 'Jatin Maurya',
      role: 'Team Member · Bio Wale',
      image: '',
      bio: 'Contributes to interface workflows, student registration experiences, and module usability refinements.',
      details: 'Collaborates on smooth classroom flows, visual polish, and structured data management across modules.',
    },
    {
      id: uid(),
      name: 'Mayank Ranjan',
      role: 'Team Member · Bio Wale',
      image: '',
      bio: 'Supports real-world campus testing, attendance verification, and operational reliability checks.',
      details: 'Assists with batch enrollment validation, kiosk responsiveness testing, and rollout readiness.',
    },
  ],
  socials: {
    github: 'https://github.com/Gauravrajmeena',
    linkedin: '',
    twitter: '',
    instagram: '',
    youtube: '',
  },
  settings: {
    showOnHome: true,
    showGalleryOnHome: true,
    homeGalleryLayout: 'bento',
    customBadge: 'Team RCA · Core Lead',
    statusMessage: 'Available for AI & Automation Systems',
    heroGradient: 'neon',
  },
};

/** Normalize profile image to ensure dead Supabase URLs or invalid assets gracefully fallback to gauravPhoto */
export function normalizeProfileImage(url?: string | null): string {
  if (!url || typeof url !== 'string') return gauravPhoto;
  const clean = url.trim();
  if (
    !clean ||
    clean.includes('supabase.co') ||
    clean.includes('undefined') ||
    clean.includes('null') ||
    clean.includes('.asset.json') ||
    clean.startsWith('/__l5e/') ||
    clean.includes('cvdcbcsonlianbfeessy') ||
    clean.includes('eiahucigcvsnuvviajqt')
  ) {
    return gauravPhoto;
  }
  if (clean.includes('6abfd34f000604fcf074') || clean.includes('6accbd5d00053c5c1ac2')) {
    return clean
      .replace(/6abfd34f000604fcf074/g, '6ad309e200176195d398')
      .replace(/6accbd5d00053c5c1ac2/g, '6ad309e200176195d398');
  }
  return clean;
}

/** Normalize gallery array so legacy string URLs and rich objects work seamlessly */
export function normalizeGallery(rawGallery: any): PortfolioGalleryItem[] {
  if (!Array.isArray(rawGallery) || rawGallery.length === 0) {
    return DEFAULT_GALLERY_ITEMS;
  }

  return rawGallery
    .map((item, idx) => {
      if (typeof item === 'string') {
        let cleanUrl = item.trim();
        if (!cleanUrl) return null;
        if (cleanUrl.includes('supabase.co') || cleanUrl.includes('cvdcbcsonlianbfeessy') || cleanUrl.includes('eiahucigcvsnuvviajqt') || cleanUrl.includes('undefined') || cleanUrl.includes('null')) {
          cleanUrl = teamRcaPhoto;
        }
        return {
          id: `gal-migrated-${idx}-${Math.random().toString(36).slice(2, 6)}`,
          url: cleanUrl,
          title: `Campus Media #${idx + 1}`,
          category: 'Campus',
          caption: '',
          featured: idx === 0,
        };
      }
      if (item && typeof item === 'object' && item.url) {
        let cleanUrl = String(item.url).trim();
        if (!cleanUrl || cleanUrl.includes('supabase.co') || cleanUrl.includes('cvdcbcsonlianbfeessy') || cleanUrl.includes('eiahucigcvsnuvviajqt') || cleanUrl.includes('undefined') || cleanUrl.includes('null')) {
          cleanUrl = teamRcaPhoto;
        }
        return {
          id: item.id || `gal-${idx}-${uid()}`,
          url: cleanUrl,
          title: item.title || '',
          category: item.category || 'Campus',
          caption: item.caption || '',
          featured: Boolean(item.featured),
          date: item.date || '',
        };
      }
      return null;
    })
    .filter(Boolean) as PortfolioGalleryItem[];
}

function migrate(raw: any): PortfolioData {
  const base = { ...DEFAULT_PORTFOLIO, ...(raw ?? {}) };
  base.profileImage = normalizeProfileImage(base.profileImage);
  if (base.coverImage && (base.coverImage.includes('supabase.co') || base.coverImage.includes('cvdcbcsonlianbfeessy') || base.coverImage.includes('eiahucigcvsnuvviajqt'))) {
    base.coverImage = '';
  }

  // Upgrade legacy placeholder role/bio/tagline to full creator profile
  if (
    !base.role ||
    base.role === 'Full Stack Developer & Team Leader' ||
    !base.bio ||
    base.bio.startsWith('I design and ship')
  ) {
    base.role = DEFAULT_PORTFOLIO.role;
    base.tagline = DEFAULT_PORTFOLIO.tagline;
    base.bio = DEFAULT_PORTFOLIO.bio;
  }

  // Upgrade legacy achievements (length <= 4 or missing hardware/AI highlights)
  const rawAch = Array.isArray(raw?.achievements) ? raw.achievements : [];
  if (rawAch.length <= 4 || !rawAch.some((a: string) => a.toLowerCase().includes('hardware'))) {
    base.achievements = DEFAULT_PORTFOLIO.achievements;
  } else {
    base.achievements = rawAch;
  }

  // Upgrade legacy skills (length <= 7 or missing hardware/embedded)
  const rawSkills = Array.isArray(raw?.skills) ? raw.skills : [];
  if (rawSkills.length <= 7 || !rawSkills.some((s: string) => s.toLowerCase().includes('hardware'))) {
    base.skills = DEFAULT_PORTFOLIO.skills;
  } else {
    base.skills = rawSkills;
  }

  // Upgrade legacy placeholder contact information to authentic information
  if (!base.email || base.email === 'gaurav@example.com') {
    base.email = DEFAULT_PORTFOLIO.email;
  }
  if (!base.phone || base.phone.includes('00000') || base.phone.includes('9868901664')) {
    base.phone = DEFAULT_PORTFOLIO.phone;
  }
  if (!base.location || base.location === 'India') {
    base.location = DEFAULT_PORTFOLIO.location;
  }

  base.gallery = normalizeGallery(raw?.gallery);
  let migratedGithub = (raw?.socials?.github || '').trim();
  if (!migratedGithub || migratedGithub.includes('Presences-spotlight') || migratedGithub.endsWith('/')) {
    migratedGithub = DEFAULT_PORTFOLIO.socials.github;
  }
  base.socials = {
    ...DEFAULT_PORTFOLIO.socials,
    ...(raw?.socials ?? {}),
    github: migratedGithub,
  };
  base.settings = { ...DEFAULT_PORTFOLIO.settings, ...(raw?.settings ?? {}) };
  
  // Merge and migrate projects, ensuring comprehensive hardware/AI projects exist
  const existingProjects = Array.isArray(raw?.projects) && raw.projects.length > 0 ? raw.projects : [];
  const mergedProjects = [...existingProjects];

  for (const defProj of DEFAULT_PORTFOLIO.projects) {
    const exists = mergedProjects.some((p: any) => p.id === defProj.id || p.title?.toLowerCase() === defProj.title?.toLowerCase());
    if (!exists) {
      mergedProjects.push(defProj);
    }
  }

  base.projects = mergedProjects.map((p: any) => {
    let pImg = p.image ? String(p.image).trim() : '';
    if (
      !pImg ||
      pImg.includes('supabase.co') ||
      pImg.includes('cvdcbcsonlianbfeessy') ||
      pImg.includes('eiahucigcvsnuvviajqt') ||
      pImg.includes('undefined') ||
      pImg.includes('null')
    ) {
      pImg = teamRcaPhoto;
    }
    let pGithub = p.githubUrl ? String(p.githubUrl).trim() : '';
    if (!pGithub || pGithub.includes('Presences-spotlight')) {
      pGithub = 'https://github.com/Gauravrajmeena';
    }
    return {
      id: p.id ?? uid(),
      title: p.title ?? '',
      description: p.description ?? '',
      stack: p.stack ?? '',
      image: pImg,
      link: p.link ?? '',
      githubUrl: pGithub,
      year: p.year ?? '',
      tags: Array.isArray(p.tags) ? p.tags : [],
      featured: Boolean(p.featured),
    };
  });

  const rawMembers = Array.isArray(raw?.members) && raw.members.length > 0 ? [...raw.members] : [...DEFAULT_PORTFOLIO.members];

  // Ensure newly added core members are present in migrated member lists
  for (const defMember of DEFAULT_PORTFOLIO.members) {
    const defKey = defMember.name.toLowerCase().trim();
    const exists = rawMembers.some((m: any) => {
      const n = String(m?.name || '').toLowerCase().trim();
      if (defKey === 'jatin maurya') return n.includes('maurya');
      if (defKey === 'jatin dhama') return n.includes('dhama') || n === 'jatin';
      if (defKey.includes('mayank')) return n.includes('mayank');
      if (defKey.includes('swami') || defKey.includes('anant')) return n.includes('swami') || n.includes('anant');
      if (defKey.includes('gaurav')) return n.includes('gaurav');
      return n === defKey;
    });
    if (!exists) {
      rawMembers.push(defMember);
    }
  }

  base.members = rawMembers.map((m: any) => {
    let img = m.image ? String(m.image).trim() : '';
    const norm = (m.name || '').toLowerCase().trim();
    const isGaurav = norm.includes('gaurav');

    if (
      !img ||
      img.includes('supabase.co') ||
      img.includes('cvdcbcsonlianbfeessy') ||
      img.includes('eiahucigcvsnuvviajqt') ||
      img.includes('.asset.json') ||
      img.startsWith('/__l5e/') ||
      img.includes('undefined') ||
      img.includes('null')
    ) {
      if (isGaurav) img = gauravPhoto;
      else if (norm.includes('swami') || norm.includes('anant')) img = swamiAnantVyasPhoto;
      else if (norm.includes('dhama') || norm === 'jatin') img = jatinDhamaPhoto;
      else img = '';
    } else if (img.includes('6abfd34f000604fcf074') || img.includes('6accbd5d00053c5c1ac2')) {
      img = img
        .replace(/6abfd34f000604fcf074/g, '6ad309e200176195d398')
        .replace(/6accbd5d00053c5c1ac2/g, '6ad309e200176195d398');
    }

    if (isGaurav) {
      // Upgrade Gaurav's role, bio and details to the complete Creator & Lead Architect profile
      return {
        id: m.id ?? uid(),
        name: 'Gaurav Raj',
        role: 'Creator, Lead Developer & System Architect',
        image: gauravPhoto,
        bio: 'Creator and the lead coder of Presences AI. Conceived and coded the entire ecosystem across hardware, software, and AI vision.',
        details: 'Architected and implemented the entire project end-to-end: physical Raspberry Pi edge stations, dual-camera gate kiosks, MediaPipe/ONNX neural embeddings, Supabase/Appwrite realtime backends, Android Capacitor app, Jarvis self-healing engine, and campus emergency broadcasting.',
        tags: ['Creator & Lead Coder', 'Full-Stack Architect', 'Hardware & AI Engineer'],
        isRetired: false,
        retiredAt: undefined,
      };
    }

    const resolvedName = norm === 'mayank' ? 'Mayank Ranjan' : (m.name ?? '');
    return {
      id: m.id ?? uid(),
      name: resolvedName,
      role: m.role ?? '',
      image: img,
      bio: m.bio ?? '',
      details: m.details ?? '',
      tags: Array.isArray(m.tags) ? m.tags : undefined,
      isRetired: typeof m.isRetired === 'boolean' ? m.isRetired : (norm.includes('swami') || norm.includes('anant') || (m.role && m.role.toLowerCase().includes('retired'))),
      retiredAt: m.retiredAt ?? undefined,
    };
  });

  return base as PortfolioData;
}

/** Read-only hook for public surfaces (Home, About Me, Portfolio). Subscribes to realtime updates & local sync. */
export function usePortfolioData() {
  const [data, setData] = useState<PortfolioData>(() => {
    try {
      const cached = localStorage.getItem('gaurav_portfolio_cache');
      if (cached) {
        const parsed = JSON.parse(cached);
        const migrated = migrate(parsed);
        // Persist clean migrated structure if legacy dead URLs were detected
        if (parsed.profileImage !== migrated.profileImage) {
          try { localStorage.setItem('gaurav_portfolio_cache', JSON.stringify(migrated)); } catch {}
        }
        return migrated;
      }
    } catch {
      /* ignore */
    }
    return DEFAULT_PORTFOLIO;
  });
  const [loading, setLoading] = useState(true);

  const fetchOnce = useCallback(async () => {
    try {
      // Check IndexedDB cache first
      try {
        const idbCached = await getPortfolioFromIndexedDb();
        if (idbCached) setData(migrate(idbCached));
      } catch {
        /* keep */
      }

      const { data: row } = await supabase
        .from('attendance_settings')
        .select('*')
        .or(`key.eq.${PORTFOLIO_KEY},setting_key.eq.${PORTFOLIO_KEY}`)
        .maybeSingle();

      const rawVal = row?.value || (row as any)?.setting_value;
      if (rawVal) {
        try {
          const parsed = migrate(typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal);
          setData(parsed);
          await savePortfolioToIndexedDb(parsed);
          try {
            localStorage.setItem('gaurav_portfolio_cache', JSON.stringify(parsed));
          } catch {
            /* quota limit safe */
          }
        } catch {
          /* keep defaults */
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchOnce();

    // Local instant updates from studio
    const onLocalUpdate = (e: CustomEvent<PortfolioData>) => {
      if (e.detail) setData(e.detail);
    };
    window.addEventListener('portfolio-updated', onLocalUpdate as EventListener);

    // Cross-tab broadcast listener for instant synchronization across tabs
    let broadcastChannel: BroadcastChannel | null = null;
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        broadcastChannel = new BroadcastChannel('presences_portfolio_broadcast');
        broadcastChannel.onmessage = (e) => {
          if (e.data) {
            setData(migrate(e.data));
          }
        };
      }
    } catch (err) {
      console.warn('BroadcastChannel init notice:', err);
    }

    // Refresh data when user switches back to the tab
    const onFocusOrVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        void fetchOnce();
      }
    };
    window.addEventListener('focus', onFocusOrVisible);
    window.addEventListener('visibilitychange', onFocusOrVisible);

    // Supabase / Appwrite realtime channel with safe error boundary
    let channel: any = null;
    try {
      channel = supabase
        .channel('portfolio-live')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'attendance_settings' },
          async (payload: any) => {
            const doc = (payload.new as any) || (payload.old as any);
            if (!doc) return;
            const k = doc.setting_key || doc.key;
            if (k !== PORTFOLIO_KEY) return;
            const raw = doc.setting_value ?? doc.value;
            if (!raw) return;
            try {
              const parsed = migrate(typeof raw === 'string' ? JSON.parse(raw) : raw);
              setData(parsed);
              await savePortfolioToIndexedDb(parsed);
              try {
                localStorage.setItem('gaurav_portfolio_cache', JSON.stringify(parsed));
                localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(parsed));
              } catch {
                /* quota limit safe */
              }
            } catch (e) {
              /* ignore parse notice */
            }
          },
        )
        .subscribe();
    } catch {
      /* ignore realtime connection error */
    }

    return () => {
      window.removeEventListener('portfolio-updated', onLocalUpdate as EventListener);
      window.removeEventListener('focus', onFocusOrVisible);
      window.removeEventListener('visibilitychange', onFocusOrVisible);
      if (broadcastChannel) {
        try {
          broadcastChannel.close();
        } catch {}
      }
      if (channel) {
        try {
          void supabase.removeChannel(channel);
        } catch {}
      }
    };
  }, [fetchOnce]);

  return { data, loading, refetch: fetchOnce };
}

export { uid as portfolioUid, migrate as migratePortfolioData };

/** Real-time live persistence helper: updates IndexedDB, dispatches custom event, broadcasts cross-tab, updates localStorage, and syncs cloud */
export async function persistPortfolioDataLive(portfolioData: PortfolioData): Promise<void> {
  try {
    await savePortfolioToIndexedDb(portfolioData);
    window.dispatchEvent(new CustomEvent('portfolio-updated', { detail: portfolioData }));
    
    // Broadcast instantly to all other browser tabs/windows
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        const bc = new BroadcastChannel('presences_portfolio_broadcast');
        bc.postMessage(portfolioData);
        bc.close();
      }
    } catch (err) {
      console.warn('BroadcastChannel postMessage notice:', err);
    }

    try {
      localStorage.setItem('gaurav_portfolio_cache', JSON.stringify(portfolioData));
      localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(portfolioData));
    } catch {}

    const payload = JSON.stringify(portfolioData);
    const settingsPayload = {
      key: PORTFOLIO_KEY,
      value: payload,
      setting_key: PORTFOLIO_KEY,
      setting_value: payload,
      updated_at: new Date().toISOString(),
    };

    const { data: existing } = await supabase
      .from('attendance_settings')
      .select('id, setting_key, key')
      .or(`key.eq.${PORTFOLIO_KEY},setting_key.eq.${PORTFOLIO_KEY}`)
      .maybeSingle();

    if (existing?.id) {
      await supabase.from('attendance_settings').update(settingsPayload).eq('id', existing.id);
    } else {
      await supabase.from('attendance_settings').insert(settingsPayload);
    }
  } catch (err) {
    console.warn('Realtime portfolio sync notice:', err);
  }
}
