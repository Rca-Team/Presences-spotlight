import React, { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { motion, LayoutGroup } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import Logo from './Logo';
import { useIsMobile } from '@/hooks/use-mobile';
import { 
  Sun, 
  Moon, 
  Home, 
  User, 
  UserPlus, 
  ScanLine, 
  LayoutDashboard, 
  GraduationCap, 
  BookOpen,
  LayoutGrid,
  Camera,
  Users,
  QrCode,
} from 'lucide-react';
import { Toggle } from '@/components/ui/toggle';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/integrations/supabase/client';
import ProfileDropdown from './ProfileDropdown';
import { useUserRole } from '@/hooks/useUserRole';
import { useHapticFeedback } from '@/hooks/useHapticFeedback';
import LiteModeToggle from './LiteModeToggle';
import { preloadRoute } from '@/lib/preloadRoute';

const Navbar = () => {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const location = useLocation();
  const isMobile = useIsMobile();
  const { theme, setTheme } = useTheme();
  const { isAdminOrPrincipal, isTeacher, isGuard, isEnroller } = useUserRole();
  const { trigger: haptic } = useHapticFeedback();
  
  useEffect(() => {
    let ticking = false;
    const handleScroll = () => {
      if (!ticking) {
        window.requestAnimationFrame(() => {
          const offset = window.scrollY;
          setIsScrolled((prev) => {
            const next = offset > 14;
            return prev !== next ? next : prev;
          });
          ticking = false;
        });
        ticking = true;
      }
    };
    
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    // Check initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsAuthenticated(!!session);
    });

    return () => subscription.unsubscribe();
  }, []);

  const isActive = (path: string) => location.pathname === path;

  const toggleTheme = () => {
    haptic('selection');
    setTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const navLinks = isEnroller
    ? [
        { text: 'Attendance', path: '/attendance', icon: ScanLine, show: true },
        { text: 'Enrollment Monitor', path: '/enrollment-monitor', icon: Users, show: true },
        { text: 'Enroll Face', path: '/enroll', icon: Camera, show: true },
        { text: 'Add Student', path: '/register', icon: UserPlus, show: true },
      ]
    : [
        { text: 'Home', path: '/', icon: Home, show: !isAuthenticated || (!isTeacher || isAdminOrPrincipal) },
        { text: 'Attendance', path: '/attendance', icon: ScanLine, show: true },
        { text: 'Parent Portal', path: '/parent', icon: GraduationCap, show: true },
        { text: 'Teacher Portal', path: '/teacher', icon: BookOpen, show: isAuthenticated && isTeacher && !isAdminOrPrincipal },
        { text: 'Guard Scanner', path: '/guard', icon: QrCode, show: isAuthenticated && isGuard && !isAdminOrPrincipal },
        { text: 'Add Student', path: '/register', icon: UserPlus, show: true },
        { text: 'Admin', path: '/admin', icon: LayoutDashboard, show: isAdminOrPrincipal },
      ].filter((item) => item.show);

  return (
    <header 
      className={cn(
        "fixed top-0 left-0 right-0 z-50 px-4 sm:px-6 md:px-8 py-3 transition-colors duration-200",
        isScrolled 
          ? "backdrop-blur-md bg-background/88 dark:bg-slate-950/88 shadow-sm border-b border-border/50 dark:border-white/10"
          : "bg-transparent"
      )}
    >
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-3">
        <Link
          to={isAuthenticated && isTeacher && !isAdminOrPrincipal ? "/teacher" : isEnroller ? "/enrollment-monitor" : "/"}
          className="animate-ios-bounce shrink-0"
          onClick={() => haptic('selection')}
        >
          <Logo />
        </Link>
        
        {/* Desktop Navigation Dock with Royal Neon Sliding Tabs */}
        <LayoutGroup id="navbar-dock-tabs">
          <nav
            onMouseLeave={() => setHoveredPath(null)}
            className="royal-neon-dock hidden md:flex items-center gap-1 rounded-full p-1.5 relative shadow-2xl"
          >
            {/* Soft inner top specular highlight */}
            <span className="pointer-events-none absolute inset-x-6 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/80 dark:via-white/50 to-transparent" />

            {navLinks.map((item) => {
              const active = isActive(item.path);
              const hovered = hoveredPath === item.path;
              const Icon = item.icon;

              return (
                <motion.div
                  key={item.path}
                  onMouseEnter={() => {
                    setHoveredPath(item.path);
                    preloadRoute(item.path);
                  }}
                  onFocus={() => {
                    setHoveredPath(item.path);
                    preloadRoute(item.path);
                  }}
                  onPointerDown={() => {
                    preloadRoute(item.path);
                  }}
                  whileHover={{ y: -1, scale: 1.02 }}
                  whileTap={{ scale: 0.96 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 35, mass: 0.5 }}
                  className="relative select-none"
                >
                  <Link
                    to={item.path}
                    onClick={() => haptic('selection')}
                    className={cn(
                      "relative flex items-center gap-2 px-4 py-2 rounded-full text-[13.5px] font-medium transition-colors duration-200",
                      active
                        ? "text-slate-900 dark:text-white font-semibold shadow-sm"
                        : "text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white"
                    )}
                  >
                    {/* Hover ghost highlight */}
                    {hovered && !active && (
                      <motion.div
                        layoutId="navbar-hover-pill"
                        className="absolute inset-0 rounded-full bg-slate-900/[0.05] dark:bg-white/[0.06] backdrop-blur-md border border-slate-900/[0.06] dark:border-white/[0.08]"
                        transition={{ type: "spring", stiffness: 420, damping: 30, mass: 0.5 }}
                      />
                    )}

                    {/* Royal Neon Fluid Active Sliding Pill */}
                    {active && (
                      <motion.div
                        layoutId="navbar-active-pill"
                        className="royal-neon-active-pill absolute inset-0 rounded-full"
                        transition={{
                          type: "spring",
                          stiffness: 420,
                          damping: 30,
                          mass: 0.6,
                        }}
                      >
                        {/* Soft inner top reflection */}
                        <span className="pointer-events-none absolute inset-x-2.5 top-0 h-[1px] rounded-full bg-gradient-to-r from-transparent via-white/80 dark:via-white/50 to-transparent" />
                      </motion.div>
                    )}

                    <span className="relative z-10 flex items-center gap-1.5">
                      <Icon className={cn("w-3.5 h-3.5 transition-transform duration-200", active ? "opacity-100" : "opacity-75")} />
                      <span>{item.text === 'Admin' && isTeacher && !isAdminOrPrincipal ? 'Teacher' : item.text}</span>
                    </span>
                  </Link>
                </motion.div>
              );
            })}
          </nav>
        </LayoutGroup>
        
        {/* Auth section - Only show on desktop */}
        <div className="hidden md:flex items-center gap-2.5 animate-fade-in shrink-0">
          <LiteModeToggle variant="badge" />
          <Toggle 
            pressed={theme === 'dark'} 
            onPressedChange={toggleTheme}
            aria-label="Toggle theme"
            className="relative w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800/80 hover:bg-accent/70 hover:scale-105 active:scale-95 border border-slate-200/80 dark:border-white/10"
            style={{ transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
          >
            {theme === 'dark' ? (
              <Moon className="h-4 w-4 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-ios-purple" />
            ) : (
              <Sun className="h-4 w-4 absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-ios-orange animate-pulse-subtle" />
            )}
          </Toggle>
          {isAuthenticated ? (
            <ProfileDropdown />
          ) : (
            <div className="flex items-center gap-2">
              <Link to="/login" onClick={() => haptic('selection')}>
                <Button variant="ghost" size="sm" className="rounded-full px-4 text-xs font-medium">
                  Sign In
                </Button>
              </Link>
              <Link to="/signup" onClick={() => haptic('selection')}>
                <Button
                  size="sm"
                  className="rounded-full px-4 text-xs font-medium text-foreground bg-primary/10 hover:bg-primary/20 border border-primary/20"
                  style={{
                    boxShadow: '0 8px 18px -10px hsl(var(--primary) / 0.5)'
                  }}
                >
                  Get Started
                </Button>
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Navbar;
