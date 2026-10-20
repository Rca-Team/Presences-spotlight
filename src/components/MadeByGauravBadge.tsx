import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, ArrowUpRight, X } from 'lucide-react';
import gauravPhoto from '@/assets/gaurav-photo.png';
import { preloadRoute } from '@/lib/preloadRoute';
import { useIsMobile } from '@/hooks/use-mobile';

/**
 * MadeByGauravBadge - Liquid Glass Floating Badge
 * 
 * Features:
 * - Ultra-refined liquid glass aesthetics with specular meniscus rim and subtle optical blur.
 * - Gentle levitation floating motion with hardware-accelerated spring feedback.
 * - Perfectly balanced proportions (prominent, recognizable photo without intruding on UI).
 * - Direct one-tap routing to Gaurav's Portfolio (/portfolio).
 * - Safe z-index layering above page content and responsive positioning above mobile docks.
 */
export const MadeByGauravBadge: React.FC = () => {
  const location = useLocation();
  const isMobile = useIsMobile();
  const [isDismissed, setIsDismissed] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Only display on enrollment pages (/enroll, /register, /enrollment-monitor)
  const isEnrollPage =
    location.pathname === '/enroll' ||
    location.pathname.startsWith('/enroll/') ||
    location.pathname === '/register' ||
    location.pathname.startsWith('/register/') ||
    location.pathname.startsWith('/enrollment');

  if (isDismissed || !isEnrollPage) {
    return null;
  }

  return (
    <aside
      aria-label="Creator Attribution"
      className={`fixed z-40 select-none touch-manipulation transition-all duration-300 ${
        isMobile
          ? 'bottom-[74px] right-3'
          : 'bottom-5 right-5 sm:bottom-6 sm:right-6'
      }`}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.88 }}
        animate={{
          opacity: 1,
          scale: 1,
          y: [0, -3.5, 0],
        }}
        transition={{
          y: {
            duration: 3.6,
            repeat: Infinity,
            ease: 'easeInOut',
          },
          opacity: { duration: 0.4 },
          scale: { duration: 0.4 },
        }}
        whileHover={{ scale: 1.04, y: -4 }}
        whileTap={{ scale: 0.96 }}
        onMouseEnter={() => {
          setIsHovered(true);
          preloadRoute('/portfolio');
        }}
        onMouseLeave={() => setIsHovered(false)}
        onTouchStart={() => preloadRoute('/portfolio')}
        className="group relative flex items-center"
      >
        <Link
          to="/portfolio"
          className="relative flex items-center gap-2.5 pl-1.5 pr-3.5 py-1 rounded-full backdrop-blur-md border border-white/75 dark:border-white/20 bg-white/45 dark:bg-[#0c1222]/55 shadow-[0_12px_32px_-8px_rgba(15,23,42,0.18),inset_0_1.5px_1px_rgba(255,255,255,0.95),inset_0_0_16px_rgba(255,255,255,0.15)] dark:shadow-[0_16px_36px_-10px_rgba(0,0,0,0.65),inset_0_1.5px_1px_rgba(255,255,255,0.25),inset_0_0_16px_rgba(255,255,255,0.05)] transition-all duration-200"
          title="Designed & Architected by Gaurav Raj — View Creator Portfolio"
        >
          {/* Specular Liquid Edge Meniscus Highlight */}
          <span className="pointer-events-none absolute inset-x-4 top-0 h-[1.5px] rounded-full bg-gradient-to-r from-transparent via-cyan-400/80 dark:via-cyan-300/60 to-transparent" />

          {/* Gaurav's Profile Photo Container with Luminous Ring */}
          <div className="relative shrink-0">
            <div className="w-8 h-8 rounded-full overflow-hidden p-0.5 bg-gradient-to-tr from-blue-600 via-cyan-400 to-indigo-600 shadow-sm">
              <img
                src={gauravPhoto}
                alt="Gaurav Raj"
                className="w-full h-full object-cover rounded-full bg-slate-900"
                loading="eager"
                onError={(e) => {
                  const target = e.currentTarget;
                  if (target.src !== '/gaurav-photo.png') {
                    target.src = '/gaurav-photo.png';
                  }
                }}
              />
            </div>

            {/* Glowing Active Status Pulse Indicator */}
            <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500 border border-white dark:border-[#0c1222]" />
            </span>
          </div>

          {/* Aesthetic Micro Typography */}
          <div className="flex flex-col text-left leading-none">
            <span className="text-[9px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1">
              Made with
              <span className="text-rose-500 text-[10px] inline-block animate-pulse">❤</span>
              by
            </span>
            <span className="text-xs font-black tracking-tight mt-0.5 flex items-center gap-1 text-slate-900 dark:text-white">
              <span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 dark:from-cyan-400 dark:via-blue-400 dark:to-indigo-300 bg-clip-text text-transparent">
                Gaurav
              </span>
              <Sparkles className="w-3 h-3 text-amber-500 dark:text-amber-400 shrink-0" />
            </span>
          </div>

          {/* Elegant Micro Arrow on Hover */}
          <ArrowUpRight className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 group-hover:text-cyan-500 dark:group-hover:text-cyan-400 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all duration-200 shrink-0" />
        </Link>

        {/* Subtle Dismiss Button on Hover (Desktop) or Persistent Soft Button */}
        <AnimatePresence>
          {isHovered && (
            <motion.button
              type="button"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.15 }}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsDismissed(true);
              }}
              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-slate-800/90 text-white/80 hover:text-white hover:bg-slate-900 border border-white/20 flex items-center justify-center text-[10px] shadow-md cursor-pointer"
              title="Dismiss badge"
              aria-label="Dismiss badge"
            >
              <X className="w-2.5 h-2.5" />
            </motion.button>
          )}
        </AnimatePresence>
      </motion.div>
    </aside>
  );
};

export default MadeByGauravBadge;
