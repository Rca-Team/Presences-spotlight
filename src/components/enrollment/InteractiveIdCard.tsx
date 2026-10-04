import { useState, useRef, useCallback } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { 
  ShieldCheck, 
  RotateCw, 
  Download, 
  Edit3, 
  Wifi, 
  CheckCircle2, 
  Sparkles, 
  Building2, 
  Phone, 
  Calendar,
  Share2,
  Lock
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import type { StudentDetails } from '@/services/enrollment/types';
import { resolveIdentityDisplay } from '@/utils/studentIdentityResolver';

interface InteractiveIdCardProps {
  student: StudentDetails;
  photoUrl: string;
  onEditPhoto?: () => void;
  showActions?: boolean;
}

type CardTheme = 'emerald' | 'cyber' | 'obsidian';

export default function InteractiveIdCard({
  student,
  photoUrl,
  onEditPhoto,
  showActions = true,
}: InteractiveIdCardProps) {
  const identity = resolveIdentityDisplay({
    student_name: student.name,
    class: student.class,
    section: student.section,
    category: student.category,
    role: (student as any).role,
  });

  const [isFlipped, setIsFlipped] = useState(false);
  const [theme, setTheme] = useState<CardTheme>('emerald');
  const [isDownloading, setIsDownloading] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  // 3D Tilt Physics using Framer Motion
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const mouseXSpring = useSpring(x, { stiffness: 300, damping: 25 });
  const mouseYSpring = useSpring(y, { stiffness: 300, damping: 25 });

  const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], ['14deg', '-14deg']);
  const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], ['-16deg', '16deg']);
  const glareX = useTransform(mouseXSpring, [-0.5, 0.5], ['0%', '100%']);
  const glareY = useTransform(mouseYSpring, [-0.5, 0.5], ['0%', '100%']);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    x.set(mouseX / width - 0.5);
    y.set(mouseY / height - 0.5);
  }, [x, y]);

  const handleMouseLeave = useCallback(() => {
    x.set(0);
    y.set(0);
  }, [x, y]);

  // Download ID Card as Image
  const handleDownload = async () => {
    if (!cardRef.current) return;
    setIsDownloading(true);
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(cardRef.current, {
        scale: 2.5,
        backgroundColor: null,
        useCORS: true,
        logging: false,
      });
      const dataUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.download = `${student.name.replace(/\s+/g, '_')}_Student_ID_Card.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.warn('ID Card download failed:', err);
    } finally {
      setIsDownloading(false);
    }
  };

  // Theme Gradients
  const themeStyles = {
    emerald: {
      border: 'border-emerald-400/40 shadow-emerald-950/50',
      bg: 'from-[#0b2420] via-[#08181b] to-[#040e14]',
      accent: 'text-emerald-400',
      pill: 'bg-emerald-950/80 text-emerald-300 border-emerald-500/30',
      holo: 'from-emerald-400/20 via-cyan-400/15 to-transparent',
      ribbon: 'from-emerald-400 via-teal-300 to-cyan-400',
    },
    cyber: {
      border: 'border-cyan-400/40 shadow-cyan-950/50',
      bg: 'from-[#081a2e] via-[#091524] to-[#030911]',
      accent: 'text-cyan-400',
      pill: 'bg-cyan-950/80 text-cyan-300 border-cyan-500/30',
      holo: 'from-cyan-400/25 via-indigo-400/20 to-transparent',
      ribbon: 'from-cyan-400 via-blue-400 to-purple-400',
    },
    obsidian: {
      border: 'border-amber-400/40 shadow-amber-950/40',
      bg: 'from-[#1e1708] via-[#141009] to-[#080704]',
      accent: 'text-amber-400',
      pill: 'bg-amber-950/80 text-amber-300 border-amber-500/30',
      holo: 'from-amber-400/20 via-orange-400/15 to-transparent',
      ribbon: 'from-amber-400 via-yellow-300 to-orange-400',
    },
  }[theme];

  return (
    <div className="flex flex-col items-center w-full select-none">
      {/* 3D Perspective Card Viewport */}
      <div 
        className="w-full max-w-md py-4 cursor-pointer"
        style={{ perspective: 1200 }}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        onClick={() => setIsFlipped((v) => !v)}
      >
        <motion.div
          style={{
            rotateX: isFlipped ? 0 : rotateX,
            rotateY: isFlipped ? 0 : rotateY,
            transformStyle: 'preserve-3d',
          }}
          animate={{ rotateY: isFlipped ? 180 : 0 }}
          transition={{ duration: 0.6, type: 'spring', stiffness: 260, damping: 20 }}
          className="relative w-full aspect-[1.58/1] rounded-3xl"
        >
          {/* Card Container Target for Download */}
          <div ref={cardRef} className="w-full h-full relative" style={{ transformStyle: 'preserve-3d' }}>
            
            {/* ========================================================= */}
            {/* FRONT SIDE */}
            {/* ========================================================= */}
            <div
              className={`absolute inset-0 w-full h-full rounded-3xl border-2 ${themeStyles.border} bg-gradient-to-br ${themeStyles.bg} p-5 sm:p-6 shadow-2xl backdrop-blur-2xl flex flex-col justify-between overflow-hidden`}
              style={{
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
              }}
            >
              {/* Dynamic Hologram Foil Glare (Reacts to 3D cursor angle) */}
              <motion.div
                className={`absolute inset-0 bg-gradient-to-tr ${themeStyles.holo} pointer-events-none opacity-70`}
                style={{
                  backgroundPosition: `${glareX} ${glareY}`,
                }}
              />

              {/* Security Background Micro-Pattern */}
              <div 
                className="absolute inset-0 opacity-[0.04] pointer-events-none"
                style={{
                  backgroundImage: 'radial-gradient(#ffffff 1px, transparent 1px)',
                  backgroundSize: '12px 12px',
                }}
              />

              {/* Metallic Lanyard Clip Hole at Top Center */}
              <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-2.5 rounded-full bg-slate-950/80 border border-white/20 shadow-inner flex items-center justify-center">
                <div className="w-8 h-1 rounded-full bg-slate-900 border-t border-slate-700" />
              </div>

              {/* Card Header */}
              <div className="flex justify-between items-start pt-1.5 relative z-10">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-white p-0.5 flex items-center justify-center shadow-md shadow-emerald-500/20 shrink-0 border border-white/20">
                    <img src="/kvs-logo.png" alt="Kendriya Vidyalaya Sangathan" className="w-full h-full object-contain" />
                  </div>
                  <div>
                    <div className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-100 flex items-center gap-1.5 leading-tight">
                      <span>PM SHRI KENDRIYA VIDYALAYA</span>
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                    </div>
                    <p className="text-[9px] font-medium tracking-wider text-slate-300 uppercase">
                      NFC Vigyan Vihar · {identity.isTeacher ? 'Faculty Pass' : 'Student Pass'} 2026-27
                    </p>
                  </div>
                </div>

                {/* Contactless RFID / NFC Icon */}
                <div className="flex items-center gap-1 text-slate-400 text-xs bg-slate-950/40 px-2 py-0.5 rounded-full border border-white/10">
                  <Wifi size={13} className="rotate-90 text-emerald-400" />
                  <span className="text-[9px] font-mono font-semibold">RFID</span>
                </div>
              </div>

              {/* Card Middle: Photo + Person Info */}
              <div className="flex items-center gap-4 sm:gap-5 my-auto relative z-10">
                {/* Portrait with Holographic Glow Frame */}
                <div className="relative shrink-0">
                  <div className="w-20 h-24 sm:w-24 sm:h-28 rounded-2xl overflow-hidden border-2 border-emerald-400/50 shadow-xl bg-slate-950 relative group">
                    <img
                      src={photoUrl}
                      alt={student.name}
                      className="w-full h-full object-cover"
                    />
                    {/* Security Hologram Watermark Ribbon */}
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-tl-xl bg-gradient-to-br from-emerald-400 to-cyan-400 text-slate-950 flex items-center justify-center shadow-md">
                      <ShieldCheck size={13} className="stroke-[2.5]" />
                    </div>
                  </div>

                  {/* Smart EMV Microchip Graphic */}
                  <div className="absolute -bottom-2 -left-2 w-7 h-5 rounded-md bg-gradient-to-br from-amber-300 via-yellow-400 to-amber-500 border border-amber-200/50 shadow-sm flex items-center justify-center overflow-hidden">
                    <div className="w-full h-0.5 bg-amber-600/50 mb-1" />
                    <div className="absolute inset-0 border border-amber-600/40 rounded-sm" />
                  </div>
                </div>

                {/* Details Section */}
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div>
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 block">
                      {identity.isTeacher ? 'Faculty / Staff Member' : 'Student Name'}
                    </span>
                    <h3 className="text-base sm:text-lg font-black text-slate-100 tracking-tight truncate leading-tight">
                      {student.name}
                    </h3>
                  </div>

                  {/* Pills Row */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {identity.isTeacher ? (
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-400/40">
                        ★ {identity.roleLabel}
                      </span>
                    ) : (
                      <span className={`px-2 py-0.5 rounded-lg text-[10px] font-bold border ${themeStyles.pill}`}>
                        Class {student.class} {student.section && `• Sec ${student.section}`}
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono font-bold bg-slate-900/80 text-slate-300 border border-white/10">
                      {identity.isTeacher ? 'Staff ID' : 'ID'} #{student.admission_number || '10341'}
                    </span>
                  </div>

                  {student.date_of_birth && (
                    <div className="flex items-center gap-1 text-[10px] text-slate-400 font-medium">
                      <Calendar size={11} className="text-emerald-400 shrink-0" />
                      <span>DOB: {student.date_of_birth}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Card Bottom: Barcode + Security Hologram */}
              <div className="flex items-end justify-between pt-1 relative z-10 border-t border-white/10">
                {/* Simulated High-Tech Barcode */}
                <div className="space-y-0.5">
                  <div className="flex items-center gap-[2.5px] h-4 sm:h-5 opacity-80">
                    {[3, 1, 2, 4, 1, 3, 2, 1, 4, 2, 3, 1, 2, 4, 1, 3, 2, 1, 3, 2, 4, 1].map((w, i) => (
                      <div
                        key={i}
                        className="bg-slate-200 h-full rounded-sm"
                        style={{ width: `${w * 1.4}px` }}
                      />
                    ))}
                  </div>
                  <span className="text-[8px] font-mono tracking-widest text-slate-400 block uppercase">
                    PASS-SEC-{student.admission_number || '10341'}
                  </span>
                </div>

                {/* Miniature Scannable QR Code */}
                <div className="bg-white p-1 rounded-lg shadow-md shrink-0">
                  <QRCodeSVG 
                    value={`${identity.isTeacher ? 'FACULTY' : 'STUDENT'}:${student.admission_number || '10341'}:${student.name}`} 
                    size={30}
                    level="M"
                  />
                </div>
              </div>
            </div>

            {/* ========================================================= */}
            {/* BACK SIDE */}
            {/* ========================================================= */}
            <div
              className={`absolute inset-0 w-full h-full rounded-3xl border-2 ${themeStyles.border} bg-gradient-to-br ${themeStyles.bg} p-5 sm:p-6 shadow-2xl backdrop-blur-2xl flex flex-col justify-between overflow-hidden`}
              style={{
                transform: 'rotateY(180deg)',
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
              }}
            >
              {/* Metallic Lanyard Clip Hole at Top Center */}
              <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-2.5 rounded-full bg-slate-950/80 border border-white/20 shadow-inner" />

              {/* Back Header */}
              <div className="flex justify-between items-center pt-2 border-b border-white/10 pb-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                  <img src="/kvs-logo.png" alt="KVS" className="w-3.5 h-3.5 object-contain rounded-full bg-white p-0.5" />
                  <span>KVS Regulations & Policy</span>
                </div>
                <div className="text-[9px] font-mono text-emerald-400 font-semibold bg-emerald-950/80 px-2 py-0.5 rounded-md border border-emerald-500/30">
                  VALID 2026-27
                </div>
              </div>

              {/* Back Middle: Emergency Info & Terms */}
              <div className="grid grid-cols-2 gap-3 my-auto text-[10px] text-slate-300">
                <div className="space-y-1.5">
                  <p className="font-bold text-slate-100 flex items-center gap-1">
                    <Phone size={11} className="text-emerald-400" /> Emergency Contact
                  </p>
                  <p className="font-mono text-slate-200">{student.parent_phone || 'School Office'}</p>
                  {student.email && (
                    <p className="text-[9px] text-slate-400 font-mono truncate max-w-[140px]" title={student.email}>
                      ✉ {student.email}
                    </p>
                  )}
                  {student.father_name && <p className="text-slate-400">Guardian: {student.father_name}</p>}
                </div>

                <div className="space-y-1 bg-slate-950/50 p-2 rounded-xl border border-white/5">
                  <p className="text-[9px] text-slate-400 leading-relaxed">
                    This digital card is non-transferable. If found, return to school administrative office.
                  </p>
                </div>
              </div>

              {/* Back Bottom: Principal Seal & Gate QR */}
              <div className="flex items-center justify-between pt-2 border-t border-white/10">
                {/* Official Seal Stamp */}
                <div className="flex items-center gap-2">
                  <div className="w-10 h-10 rounded-full border-2 border-dashed border-emerald-400/50 flex flex-col items-center justify-center text-center rotate-[-12deg]">
                    <span className="text-[7px] font-black uppercase text-emerald-300 tracking-tighter">OFFICIAL</span>
                    <span className="text-[6px] text-slate-300">SEAL</span>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-slate-100">Authorized Issuer</p>
                    <p className="text-[8px] text-slate-400 font-serif italic">Principal Signature</p>
                  </div>
                </div>

                {/* Flip back cue */}
                <div className="flex items-center gap-1 text-[9px] font-semibold text-emerald-400 bg-emerald-950/60 px-2 py-1 rounded-lg border border-emerald-500/20">
                  <RotateCw size={11} />
                  <span>Click to flip front</span>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Interactive Controls below Card */}
      {showActions && (
        <div className="flex flex-wrap items-center justify-between gap-3 w-full max-w-md mt-2">
          {/* Theme Palette Switcher */}
          <div className="flex items-center gap-1.5 bg-slate-900/80 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setTheme('emerald'); }}
              className={`w-6 h-6 rounded-lg bg-emerald-500 transition-all ${
                theme === 'emerald' ? 'ring-2 ring-white scale-110' : 'opacity-60 hover:opacity-100'
              }`}
              title="Emerald Hologram"
            />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setTheme('cyber'); }}
              className={`w-6 h-6 rounded-lg bg-cyan-500 transition-all ${
                theme === 'cyber' ? 'ring-2 ring-white scale-110' : 'opacity-60 hover:opacity-100'
              }`}
              title="Cyber Titanium"
            />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setTheme('obsidian'); }}
              className={`w-6 h-6 rounded-lg bg-amber-500 transition-all ${
                theme === 'obsidian' ? 'ring-2 ring-white scale-110' : 'opacity-60 hover:opacity-100'
              }`}
              title="Royal Obsidian"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                setIsFlipped((v) => !v);
              }}
              className="h-8 px-2.5 text-xs text-slate-300 border-slate-700 hover:border-emerald-500/40"
            >
              <RotateCw size={13} className="mr-1 text-emerald-400" />
              <span>{isFlipped ? 'Show Front' : 'Flip 3D'}</span>
            </Button>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                handleDownload();
              }}
              disabled={isDownloading}
              className="h-8 px-2.5 text-xs text-slate-300 border-slate-700 hover:border-emerald-500/40"
            >
              <Download size={13} className="mr-1 text-cyan-400" />
              <span>{isDownloading ? 'Saving…' : 'Save ID'}</span>
            </Button>

            {onEditPhoto && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditPhoto();
                }}
                className="h-8 px-2.5 text-xs text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/30"
              >
                <Edit3 size={13} className="mr-1" />
                <span>Recrop Photo</span>
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
