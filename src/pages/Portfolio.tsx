import React, { useEffect, useMemo, useState } from 'react';
import PageLayout from '@/components/layouts/PageLayout';
import PageTransition from '@/components/PageTransition';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Lock,
  Unlock,
  Delete,
  Save,
  Plus,
  Trophy,
  ExternalLink,
  Github,
  Linkedin,
  Twitter,
  Instagram,
  Youtube,
  Trash2,
  GripVertical,
  Sparkles,
  MapPin,
  Mail,
  Phone,
  Globe,
  RotateCcw,
  Eye,
  Edit3,
  Users,
  Briefcase,
  Image as ImageIcon,
  CheckCircle2,
  ArrowRight,
  UserCheck,
  SlidersHorizontal,
  LayoutGrid,
  Clock,
  UserMinus,
  History,
  Award,
  X,
} from 'lucide-react';
import {
  DEFAULT_PORTFOLIO,
  PORTFOLIO_KEY,
  type PortfolioData,
  type PortfolioProject,
  type PortfolioMember,
  type PortfolioGalleryItem,
  migratePortfolioData,
  normalizeProfileImage,
  portfolioUid,
  persistPortfolioDataLive,
} from '@/hooks/usePortfolioData';
import {
  verifyPortfolioPin,
  updatePortfolioPin,
  isPortfolioSessionVerified,
  setPortfolioSessionVerified,
  getRemainingLockoutSeconds,
} from '@/services/portfolioSecurityService';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { KeyRound, ShieldCheck, Loader2 } from 'lucide-react';
import { ImageDropzone } from '@/components/portfolio/ImageDropzone';
import { BatchGalleryUploader } from '@/components/portfolio/BatchGalleryUploader';
import { HomeGallery } from '@/components/portfolio/HomeGallery';
import { MemberAvatar } from '@/components/portfolio/MemberAvatar';
import { savePortfolioToIndexedDb, getPortfolioFromIndexedDb } from '@/utils/portfolioCacheDb';
import { uploadPortfolioImage } from '@/utils/portfolioUploadHelper';
import teamRcaPhoto from '@/assets/team-rca.jpg';
import gauravPhoto from '@/assets/gaurav-photo.png';
import swamiAnantVyasPhoto from '@/assets/swami-anant-vyas.png';
import jatinDhamaPhoto from '@/assets/jatin-dhama.jpg';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';


/* ------------------------------------------------------------------ */
/* Sortable wrapper                                                    */
/* ------------------------------------------------------------------ */

