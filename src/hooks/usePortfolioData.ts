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
  role: 'Full Stack Developer & Team Leader',
  tagline: 'Building practical school automation systems for real-world scale.',
  bio: 'I design and ship full-stack products with a focus on reliability, realtime workflows, and meaningful user experience.',
  location: 'India',
  email: 'gaurav@example.com',
  phone: '+91 00000 00000',
  website: 'https://presences.dev',
  profileImage: gauravPhoto,
  coverImage: '',
  achievements: [
    'Led end-to-end delivery of smart attendance platform',
    'Built face-recognition gate mode with realtime alerts',
    'Shipped scalable admin workflows for school operations',
    'Architected instant timetable automatic teacher substitution engine',
  ],
  skills: ['React', 'TypeScript', 'Appwrite', 'Face Recognition', 'Realtime Systems', 'Tailwind CSS', 'PWA & Edge AI'],
  gallery: DEFAULT_GALLERY_ITEMS,
  projects: [
    {
      id: 'proj-presences-platform',
      title: 'Presences Smart School Platform',
      description: 'Unified attendance, gate mode, analytics, and communication platform built for PM Shri KV NFC Vigyan Vihar.',
      stack: 'React, TypeScript, Appwrite, Face API, PWA',
      image: teamRcaPhoto,
      link: 'https://presences.dev',
      githubUrl: 'https://github.com/Rca-Team/Presences-spotlight',
      year: '2025',
      tags: ['React', 'TypeScript', 'AI Vision', 'PWA', 'Appwrite'],
      featured: true,
    },
    {
      id: 'proj-gate-kiosk',
      title: 'Edge AI Kiosk & Gate Security',
      description: 'High-precision on-device facial detection and dual-camera gate security system for instant multi-student verification.',
      stack: 'TensorFlow.js, WebAssembly, ONNX Runtime, Canvas',
      image: studentCampusBanner,
      link: 'https://presences.dev/gate',
      githubUrl: 'https://github.com/Rca-Team/Presences-spotlight',
      year: '2025',
      tags: ['Edge AI', 'Computer Vision', 'ONNX', 'Wasm'],
      featured: true,
    },
    {
      id: 'proj-substitution-engine',
      title: 'Real-Time Substitution & Timetable Engine',
      description: 'Autonomous teacher leave detection and instant period substitution scheduler with multi-format PDF export.',
      stack: 'React, Appwrite Realtime, Tailwind CSS, Lucide',
      image: teamRcaPhoto,
      link: 'https://presences.dev/admin?tab=timetable',
      githubUrl: 'https://github.com/Rca-Team/Presences-spotlight',
      year: '2025',
      tags: ['Realtime', 'Automation', 'Smart Scheduling'],
      featured: true,
    },
  ],
  members: [
    {
      id: uid(),
      name: 'Gaurav',
      role: 'Developer & Team Leader',
      image: gauravPhoto,
      bio: 'Creator of Presences Smart School automation. Designs and leads scalable attendance, security, and school workflow systems.',
      details: 'Full-stack engineer focused on neural face-recognition pipelines, database architecture, and production-ready education systems.',
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
  socials: { github: '', linkedin: '', twitter: '', instagram: '', youtube: '' },
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
  base.achievements = Array.isArray(raw?.achievements) && raw.achievements.length > 0 ? raw.achievements : DEFAULT_PORTFOLIO.achievements;
  base.skills = Array.isArray(raw?.skills) && raw.skills.length > 0 ? raw.skills : DEFAULT_PORTFOLIO.skills;
  base.gallery = normalizeGallery(raw?.gallery);
  base.socials = { ...DEFAULT_PORTFOLIO.socials, ...(raw?.socials ?? {}) };
  base.settings = { ...DEFAULT_PORTFOLIO.settings, ...(raw?.settings ?? {}) };
  
  base.projects = (Array.isArray(raw?.projects) && raw.projects.length > 0 ? raw.projects : DEFAULT_PORTFOLIO.projects).map((p: any) => {
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
    return {
      id: p.id ?? uid(),
      title: p.title ?? '',
      description: p.description ?? '',
      stack: p.stack ?? '',
      image: pImg,
      link: p.link ?? '',
      githubUrl: p.githubUrl ?? '',
      year: p.year ?? '',
      tags: Array.isArray(p.tags) ? p.tags : [],
      featured: Boolean(p.featured),
    };
  });

  const rawMembers = Array.isArray(raw?.members) && raw.members.length > 0 ? [...raw.members] : [...DEFAULT_PORTFOLIO.members];

  // Ensure newly added core members (Jatin Maurya, Mayank Ranjan) are present in migrated member lists
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
      if (norm.includes('gaurav')) img = gauravPhoto;
      else if (norm.includes('swami') || norm.includes('anant')) img = swamiAnantVyasPhoto;
      else if (norm.includes('dhama') || norm === 'jatin') img = jatinDhamaPhoto;
      else img = '';
    } else if (img.includes('6abfd34f000604fcf074') || img.includes('6accbd5d00053c5c1ac2')) {
      img = img
        .replace(/6abfd34f000604fcf074/g, '6ad309e200176195d398')
        .replace(/6accbd5d00053c5c1ac2/g, '6ad309e200176195d398');
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