function SortableItem({ id, children }: { id: string; children: (handle: React.ReactNode) => React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const handle = (
    <button
      type="button"
      className="cursor-grab touch-none rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground active:cursor-grabbing"
      aria-label="Drag to reorder"
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-4 w-4" />
    </button>
  );
  return (
    <div ref={setNodeRef} style={style}>
      {children(handle)}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Public View Component                                              */
/* ------------------------------------------------------------------ */

export function PublicPortfolioView({
  data,
  onUnlock,
  onUpdateData,
  showGallery = true,
  showProjects = true,
  showAchievements = true,
  canManage = false,
}: {
  data: PortfolioData;
  onUnlock?: () => void;
  onUpdateData?: (newData: PortfolioData) => void;
  showGallery?: boolean;
  showProjects?: boolean;
  showAchievements?: boolean;
  canManage?: boolean;
}) {
  const { toast } = useToast();
  const [selectedMember, setSelectedMember] = useState<PortfolioMember | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isNewMemberRetired, setIsNewMemberRetired] = useState(false);

  const handleLiveToggleRetire = async (mId: string) => {
    const target = data.members.find((m) => m.id === mId);
    if (!target) return;
    const newRetired = !target.isRetired;
    const updatedMembers = data.members.map((m) =>
      m.id === mId
        ? {
            ...m,
            isRetired: newRetired,
            retiredAt: newRetired ? 'Emeritus' : undefined,
          }
        : m
    );
    const nextData = { ...data, members: updatedMembers };
    if (onUpdateData) {
      onUpdateData(nextData);
    }
    await persistPortfolioDataLive(nextData);
    toast({
      title: newRetired ? 'Member Marked as Retired' : 'Retirement Undone',
      description: `${target.name} is now ${newRetired ? 'retired (emeritus)' : 'active in the core team'} in real time.`,
    });
    if (selectedMember && selectedMember.id === mId) {
      setSelectedMember(updatedMembers.find((m) => m.id === mId) || null);
    }
  };

  const handleLiveRemoveMember = async (mId: string) => {
    const target = data.members.find((m) => m.id === mId);
    if (!target) return;
    if (!window.confirm(`Are you sure you want to remove ${target.name} from Team RCA?`)) return;
    const nextData = { ...data, members: data.members.filter((m) => m.id !== mId) };
    if (onUpdateData) {
      onUpdateData(nextData);
    }
    await persistPortfolioDataLive(nextData);
    toast({
      title: 'Member Removed Live',
      description: `${target.name} has been removed from the roster in real time.`,
    });
    setSelectedMember(null);
  };

  const handleLiveAddMember = async (
    name: string,
    role: string,
    bio: string,
    tags: string[],
    isRetired: boolean
  ) => {
    const newMember: PortfolioMember = {
      id: portfolioUid(),
      name: name.trim() || 'New Team Member',
      role: role.trim() || 'Contributor',
      bio: bio.trim(),
      details: '',
      image: '',
      tags: tags.length > 0 ? tags : ['Contributor'],
      isRetired,
    };
    const nextData = { ...data, members: [...data.members, newMember] };
    if (onUpdateData) {
      onUpdateData(nextData);
    }
    await persistPortfolioDataLive(nextData);
    toast({
      title: 'Member Added Live',
      description: `${newMember.name} joined Team RCA roster in real time.`,
    });
    setIsAddModalOpen(false);
  };

  return (
    <section className="space-y-10 md:space-y-14 pb-12 md:pb-16 min-w-0">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-3xl border border-white/15 bg-card/60 backdrop-blur-2xl shadow-2xl">
        {/* Cover Photo */}
        <div
          className="h-44 sm:h-56 md:h-72 w-full bg-gradient-to-br from-primary/35 via-accent/25 to-primary/10 relative overflow-hidden"
          style={data.coverImage ? { backgroundImage: `url(${data.coverImage})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
        >
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/25 to-transparent" />
        </div>

        <div className="px-5 sm:px-8 md:px-12 pb-6 md:pb-8 relative">
          <div className="-mt-16 sm:-mt-20 md:-mt-24 flex flex-col md:flex-row md:items-end justify-between gap-5">
            <div className="flex flex-col sm:flex-row sm:items-end gap-4 sm:gap-6">
              <div className="relative group">
                <div className="p-1 rounded-3xl bg-gradient-to-tr from-cyan-400 via-primary to-purple-500 shadow-xl shadow-primary/25 transition-transform duration-300 group-hover:scale-105">
                  <img
                    src={normalizeProfileImage(data.profileImage) || gauravPhoto}
                    alt={data.name || 'Gaurav'}
                    className="h-28 w-28 sm:h-36 sm:w-36 md:h-44 md:w-44 rounded-[22px] border-2 border-background object-cover shadow-2xl bg-card"
                    loading="eager"
                    onError={(e) => {
                      const target = e.currentTarget;
                      if (target.src !== gauravPhoto) {
                        target.src = gauravPhoto;
                      }
                    }}
                  />
                </div>
                <span className="absolute bottom-2 right-2 flex h-4 w-4">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-4 w-4 bg-emerald-500 border-2 border-background" />
                </span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/15 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-primary">
                  <Sparkles className="h-3.5 w-3.5" /> {data.settings?.customBadge || 'Core Team Lead'}
                </div>
                <h1 className="mt-2 text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-foreground" style={{ fontFamily: 'Sora, sans-serif' }}>
                  {data.name}
                </h1>
                <p className="text-sm md:text-base font-semibold text-primary/90 mt-1">{data.role}</p>
                {data.tagline && (
                  <p className="mt-2 text-sm md:text-base text-muted-foreground max-w-2xl leading-relaxed">
                    {data.tagline}
                  </p>
                )}
              </div>
            </div>

            {/* Social Links & Edit Button */}
            <div className="flex flex-wrap items-center gap-2 pt-2 md:pt-0">
              {data.socials?.github && (
                <a
                  href={data.socials.github}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-border/70 bg-card/60 p-2.5 hover:bg-muted hover:text-primary transition shadow-sm"
                  title="GitHub Profile"
                >
                  <Github className="h-4 w-4" />
                </a>
              )}
              {data.socials?.linkedin && (
                <a
                  href={data.socials.linkedin}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-border/70 bg-card/60 p-2.5 hover:bg-muted hover:text-primary transition shadow-sm"
                  title="LinkedIn Profile"
                >
                  <Linkedin className="h-4 w-4" />
                </a>
              )}
              {data.socials?.twitter && (
                <a
                  href={data.socials.twitter}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-border/70 bg-card/60 p-2.5 hover:bg-muted hover:text-primary transition shadow-sm"
                  title="Twitter / X"
                >
                  <Twitter className="h-4 w-4" />
                </a>
              )}
              {data.socials?.instagram && (
                <a
                  href={data.socials.instagram}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-border/70 bg-card/60 p-2.5 hover:bg-muted hover:text-primary transition shadow-sm"
                  title="Instagram"
                >
                  <Instagram className="h-4 w-4" />
                </a>
              )}
              {data.socials?.youtube && (
                <a
                  href={data.socials.youtube}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-xl border border-border/70 bg-card/60 p-2.5 hover:bg-muted hover:text-primary transition shadow-sm"
                  title="YouTube Channel"
                >
                  <Youtube className="h-4 w-4" />
                </a>
              )}
              {onUnlock && (
                <Button size="sm" variant="outline" onClick={onUnlock} className="rounded-xl gap-1.5 font-semibold">
                  <Lock className="h-3.5 w-3.5" /> Studio Editor
                </Button>
              )}
            </div>
          </div>

          {/* Contact & Meta Strip */}
          <div className="mt-6 pt-5 border-t border-border/60 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-xs font-medium">
            {data.location && (
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300 min-w-0">
                <MapPin className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate">{data.location}</span>
              </div>
            )}
            {data.email && (
              <a href={`mailto:${data.email}`} className="flex items-center gap-2 text-slate-600 dark:text-slate-300 hover:text-foreground min-w-0 transition">
                <Mail className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate">{data.email}</span>
              </a>
            )}
            {data.phone && (
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300 min-w-0">
                <Phone className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate">{data.phone}</span>
              </div>
            )}
            {data.website && (
              <a href={data.website} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-slate-600 dark:text-slate-300 hover:text-foreground min-w-0 transition">
                <Globe className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate">{data.website.replace(/^https?:\/\//, '')}</span>
              </a>
            )}
          </div>

          {data.bio && (
            <p className="mt-5 max-w-3xl text-sm md:text-base text-slate-700 dark:text-slate-300 font-medium leading-relaxed">
              {data.bio}
            </p>
          )}
        </div>
      </div>

      {/* Featured Projects */}
      {showProjects && data.projects.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl md:text-2xl font-extrabold text-foreground flex items-center gap-2">
              <Briefcase className="h-5 w-5 text-primary" /> Featured Projects
            </h2>
            <span className="text-xs text-muted-foreground font-semibold">{data.projects.length} Projects</span>
          </div>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {data.projects.map((p) => (
              <motion.article
                key={p.id}
                whileHover={{ y: -4 }}
                transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                className="group relative overflow-hidden rounded-3xl border border-white/10 bg-card/70 backdrop-blur shadow-md flex flex-col justify-between"
              >
                <div className="relative aspect-video overflow-hidden bg-muted/40 group-hover:shadow-lg transition-shadow">
                  {p.image ? (
                    <img
                      src={p.image}
                      alt={p.title}
                      className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-110"
                      loading="lazy"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-muted-foreground">
                      <Sparkles className="h-8 w-8 opacity-40" />
                    </div>
                  )}
                  {/* Hover Light Sheen */}
                  <div className="pointer-events-none absolute -inset-full bg-gradient-to-r from-transparent via-white/20 to-transparent -rotate-45 translate-x-[-150%] group-hover:translate-x-[150%] transition-transform duration-1000 ease-in-out" />
                  {p.year && (
                    <span className="absolute right-3 top-3 rounded-full border border-white/20 bg-background/90 px-2.5 py-0.5 text-[10px] font-bold text-foreground shadow-sm backdrop-blur-md">
                      {p.year}
                    </span>
                  )}
                </div>

                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="text-base font-bold text-foreground group-hover:text-primary transition-colors">
                      {p.title}
                    </h3>
                    <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground leading-relaxed">
                      {p.description}
                    </p>

                    {(p.tags && p.tags.length > 0) || p.stack ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {(p.tags && p.tags.length > 0 ? p.tags : p.stack.split(',').map((s) => s.trim()).filter(Boolean)).map((t) => (
                          <span key={t} className="rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-[10px] font-semibold text-primary">
                            {t}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-5 pt-3 border-t border-border/40 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {p.link && (
                        <a href={p.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:underline">
                          <ExternalLink className="h-3.5 w-3.5" /> Live Demo
                        </a>
                      )}
                      {p.githubUrl && (
                        <a href={p.githubUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
                          <Github className="h-3.5 w-3.5" /> Code
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        </div>
      )}

      {/* Team RCA Creators Section — Logically Ordered: Active Core & Retired Emeritus */}
      {data.members.length > 0 && (() => {
        const activeMembers = data.members.filter((m) => !m.isRetired);
        const retiredMembers = data.members.filter((m) => Boolean(m.isRetired));

        return (
          <div className="space-y-6">
            {/* Team Header Banner */}
            <div className="relative overflow-hidden rounded-3xl border border-amber-300/30 bg-[#090503] shadow-xl backdrop-blur-xl">
              <div className="relative h-56 sm:h-72 md:h-80 w-full overflow-hidden">
                <img
                  src={teamRcaPhoto}
                  alt="Team RCA Creators"
                  className="h-[124%] w-full object-cover object-top"
                  loading="lazy"
                />
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black via-black/45 to-transparent" />
                <div className="absolute left-4 bottom-4 sm:left-6 sm:bottom-6">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-300/40 bg-black/60 px-3 py-1 text-xs font-black uppercase tracking-widest text-amber-300 backdrop-blur-md">
                    <Sparkles className="h-3 w-3" /> Team RCA Core
                  </span>
                  <h2 className="mt-1.5 text-xl sm:text-2xl md:text-3xl font-extrabold text-white" style={{ fontFamily: 'Sora, sans-serif' }}>
                    The Minds Behind Presences AI
                  </h2>
                </div>
              </div>
            </div>

            {/* Roster Summary Command Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border/50">
              <div>
                <h3 className="text-lg md:text-xl font-bold text-foreground flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" /> Core Architects &amp; Contributors
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Real-time engineering roster: manage active status, mark/undo retirement, and add or remove members live.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-bold text-emerald-600 dark:text-emerald-400">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  {activeMembers.length} Active
                </span>
                {retiredMembers.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-300/80 dark:border-white/10 bg-slate-100 dark:bg-white/[0.04] px-2.5 py-1 text-xs font-bold text-slate-600 dark:text-slate-400">
                    <span className="h-2 w-2 rounded-full bg-slate-400" />
                    {retiredMembers.length} Retired
                  </span>
                )}
                {canManage && (
                  <Button
                    size="sm"
                    onClick={() => setIsAddModalOpen(true)}
                    className="h-8 rounded-xl font-bold gap-1 bg-primary text-primary-foreground shadow-xs text-xs cursor-pointer active:scale-95"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Member
                  </Button>
                )}
                {onUnlock && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={onUnlock}
                    className="h-8 rounded-xl font-bold gap-1 border-primary/30 text-primary hover:bg-primary/10 text-xs cursor-pointer"
                  >
                    <Edit3 className="h-3.5 w-3.5" /> Studio
                  </Button>
                )}
              </div>
            </div>

            {/* SECTION 1: Active Core Team & Architects */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary/15 text-primary text-xs font-black">
                    ⚡
                  </span>
                  <span className="text-sm font-extrabold text-foreground tracking-tight">
                    Active Core Team &amp; Architects ({activeMembers.length})
                  </span>
                </div>
                <span className="text-[11px] font-semibold text-muted-foreground hidden sm:inline">
                  Active Platform Development &amp; Systems
                </span>
              </div>

              <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {activeMembers.map((m) => {
                  const n = (m.name || '').toLowerCase();
                  const isLeader = n.includes('gaurav');
                  const tagLabel = m.tags && m.tags.length > 0 ? m.tags[0] : (
                    isLeader ? 'Team Leader · Architect'
                      : n.includes('maurya') ? 'Bio Wale'
                      : n.includes('dhama') || n.trim() === 'jatin' ? 'Gaming Wale'
                      : n.includes('swami') || n.includes('anant') ? 'Hardware & Core'
                      : n.includes('mayank') ? 'Bio Wale'
                      : 'Team Member'
                  );
                  const accent = isLeader
                    ? { border: 'rgba(245,158,11,0.55)', bar: 'linear-gradient(90deg,#f59e0b,#fde047,#f59e0b)', dot: '#fbbf24', label: tagLabel, pillBg: 'rgba(245,158,11,0.14)' }
                    : n.includes('maurya')
                      ? { border: 'rgba(148,0,211,0.28)', bar: 'none', dot: '#9400D3', label: tagLabel, pillBg: 'rgba(148,0,211,0.10)' }
                      : n.includes('dhama') || n.trim() === 'jatin'
                        ? { border: 'rgba(6,182,212,0.28)', bar: 'none', dot: '#06b6d4', label: tagLabel, pillBg: 'rgba(6,182,212,0.10)' }
                        : n.includes('mayank')
                          ? { border: 'rgba(16,185,129,0.28)', bar: 'none', dot: '#10b981', label: tagLabel, pillBg: 'rgba(16,185,129,0.10)' }
                          : { border: 'rgba(100,116,139,0.28)', bar: 'none', dot: '#64748b', label: tagLabel, pillBg: 'rgba(100,116,139,0.10)' };

                  return (
                    <motion.div
                      key={m.id}
                      whileHover={{ y: -3 }}
                      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                      onClick={() => setSelectedMember(m)}
                      style={{ borderColor: accent.border }}
                      className={
                        isLeader
                          ? 'group relative overflow-hidden cursor-pointer rounded-3xl border-2 bg-gradient-to-br from-amber-500/15 via-card/85 to-card/90 p-4 backdrop-blur shadow-lg hover:shadow-xl transition-all flex flex-col justify-between'
                          : 'group relative overflow-hidden cursor-pointer rounded-3xl border bg-card/70 p-4 backdrop-blur shadow-sm hover:shadow-md transition-all flex flex-col justify-between'
                      }
                    >
                      {isLeader && (
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-1" style={{ background: accent.bar }} />
                      )}

                      <div>
                        <div className="flex items-center gap-3.5">
                          <div className="relative shrink-0">
                            <MemberAvatar
                              name={m.name}
                              image={m.image}
                              className={
                                isLeader
                                  ? 'h-14 w-14 rounded-2xl border-2 border-amber-400 shrink-0 shadow-md'
                                  : 'h-14 w-14 rounded-2xl border border-border/80 shrink-0'
                              }
                              fallbackClassName="text-lg font-bold"
                            />
                            <span
                              className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background"
                              style={{ backgroundColor: accent.dot }}
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-foreground mb-1"
                                style={{ backgroundColor: accent.pillBg }}
                              >
                                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: accent.dot }} />
                                {accent.label}
                              </span>
                            </div>
                            <p className="truncate text-base font-extrabold text-foreground">
                              {m.name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground font-medium">{m.role}</p>
                          </div>
                        </div>

                        {m.bio && (
                          <p className="mt-3 text-xs text-muted-foreground leading-relaxed line-clamp-2">
                            {m.bio}
                          </p>
                        )}
                        {m.tags && m.tags.length > 1 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {m.tags.slice(1).map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide"
                                style={{ backgroundColor: accent.pillBg, color: accent.dot }}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-border/30 flex items-center justify-between text-[11px] font-bold text-muted-foreground group-hover:text-foreground">
                        <span>View Member Profile</span>
                        <div className="flex items-center gap-1">
                          {canManage && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleLiveToggleRetire(m.id);
                              }}
                              className="text-[10px] text-amber-600 dark:text-amber-400 hover:underline px-1.5 py-0.5 rounded hover:bg-amber-500/10 transition-colors"
                              title="Mark this member as retired"
                            >
                              Retire
                            </button>
                          )}
                          <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
                        </div>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>

            {/* SECTION 2: Honorary Emeritus & Retired Contributors */}
            {retiredMembers.length > 0 && (
              <div className="space-y-3 pt-4 border-t border-border/40">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-300 text-xs font-black">
                      🏛️
                    </span>
                    <div>
                      <span className="text-sm font-extrabold text-foreground tracking-tight">
                        Honorary Emeritus &amp; Retired Contributors ({retiredMembers.length})
                      </span>
                      <span className="ml-2 inline-flex items-center gap-1 rounded-md bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.2 text-[9px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-300">
                        Emeritus
                      </span>
                    </div>
                  </div>
                  <span className="text-[11px] font-semibold text-muted-foreground">
                    Hardware Prototypes &amp; Architectural Legacy
                  </span>
                </div>

                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {retiredMembers.map((m) => {
                    const tagLabel = m.tags && m.tags.length > 0 ? m.tags[0] : 'Hardware & Core';
                    return (
                      <motion.div
                        key={m.id}
                        whileHover={{ y: -3 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 28 }}
                        onClick={() => setSelectedMember(m)}
                        className="group relative overflow-hidden cursor-pointer rounded-3xl border border-dashed border-slate-300 dark:border-white/20 bg-slate-100/50 dark:bg-[#0c0f18]/60 p-4 backdrop-blur shadow-sm hover:shadow-md transition-all flex flex-col justify-between opacity-75 hover:opacity-100"
                      >
                        <div>
                          <div className="flex items-center gap-3.5">
                            <div className="relative shrink-0">
                              <MemberAvatar
                                name={m.name}
                                image={m.image}
                                className="h-14 w-14 rounded-2xl border border-dashed border-slate-300/80 dark:border-white/20 shrink-0 grayscale-[75%] group-hover:grayscale-0 transition-all duration-300"
                                fallbackClassName="text-lg font-bold text-slate-400"
                              />
                              <span
                                className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background bg-slate-400 dark:bg-slate-500"
                                title="Retired"
                              />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider border border-slate-300/60 dark:border-white/10 bg-slate-200/70 dark:bg-white/[0.04] text-slate-500 dark:text-slate-400 mb-1">
                                  <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                                  Retired · {tagLabel}
                                </span>
                              </div>
                              <p className="truncate text-base font-extrabold text-slate-600 dark:text-slate-300 group-hover:text-foreground transition-colors">
                                {m.name}
                              </p>
                              <p className="truncate text-xs text-muted-foreground font-medium">
                                {m.role.includes('(Retired)') ? m.role : `${m.role} (Retired)`}
                              </p>
                            </div>
                          </div>

                          {m.bio && (
                            <p className="mt-3 text-xs text-muted-foreground/80 leading-relaxed line-clamp-2">
                              {m.bio}
                            </p>
                          )}
                        </div>

                        <div className="mt-3 pt-2.5 border-t border-border/30 flex items-center justify-between text-[11px] font-bold text-muted-foreground group-hover:text-foreground">
                          {canManage && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                void handleLiveToggleRetire(m.id);
                              }}
                              className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 hover:underline font-bold"
                              title="Undo retirement and reactivate member"
                            >
                              <RotateCcw className="h-3 w-3" />
                              Undo Retirement
                            </button>
                          )}
                          <div className={cn("flex items-center gap-1", !canManage && "ml-auto")}>
                            <span className="text-[10px] text-muted-foreground">Profile</span>
                            <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-1 transition-transform" />
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* Member Detail Dialog with Live Retirement & Removal Controls */}
      <Dialog open={!!selectedMember} onOpenChange={(open) => !open && setSelectedMember(null)}>
        <DialogContent className="max-w-md rounded-3xl p-6">
          {selectedMember && (
            <div>
              <div className="flex items-center gap-4 mb-4">
                <MemberAvatar
                  name={selectedMember.name}
                  image={selectedMember.image}
                  className={cn(
                    "h-16 w-16 rounded-2xl border-2 shadow-lg",
                    selectedMember.isRetired ? "border-slate-400 grayscale-[60%]" : "border-primary"
                  )}
                  fallbackClassName="text-xl font-bold"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="text-lg font-extrabold text-foreground truncate">{selectedMember.name}</h3>
                    {selectedMember.isRetired ? (
                      <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 dark:border-white/10 bg-slate-200/70 dark:bg-white/[0.06] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                        Retired
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-semibold text-muted-foreground truncate">{selectedMember.role}</p>
                </div>
              </div>

              {selectedMember.isRetired && (
                <div className="mb-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                  <p className="font-bold flex items-center gap-1.5">
                    <Award className="h-4 w-4" /> Honorary Emeritus Contributor
                  </p>
                  <p className="mt-0.5 text-[11px] text-amber-900/80 dark:text-amber-300/80 leading-relaxed">
                    This member contributed core foundations and is marked as retired. Their contributions remain preserved.
                  </p>
                </div>
              )}

              {selectedMember.bio && (
                <div className="space-y-1.5 mb-3">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Overview</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">{selectedMember.bio}</p>
                </div>
              )}

              {selectedMember.details && (
                <div className="space-y-1.5 mb-4">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Contributions</p>
                  <p className="text-sm text-foreground/90 leading-relaxed bg-muted/30 p-3 rounded-xl border border-border/50">
                    {selectedMember.details}
                  </p>
                </div>
              )}

              {/* Real-time Retirement & Removal Actions */}
              {canManage ? (
                <div className="pt-3 border-t flex flex-wrap items-center justify-between gap-2">
                  <Button
                    size="sm"
                    variant={selectedMember.isRetired ? "default" : "outline"}
                    onClick={() => void handleLiveToggleRetire(selectedMember.id)}
                    className="rounded-xl text-xs font-bold gap-1.5"
                  >
                    {selectedMember.isRetired ? (
                      <>
                        <RotateCcw className="h-3.5 w-3.5" /> Undo Retirement (Reactivate)
                      </>
                    ) : (
                      <>
                        <Clock className="h-3.5 w-3.5 text-amber-500" /> Mark as Retired
                      </>
                    )}
                  </Button>

                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleLiveRemoveMember(selectedMember.id)}
                      className="rounded-xl text-xs font-bold text-destructive hover:bg-destructive/10 gap-1"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Remove
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setSelectedMember(null)} className="rounded-xl text-xs">
                      Close
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="pt-3 border-t flex items-center justify-end">
                  <Button size="sm" variant="secondary" onClick={() => setSelectedMember(null)} className="rounded-xl text-xs">
                    Close
                  </Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Quick Add Member Modal */}
      {canManage && (
        <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
          <DialogContent className="max-w-md rounded-3xl p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-black flex items-center gap-2">
                <Plus className="h-5 w-5 text-primary" /> Add New Team Member
              </DialogTitle>
              <DialogDescription className="text-xs">
                Add a new contributor or architect to Team RCA in real time.
              </DialogDescription>
            </DialogHeader>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const name = (form.elements.namedItem('memberName') as HTMLInputElement).value;
                const role = (form.elements.namedItem('memberRole') as HTMLInputElement).value;
                const bio = (form.elements.namedItem('memberBio') as HTMLTextAreaElement).value;
                const tags = (form.elements.namedItem('memberTag') as HTMLInputElement).value
                  .split(',')
                  .map((t) => t.trim())
                  .filter(Boolean);
                void handleLiveAddMember(name, role, bio, tags, isNewMemberRetired);
              }}
              className="space-y-4 pt-2"
            >
              <div>
                <Label className="text-xs font-bold">Full Name *</Label>
                <Input name="memberName" placeholder="e.g. Priyanshu Sharma" required className="mt-1" />
              </div>

              <div>
                <Label className="text-xs font-bold">Role / Specialty *</Label>
                <Input name="memberRole" placeholder="e.g. AI Vision Engineer · Core Team" required className="mt-1" />
              </div>

              <div>
                <Label className="text-xs font-bold">Short Bio</Label>
                <Textarea name="memberBio" rows={2} placeholder="Brief summary of their contributions..." className="mt-1" />
              </div>

              <div>
                <Label className="text-xs font-bold">Specialty Tags (comma separated)</Label>
                <Input name="memberTag" placeholder="e.g. Vision Lab, Full-Stack" className="mt-1" />
              </div>

              <div className="flex items-center justify-between p-3 rounded-2xl border bg-muted/20">
                <div>
                  <p className="text-xs font-bold text-foreground">Initial Status: {isNewMemberRetired ? 'Retired (Emeritus)' : 'Active Core Team'}</p>
                  <p className="text-[10px] text-muted-foreground">Can be changed or undone at any time in real time.</p>
                </div>
                <Switch
                  checked={isNewMemberRetired}
                  onCheckedChange={setIsNewMemberRetired}
                />
              </div>

              <DialogFooter className="pt-2 flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setIsAddModalOpen(false)} className="rounded-xl text-xs">
                  Cancel
                </Button>
                <Button type="submit" className="rounded-xl text-xs font-bold gap-1">
                  <Plus className="h-3.5 w-3.5" /> Add Member Live
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Main Studio Component (PIN Lock + Studio Customizer)               */
/* ------------------------------------------------------------------ */

const Portfolio = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isVerified, setIsVerified] = useState(() => isPortfolioSessionVerified());
  const [pinDigits, setPinDigits] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [lockoutSec, setLockoutSec] = useState(() => getRemainingLockoutSeconds());
  const [isChangePinOpen, setIsChangePinOpen] = useState(false);
  const [newPinInput, setNewPinInput] = useState('');
  const [confirmPinInput, setConfirmPinInput] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<PortfolioData>(DEFAULT_PORTFOLIO);
  const [dirty, setDirty] = useState(false);
  const [studioViewMode, setStudioViewMode] = useState<'editor' | 'preview'>('preview');

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // Lockout countdown timer
  useEffect(() => {
    if (lockoutSec <= 0) return;
    const interval = setInterval(() => {
      setLockoutSec((prev) => {
        const next = prev - 1;
        return next > 0 ? next : 0;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutSec]);

  // Keyboard listener for keypad verification
  useEffect(() => {
    if (isVerified) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isVerifying || lockoutSec > 0) return;
      if (e.key >= '0' && e.key <= '9') {
        if (pinDigits.length < 4) {
          const next = pinDigits + e.key;
          setPinDigits(next);
          if (next.length === 4) {
            void handleVerifyPin(next);
          }
        }
      } else if (e.key === 'Backspace') {
        setPinDigits((prev) => prev.slice(0, -1));
      } else if (e.key === 'Escape') {
        setPinDigits('');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isVerified, pinDigits, isVerifying, lockoutSec]);

  const handleKeypadInput = (digit: string) => {
    if (pinDigits.length >= 4 || isVerifying || lockoutSec > 0) return;
    const next = pinDigits + digit;
    setPinDigits(next);
    if (next.length === 4) {
      void handleVerifyPin(next);
    }
  };

  const handleVerifyPin = async (candidatePin: string) => {
    if (candidatePin.length < 4 || isVerifying || lockoutSec > 0) return;
    setIsVerifying(true);

    try {
      const isValid = await verifyPortfolioPin(candidatePin);
      if (isValid) {
        setIsVerified(true);
        setPinDigits('');
        toast({
          title: 'Identity Verified',
          description: 'Access granted to Team RCA Vault.',
        });
      } else {
        const remaining = getRemainingLockoutSeconds();
        if (remaining > 0) {
          setLockoutSec(remaining);
          toast({
            title: 'Security Lockout',
            description: `Too many attempts. Lockout active for ${remaining} seconds.`,
            variant: 'destructive',
          });
        } else {
          toast({
            title: 'Access Denied',
            description: 'Invalid security PIN.',
            variant: 'destructive',
          });
        }
        setPinDigits('');
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const handleLockVault = () => {
    setPortfolioSessionVerified(false);
    setIsVerified(false);
    setPinDigits('');
    toast({
      title: 'Vault Locked',
      description: 'Session terminated. Verification required to access.',
    });
  };

  const handleChangePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPinInput.length < 4) {
      toast({ title: 'PIN too short', description: 'PIN must be at least 4 digits.', variant: 'destructive' });
      return;
    }
    if (newPinInput !== confirmPinInput) {
      toast({ title: 'PIN mismatch', description: 'PIN and confirmation do not match.', variant: 'destructive' });
      return;
    }

    const success = await updatePortfolioPin(newPinInput);
    if (success) {
      toast({
        title: 'Security PIN Updated',
        description: 'New PIN hashed with cell algorithm and secured in database.',
      });
      setIsChangePinOpen(false);
      setNewPinInput('');
      setConfirmPinInput('');
    } else {
      toast({ title: 'Update Failed', description: 'Could not write to database.', variant: 'destructive' });
    }
  };

  /* ---- Load from cloud & cache ---- */
  const load = async () => {
    setLoading(true);
    try {
      try {
        const idbCached = await getPortfolioFromIndexedDb();
        if (idbCached) setData(migratePortfolioData(idbCached));
      } catch {}

      const cached = localStorage.getItem(PORTFOLIO_KEY);
      if (cached) {
        setData(migratePortfolioData(JSON.parse(cached)));
      }

      const { data: row } = await supabase
        .from('attendance_settings')
        .select('*')
        .or(`key.eq.${PORTFOLIO_KEY},setting_key.eq.${PORTFOLIO_KEY}`)
        .maybeSingle();

      const rawVal = row?.value || row?.setting_value;
      if (rawVal) {
        try {
          const parsed = migratePortfolioData(typeof rawVal === 'string' ? JSON.parse(rawVal) : rawVal);
          setData(parsed);
          await savePortfolioToIndexedDb(parsed);
          try {
            localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(parsed));
          } catch {}
        } catch {}
      }
    } catch (e) {
      console.warn('Could not load portfolio from cloud, using local cache:', e);
    } finally {
      setDirty(false);
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const update = (patch: Partial<PortfolioData>) => {
    setData((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const handleResetToDefaults = () => {
    if (window.confirm('Reset portfolio back to Team RCA defaults? Any unsaved edits will be discarded.')) {
      setData(DEFAULT_PORTFOLIO);
      setDirty(true);
      toast({
        title: 'Reset to Defaults',
        description: 'Portfolio configuration restored to Team RCA defaults. Click Save to persist.',
      });
    }
  };

  const sanitizePortfolioImages = async (current: PortfolioData): Promise<PortfolioData> => {
    const next = { ...current };
    if (next.profileImage && next.profileImage.startsWith('data:image/')) {
      next.profileImage = await uploadPortfolioImage(next.profileImage);
    }
    if (next.coverImage && next.coverImage.startsWith('data:image/')) {
      next.coverImage = await uploadPortfolioImage(next.coverImage);
    }
    if (Array.isArray(next.projects)) {
      next.projects = await Promise.all(
        next.projects.map(async (p) => {
          if (p.image && p.image.startsWith('data:image/')) {
            const cleanUrl = await uploadPortfolioImage(p.image);
            return { ...p, image: cleanUrl };
          }
          return p;
        }),
      );
    }
    if (Array.isArray(next.members)) {
      next.members = await Promise.all(
        next.members.map(async (m) => {
          if (m.image && m.image.startsWith('data:image/')) {
            const cleanUrl = await uploadPortfolioImage(m.image);
            return { ...m, image: cleanUrl };
          }
          return m;
        }),
      );
    }
    if (Array.isArray(next.gallery)) {
      next.gallery = await Promise.all(
        next.gallery.map(async (g) => {
          if (g.url && g.url.startsWith('data:image/')) {
            const cleanUrl = await uploadPortfolioImage(g.url);
            return { ...g, url: cleanUrl };
          }
          return g;
        }),
      );
    }
    return next;
  };

  const save = async () => {
    setSaving(true);
    let cleanData = data;
    try {
      cleanData = await sanitizePortfolioImages(data);
      setData(cleanData);
    } catch (e) {
      console.warn('Image sanitize notice:', e);
    }

    const payload = JSON.stringify(cleanData);
    try {
      await savePortfolioToIndexedDb(cleanData);
      window.dispatchEvent(new CustomEvent('portfolio-updated', { detail: cleanData }));
      try {
        localStorage.setItem('gaurav_portfolio_cache', payload);
      } catch {}
    } catch (e) {
      console.warn('Local cache save warning:', e);
    }

    try {
      const { data: existing } = await supabase
        .from('attendance_settings')
        .select('id, setting_key, key')
        .or(`key.eq.${PORTFOLIO_KEY},setting_key.eq.${PORTFOLIO_KEY}`)
        .maybeSingle();

      let saveErr = null;
      const settingsPayload = {
        key: PORTFOLIO_KEY,
        value: payload,
        setting_key: PORTFOLIO_KEY,
        setting_value: payload,
        updated_at: new Date().toISOString(),
      };

      if (existing?.id) {
        const { error } = await supabase
          .from('attendance_settings')
          .update(settingsPayload)
          .eq('id', existing.id);
        saveErr = error;
      } else {
        const { error } = await supabase
          .from('attendance_settings')
          .insert(settingsPayload);
        saveErr = error;
      }

      setSaving(false);
      if (saveErr) {
        toast({ title: 'Saved Locally', description: `Saved in browser database (${saveErr.message}).` });
        setDirty(false);
        return;
      }

      setDirty(false);
      toast({ title: 'Saved & Published', description: 'Portfolio published live across platform.' });
    } catch (err: any) {
      setSaving(false);
      toast({ title: 'Saved Locally', description: 'Changes saved locally in browser database.' });
    }
  };

  // Debounced Auto-Save
  useEffect(() => {
    if (!isVerified || !dirty || loading) return;
    const t = setTimeout(() => {
      void save();
    }, 2000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, dirty, isVerified, loading]);

  /* ---- Gate Verification View (Locked Mode) ---- */
  if (!isVerified) {
    return (
      <PageTransition>
        <PageLayout className="has-bottom-nav md:pb-0">
          <div className="min-h-[80vh] flex flex-col items-center justify-center px-4 py-8 relative">
            {/* Ambient Background Aura */}
            <div className="pointer-events-none absolute inset-0 overflow-hidden flex items-center justify-center">
              <div className="h-96 w-96 rounded-full bg-primary/10 blur-3xl animate-pulse" />
              <div className="h-80 w-80 rounded-full bg-amber-500/10 blur-3xl" />
            </div>

            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: 'easeOut' }}
              className="relative z-10 w-full max-w-sm"
            >
              <Card className="rounded-3xl border border-white/20 dark:border-white/10 bg-card/85 dark:bg-[#0c101d]/90 shadow-2xl backdrop-blur-2xl p-6 sm:p-7 text-center">
                {/* Shield Icon with Holographic Pulse */}
                <div className="relative mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15 text-primary border border-primary/30 shadow-[0_0_24px_rgba(14,165,233,0.35)]">
                  <ShieldCheck className="h-8 w-8 text-primary animate-pulse" />
                  <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-primary" />
                  </span>
                </div>

                <CardTitle className="text-xl sm:text-2xl font-black text-foreground tracking-tight" style={{ fontFamily: 'Sora, sans-serif' }}>
                  Vault Verification
                </CardTitle>
                <CardDescription className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
                  Enter authorized security PIN to access the Team RCA architecture &amp; portfolio vault.
                </CardDescription>

                {/* 4 Cell Dots Display */}
                <div className="my-6 flex items-center justify-center gap-3">
                  {[0, 1, 2, 3].map((idx) => {
                    const isFilled = pinDigits.length > idx;
                    const isCurrent = pinDigits.length === idx;
                    return (
                      <span
                        key={idx}
                        className={cn(
                          'h-4 w-4 rounded-full border-2 transition-all duration-200 flex items-center justify-center',
                          isFilled
                            ? 'bg-primary border-primary shadow-[0_0_12px_rgba(14,165,233,0.8)] scale-110'
                            : isCurrent
                            ? 'border-primary/80 bg-primary/20 scale-105 animate-pulse'
                            : 'border-border/80 bg-muted/40'
                        )}
                      >
                        {isFilled && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                      </span>
                    );
                  })}
                </div>

                {/* Lockout or Verifying Status Banner */}
                {lockoutSec > 0 ? (
                  <div className="mb-4 rounded-2xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive font-bold flex items-center justify-center gap-2">
                    <Clock className="h-4 w-4 shrink-0" />
                    <span>Security lockout active: wait {lockoutSec}s</span>
                  </div>
                ) : isVerifying ? (
                  <div className="mb-4 text-xs font-semibold text-primary flex items-center justify-center gap-2 animate-pulse">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Verifying cryptographic cell signature…</span>
                  </div>
                ) : null}

                {/* Numeric Keypad Grid */}
                <div className="grid grid-cols-3 gap-2.5">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => (
                    <Button
                      key={k}
                      type="button"
                      disabled={isVerifying || lockoutSec > 0}
                      variant="outline"
                      onClick={() => {
                        if (k === 'C') {
                          setPinDigits('');
                        } else if (k === '⌫') {
                          setPinDigits((p) => p.slice(0, -1));
                        } else {
                          handleKeypadInput(k);
                        }
                      }}
                      className={cn(
                        'h-12 rounded-2xl text-base font-bold transition-all active:scale-95 cursor-pointer shadow-xs',
                        k === 'C' || k === '⌫'
                          ? 'text-xs text-muted-foreground bg-muted/30 border-border/60 hover:bg-muted/60'
                          : 'text-foreground bg-card/70 border-border hover:bg-card hover:border-primary/50'
                      )}
                    >
                      {k}
                    </Button>
                  ))}
                </div>

                {/* Manual Verify Button */}
                <Button
                  type="button"
                  disabled={isVerifying || pinDigits.length < 4 || lockoutSec > 0}
                  onClick={() => void handleVerifyPin(pinDigits)}
                  className="w-full mt-4 h-11 rounded-2xl font-bold text-xs uppercase tracking-wider bg-primary text-primary-foreground shadow-md hover:bg-primary/90 transition-all cursor-pointer"
                >
                  {isVerifying ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Verifying…
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4" />
                      Verify Identity
                    </span>
                  )}
                </Button>

                {/* Return to Home link */}
                <div className="mt-4 pt-3 border-t border-border/40">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => navigate('/')}
                    className="text-xs text-muted-foreground hover:text-foreground font-semibold rounded-xl"
                  >
                    ← Return to Home
                  </Button>
                </div>
              </Card>
            </motion.div>
          </div>
        </PageLayout>
      </PageTransition>
    );
  }

/* ---- Drag and drop handlers ---- */
  const onDragEndProjects = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = data.projects.findIndex((p) => p.id === active.id);
    const newIndex = data.projects.findIndex((p) => p.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    update({ projects: arrayMove(data.projects, oldIndex, newIndex) });
  };

  const onDragEndMembers = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = data.members.findIndex((m) => m.id === active.id);
    const newIndex = data.members.findIndex((m) => m.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    update({ members: arrayMove(data.members, oldIndex, newIndex) });
  };

  const patchProject = (id: string, patch: Partial<PortfolioProject>) =>
    update({ projects: data.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  const removeProject = (id: string) => update({ projects: data.projects.filter((p) => p.id !== id) });
  const addProject = () =>
    update({
      projects: [
        ...data.projects,
        { id: portfolioUid(), title: 'New Project', description: '', stack: '', image: '', link: '', year: new Date().getFullYear().toString() },
      ],
    });

  const patchMember = (id: string, patch: Partial<PortfolioMember>) =>
    update({ members: data.members.map((m) => (m.id === id ? { ...m, ...patch } : m)) });
  const removeMember = (id: string) => update({ members: data.members.filter((m) => m.id !== id) });
  const addMember = () =>
    update({
      members: [...data.members, { id: portfolioUid(), name: 'New Team Member', role: 'Contributor', bio: '', image: '' }],
    });

  return (
    <PageTransition>
      <PageLayout className="has-bottom-nav md:pb-0">
        <section className="space-y-6 pb-16">
          {/* Top Sticky Command Strip */}
          <div className="sticky top-2 z-30 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-background/90 px-4 py-3 backdrop-blur-xl shadow-lg">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/30">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-base sm:text-lg font-extrabold text-foreground">Portfolio Studio</h1>
                <p className="text-[11px] text-muted-foreground font-medium">
                  {loading ? 'Loading…' : dirty ? '● Unsaved changes (auto-saving…)' : '✓ Published live across platform'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center rounded-xl border bg-muted/40 p-0.5">
                <button
                  type="button"
                  onClick={() => setStudioViewMode('editor')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${studioViewMode === 'editor' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Edit3 className="h-3.5 w-3.5" /> Editor
                </button>
                <button
                  type="button"
                  onClick={() => setStudioViewMode('preview')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition ${studioViewMode === 'preview' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Eye className="h-3.5 w-3.5" /> Live Preview
                </button>
              </div>

              <Button size="sm" variant="ghost" onClick={handleResetToDefaults} className="h-8 text-xs text-muted-foreground hover:text-destructive">
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset
              </Button>

              <Button size="sm" onClick={save} disabled={saving || loading} className="h-8 rounded-xl font-bold gap-1.5 shadow-md shadow-primary/20">
                <Save className="h-3.5 w-3.5" />
                {saving ? 'Saving…' : 'Save now'}
              </Button>

              <Button size="sm" variant="outline" onClick={handleLockVault} className="h-8 rounded-xl">
                <Lock className="h-3.5 w-3.5 mr-1" /> Lock
              </Button>
            </div>
          </div>

          {/* Dual Mode Switcher */}
          {studioViewMode === 'preview' ? (
            <Card className="rounded-3xl border border-white/10 shadow-2xl p-4 sm:p-6 bg-card/60 backdrop-blur-xl">
              <PublicPortfolioView data={data} onUpdateData={(next) => setData(next)} onUnlock={() => setStudioViewMode('editor')} canManage={true} />
            </Card>
          ) : (
            <Tabs defaultValue="gallery" className="space-y-5">
              <TabsList className="flex-wrap bg-muted/40 p-1 rounded-2xl border">
                <TabsTrigger value="gallery" className="rounded-xl font-bold text-xs">
                  📸 Campus Gallery ({data.gallery.length})
                </TabsTrigger>
                <TabsTrigger value="profile" className="rounded-xl font-semibold text-xs">Profile & Bio</TabsTrigger>
                <TabsTrigger value="projects" className="rounded-xl font-semibold text-xs">Projects ({data.projects.length})</TabsTrigger>
                <TabsTrigger value="members" className="rounded-xl font-semibold text-xs">Team Members ({data.members.length})</TabsTrigger>
                <TabsTrigger value="extras" className="rounded-xl font-semibold text-xs">Skills · Socials</TabsTrigger>
                <TabsTrigger value="settings" className="rounded-xl font-semibold text-xs">Display & Layout</TabsTrigger>
              </TabsList>

              {/* 1. GALLERY TAB (Rebuilt with Multi-Photo Batch Uploader) */}
              <TabsContent value="gallery" className="space-y-5">
                <Card className="rounded-3xl border shadow-sm">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base sm:text-lg font-bold flex items-center gap-2">
                          <ImageIcon className="h-5 w-5 text-primary" /> Multi-Photo Gallery Studio
                        </CardTitle>
                        <CardDescription>
                          Upload multiple photos at once, paste bulk URLs, categorize into tags, and drag to reorder.
                        </CardDescription>
                      </div>
                      <Badge variant="outline" className="text-xs font-mono font-bold">
                        {data.gallery.length} Photos
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <BatchGalleryUploader
                      items={data.gallery}
                      onChange={(gallery) => update({ gallery })}
                    />
                  </CardContent>
                </Card>
              </TabsContent>

              {/* 2. PROFILE TAB */}
              <TabsContent value="profile" className="space-y-5">
                <Card className="rounded-3xl border shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-base sm:text-lg font-bold">Profile Images & Banner</CardTitle>
                    <CardDescription>Upload, paste link, or drop images. Your profile DP also updates the Home page core card.</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-6 md:grid-cols-[220px_1fr]">
                    <ImageDropzone
                      label="Profile Photo (Avatar)"
                      aspect="square"
                      value={data.profileImage}
                      onChange={(url) => update({ profileImage: url })}
                    />
                    <ImageDropzone
                      label="Hero Cover Banner"
                      aspect="cover"
                      value={data.coverImage}
                      onChange={(url) => update({ coverImage: url })}
                    />
                  </CardContent>
                </Card>

                <Card className="rounded-3xl border shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-base sm:text-lg font-bold">Personal & Leadership Details</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 md:grid-cols-2">
                    <div>
                      <Label className="text-xs font-bold">Full Name</Label>
                      <Input value={data.name} onChange={(e) => update({ name: e.target.value })} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs font-bold">Designation / Role</Label>
                      <Input value={data.role} onChange={(e) => update({ role: e.target.value })} className="mt-1" />
                    </div>
                    <div className="md:col-span-2">
                      <Label className="text-xs font-bold">Short Tagline</Label>
                      <Input value={data.tagline} onChange={(e) => update({ tagline: e.target.value })} className="mt-1" />
                    </div>
                    <div className="md:col-span-2">
                      <Label className="text-xs font-bold">Full Bio</Label>
                      <Textarea rows={4} value={data.bio} onChange={(e) => update({ bio: e.target.value })} className="mt-1 leading-relaxed" />
                    </div>
                    <div>
                      <Label className="text-xs font-bold">Location</Label>
                      <Input value={data.location} onChange={(e) => update({ location: e.target.value })} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs font-bold">Email</Label>
                      <Input value={data.email} onChange={(e) => update({ email: e.target.value })} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs font-bold">Phone</Label>
                      <Input value={data.phone} onChange={(e) => update({ phone: e.target.value })} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs font-bold">Personal / School Website</Label>
                      <Input value={data.website} onChange={(e) => update({ website: e.target.value })} className="mt-1" />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* 3. PROJECTS TAB */}
              <TabsContent value="projects" className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">Drag <GripVertical className="inline h-3 w-3" /> to arrange priority order.</p>
                  <Button size="sm" onClick={addProject} className="rounded-xl font-bold gap-1">
                    <Plus className="h-4 w-4" /> Add Project
                  </Button>
                </div>

                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEndProjects}>
                  <SortableContext items={data.projects.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-4">
                      {data.projects.map((project, i) => (
                        <SortableItem key={project.id} id={project.id}>
                          {(handle) => (
                            <div className="rounded-3xl border bg-card/60 p-5 backdrop-blur shadow-sm">
                              <div className="mb-3 flex items-center justify-between pb-2 border-b">
                                <div className="flex items-center gap-2">
                                  {handle}
                                  <p className="text-sm font-extrabold text-foreground">Project #{i + 1} · {project.title || 'Untitled'}</p>
                                </div>
                                <Button size="sm" variant="ghost" onClick={() => removeProject(project.id)} className="text-destructive hover:bg-destructive/10">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>

                              <div className="grid gap-5 md:grid-cols-[220px_1fr]">
                                <ImageDropzone
                                  aspect="video"
                                  label="Project Preview Screenshot"
                                  value={project.image}
                                  onChange={(url) => patchProject(project.id, { image: url })}
                                />
                                <div className="grid gap-3 md:grid-cols-2">
                                  <div className="md:col-span-2">
                                    <Label className="text-xs font-bold">Project Title</Label>
                                    <Input value={project.title} onChange={(e) => patchProject(project.id, { title: e.target.value })} className="mt-1" />
                                  </div>
                                  <div className="md:col-span-2">
                                    <Label className="text-xs font-bold">Description</Label>
                                    <Textarea rows={2} value={project.description} onChange={(e) => patchProject(project.id, { description: e.target.value })} className="mt-1" />
                                  </div>
                                  <div>
                                    <Label className="text-xs font-bold">Tech Stack (comma-separated)</Label>
                                    <Input value={project.stack} onChange={(e) => patchProject(project.id, { stack: e.target.value })} className="mt-1" />
                                  </div>
                                  <div>
                                    <Label className="text-xs font-bold">Year</Label>
                                    <Input value={project.year ?? ''} onChange={(e) => patchProject(project.id, { year: e.target.value })} className="mt-1" />
                                  </div>
                                  <div>
                                    <Label className="text-xs font-bold">Live URL</Label>
                                    <Input value={project.link} onChange={(e) => patchProject(project.id, { link: e.target.value })} className="mt-1" />
                                  </div>
                                  <div>
                                    <Label className="text-xs font-bold">GitHub Repository</Label>
                                    <Input value={project.githubUrl ?? ''} onChange={(e) => patchProject(project.id, { githubUrl: e.target.value })} className="mt-1" />
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </SortableItem>
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              </TabsContent>

              {/* 4. MEMBERS TAB */}
              <TabsContent value="members" className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl border bg-muted/20">
                  <div>
                    <h4 className="text-sm font-extrabold text-foreground flex items-center gap-2">
                      <Users className="h-4 w-4 text-primary" /> Team Roster Real-Time Management
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Toggle active/retirement live, add or remove members, and reorder. Changes sync to the Home page instantly.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                      {data.members.filter((m) => !m.isRetired).length} Active
                    </span>
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-slate-400 border border-border">
                      {data.members.filter((m) => m.isRetired).length} Retired
                    </span>
                    <Button size="sm" onClick={addMember} className="rounded-xl font-bold gap-1 shadow-xs">
                      <Plus className="h-4 w-4" /> Add Member
                    </Button>
                  </div>
                </div>

                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEndMembers}>
                  <SortableContext items={data.members.map((m) => m.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-4">
                      {data.members.map((m, i) => (
                        <SortableItem key={m.id} id={m.id}>
                          {(handle) => (
                            <div className="rounded-3xl border bg-card/60 p-5 backdrop-blur shadow-sm">
                              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 pb-2 border-b">
                                <div className="flex items-center gap-2">
                                  {handle}
                                  <p className="text-sm font-extrabold text-foreground">Member #{i + 1} · {m.name || 'Unnamed'}</p>
                                  {m.isRetired ? (
                                    <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 dark:border-white/10 bg-slate-200/70 dark:bg-white/[0.06] px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">
                                      <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                                      Retired · Emeritus
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                      Active
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  {m.isRetired ? (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      type="button"
                                      onClick={() => {
                                        const newRetired = false;
                                        patchMember(m.id, { isRetired: newRetired });
                                        void persistPortfolioDataLive({
                                          ...data,
                                          members: data.members.map((item) => (item.id === m.id ? { ...item, isRetired: newRetired } : item)),
                                        });
                                        toast({ title: 'Retirement Undone', description: `${m.name} is reactivated to the active team in real time.` });
                                      }}
                                      className="h-7 text-xs font-bold rounded-xl gap-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10 border-emerald-500/30"
                                      title="Undo retirement and reactivate to active team"
                                    >
                                      <RotateCcw className="h-3 w-3" />
                                      Undo Retirement
                                    </Button>
                                  ) : (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      type="button"
                                      onClick={() => {
                                        const newRetired = true;
                                        patchMember(m.id, { isRetired: newRetired });
                                        void persistPortfolioDataLive({
                                          ...data,
                                          members: data.members.map((item) => (item.id === m.id ? { ...item, isRetired: newRetired } : item)),
                                        });
                                        toast({ title: 'Marked as Retired', description: `${m.name} is now marked as retired (emeritus) in real time.` });
                                      }}
                                      className="h-7 text-xs font-bold rounded-xl gap-1 text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-white/10 border-border"
                                      title="Mark member as retired"
                                    >
                                      <Clock className="h-3 w-3 text-amber-500" />
                                      Retire Member
                                    </Button>
                                  )}
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                      if (window.confirm(`Remove ${m.name || 'this member'} from the roster?`)) {
                                        removeMember(m.id);
                                        void persistPortfolioDataLive({
                                          ...data,
                                          members: data.members.filter((item) => item.id !== m.id),
                                        });
                                        toast({ title: 'Member Removed', description: `${m.name} was removed in real time.` });
                                      }
                                    }}
                                    className="text-destructive hover:bg-destructive/10 h-7 px-2"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>

                              <div className="grid gap-5 md:grid-cols-[180px_1fr]">
                                <ImageDropzone
                                  aspect="square"
                                  label="Portrait Photo"
                                  value={m.image}
                                  onChange={(url) => patchMember(m.id, { image: url })}
                                />
                                <div className="grid gap-3 md:grid-cols-2">
                                  <div>
                                    <Label className="text-xs font-bold">Full Name</Label>
                                    <Input value={m.name} onChange={(e) => patchMember(m.id, { name: e.target.value })} className="mt-1" />
                                  </div>
                                  <div>
                                    <Label className="text-xs font-bold">Role / Contribution</Label>
                                    <Input value={m.role} onChange={(e) => patchMember(m.id, { role: e.target.value })} className="mt-1" />
                                  </div>
                                  <div className="md:col-span-2">
                                    <Label className="text-xs font-bold">Short Bio</Label>
                                    <Textarea rows={2} value={m.bio} onChange={(e) => patchMember(m.id, { bio: e.target.value })} className="mt-1" />
                                  </div>
                                  <div className="md:col-span-2">
                                    <Label className="text-xs font-bold">Detailed Contributions</Label>
                                    <Textarea rows={2} value={m.details ?? ''} onChange={(e) => patchMember(m.id, { details: e.target.value })} className="mt-1" />
                                  </div>
                                  <div className="md:col-span-2">
                                    <Label className="text-xs font-bold">Tags (shown on member card)</Label>
                                    <div className="mt-1 flex flex-wrap gap-1.5 min-h-8 items-center p-2 border rounded-md bg-background">
                                      {(m.tags ?? []).map((tag) => (
                                        <span
                                          key={tag}
                                          className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-xs font-semibold text-primary"
                                        >
                                          {tag}
                                          <button
                                            type="button"
                                            aria-label={`Remove tag ${tag}`}
                                            className="ml-0.5 rounded-full hover:bg-primary/20 p-0.5 leading-none text-primary/70 hover:text-primary transition"
                                            onClick={() => patchMember(m.id, { tags: (m.tags ?? []).filter((t) => t !== tag) })}
                                          >
                                            ✕
                                          </button>
                                        </span>
                                      ))}
                                      <input
                                        type="text"
                                        placeholder="Type tag + Enter…"
                                        className="flex-1 min-w-24 text-xs outline-none bg-transparent placeholder:text-muted-foreground/50"
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === ',') {
                                            e.preventDefault();
                                            const val = (e.currentTarget.value || '').trim();
                                            if (!val) return;
                                            const existing = m.tags ?? [];
                                            if (!existing.includes(val)) {
                                              patchMember(m.id, { tags: [...existing, val] });
                                            }
                                            e.currentTarget.value = '';
                                          }
                                        }}
                                      />
                                    </div>
                                    <p className="text-[10px] text-muted-foreground mt-1">Press Enter or comma to add. Click ✕ to remove. First tag shows as the primary badge on the card.</p>
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </SortableItem>
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              </TabsContent>

              {/* 5. EXTRAS TAB (Skills & Socials) */}
              <TabsContent value="extras" className="space-y-5">
                <div className="grid gap-5 md:grid-cols-2">
                  <Card className="rounded-3xl border shadow-sm">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base font-bold">
                        <Trophy className="h-4 w-4 text-amber-400" /> Milestones & Achievements
                      </CardTitle>
                      <CardDescription>Enter one line per item</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Textarea
                        rows={7}
                        value={data.achievements.join('\n')}
                        onChange={(e) => update({ achievements: e.target.value.split('\n').map((v) => v.trim()).filter(Boolean) })}
                        className="font-medium text-xs leading-relaxed"
                      />
                    </CardContent>
                  </Card>

                  <Card className="rounded-3xl border shadow-sm">
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2 text-base font-bold">
                        <Sparkles className="h-4 w-4 text-primary" /> Technical Skills & Tags
                      </CardTitle>
                      <CardDescription>Enter one line per skill</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <Textarea
                        rows={7}
                        value={data.skills.join('\n')}
                        onChange={(e) => update({ skills: e.target.value.split('\n').map((v) => v.trim()).filter(Boolean) })}
                        className="font-medium text-xs leading-relaxed"
                      />
                    </CardContent>
                  </Card>
                </div>

                <Card className="rounded-3xl border shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-base font-bold">Social Media Profiles</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-3 md:grid-cols-2">
                    <div>
                      <Label className="text-xs font-bold">GitHub</Label>
                      <Input value={data.socials.github ?? ''} onChange={(e) => update({ socials: { ...data.socials, github: e.target.value } })} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs font-bold">LinkedIn</Label>
                      <Input value={data.socials.linkedin ?? ''} onChange={(e) => update({ socials: { ...data.socials, linkedin: e.target.value } })} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs font-bold">Twitter / X</Label>
                      <Input value={data.socials.twitter ?? ''} onChange={(e) => update({ socials: { ...data.socials, twitter: e.target.value } })} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs font-bold">Instagram</Label>
                      <Input value={data.socials.instagram ?? ''} onChange={(e) => update({ socials: { ...data.socials, instagram: e.target.value } })} className="mt-1" />
                    </div>
                    <div className="md:col-span-2">
                      <Label className="text-xs font-bold">YouTube / Demo Link</Label>
                      <Input value={data.socials.youtube ?? ''} onChange={(e) => update({ socials: { ...data.socials, youtube: e.target.value } })} className="mt-1" />
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* 6. DISPLAY & HOME SETTINGS TAB */}
              <TabsContent value="settings" className="space-y-5">
                <Card className="rounded-3xl border shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-base sm:text-lg font-bold flex items-center gap-2">
                      <SlidersHorizontal className="h-5 w-5 text-primary" /> Home Page & Display Customization
                    </CardTitle>
                    <CardDescription>
                      Customize how the portfolio showcase and campus gallery appear to visitors on the Home page.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    <div className="flex items-center justify-between p-4 rounded-2xl border bg-muted/20">
                      <div>
                        <p className="text-sm font-bold text-foreground">Show Developer Showcase on Home Page</p>
                        <p className="text-xs text-muted-foreground">Display the full interactive developer and team spotlight on the main landing page.</p>
                      </div>
                      <Switch
                        checked={data.settings?.showOnHome ?? true}
                        onCheckedChange={(checked) =>
                          update({ settings: { ...data.settings, showOnHome: checked } })
                        }
                      />
                    </div>

                    <div className="flex items-center justify-between p-4 rounded-2xl border bg-muted/20">
                      <div>
                        <p className="text-sm font-bold text-foreground">Show Campus & Media Gallery on Home Page</p>
                        <p className="text-xs text-muted-foreground">Display the media & photo gallery with Bento/Grid/Cinematic layout on the home page.</p>
                      </div>
                      <Switch
                        checked={data.settings?.showGalleryOnHome ?? true}
                        onCheckedChange={(checked) =>
                          update({ settings: { ...data.settings, showGalleryOnHome: checked } })
                        }
                      />
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <Label className="text-xs font-bold">Default Home Gallery View Style</Label>
                        <Select
                          value={data.settings?.homeGalleryLayout || 'bento'}
                          onValueChange={(val: any) =>
                            update({ settings: { ...data.settings, homeGalleryLayout: val } })
                          }
                        >
                          <SelectTrigger className="mt-1">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="bento">Bento Masonry Grid (Dynamic)</SelectItem>
                            <SelectItem value="grid">Uniform Cyber Grid</SelectItem>
                            <SelectItem value="carousel">Cinematic Carousel (Interactive Slideshow)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label className="text-xs font-bold">Custom Leader / Creator Badge</Label>
                        <Input
                          value={data.settings?.customBadge || ''}
                          placeholder="e.g. Team RCA · Core Lead"
                          onChange={(e) =>
                            update({ settings: { ...data.settings, customBadge: e.target.value } })
                          }
                          className="mt-1"
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          )}
          {/* Change PIN Security Dialog */}
          <Dialog open={isChangePinOpen} onOpenChange={setIsChangePinOpen}>
            <DialogContent className="max-w-sm rounded-3xl p-6">
              <DialogHeader>
                <DialogTitle className="text-lg font-black flex items-center gap-2">
                  <KeyRound className="h-5 w-5 text-amber-500" /> Update Security PIN
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Your new PIN will be hashed using the 1,024-round cell algorithm and secured in the database.
                </DialogDescription>
              </DialogHeader>

              <form onSubmit={handleChangePinSubmit} className="space-y-4 pt-2">
                <div>
                  <Label className="text-xs font-bold">New Security PIN (at least 4 digits)</Label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    placeholder="Enter new PIN…"
                    value={newPinInput}
                    onChange={(e) => setNewPinInput(e.target.value.replace(/\D/g, ''))}
                    required
                    className="mt-1 font-mono tracking-widest text-center text-lg"
                  />
                </div>

                <div>
                  <Label className="text-xs font-bold">Confirm New PIN</Label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={8}
                    placeholder="Confirm new PIN…"
                    value={confirmPinInput}
                    onChange={(e) => setConfirmPinInput(e.target.value.replace(/\D/g, ''))}
                    required
                    className="mt-1 font-mono tracking-widest text-center text-lg"
                  />
                </div>

                <DialogFooter className="pt-2 flex items-center justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setIsChangePinOpen(false)} className="rounded-xl text-xs">
                    Cancel
                  </Button>
                  <Button type="submit" className="rounded-xl text-xs font-bold gap-1 bg-amber-500 hover:bg-amber-600 text-slate-950">
                    <ShieldCheck className="h-3.5 w-3.5" /> Update PIN in Database
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </section>
      </PageLayout>
    </PageTransition>
  );
};

export default Portfolio;

