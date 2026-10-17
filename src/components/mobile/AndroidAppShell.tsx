import React, { useEffect, useMemo, useState, useRef } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Home,
  ScanLine,
  QrCode,
  ShieldAlert,
  UserCircle,
  DoorOpen,
  WifiOff,
  Bell,
  Sparkles,
  ShieldCheck,
  GraduationCap,
  LayoutDashboard,
  UserPlus
} from "lucide-react";
import { preloadRoute } from "@/lib/preloadRoute";
import { Capacitor } from "@capacitor/core";
import { App as CapApp } from "@capacitor/app";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { StatusBar, Style } from "@capacitor/status-bar";
import { Network } from "@capacitor/network";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import Logo from "@/components/Logo";
import { LiteModeToggle } from "@/components/LiteModeToggle";

type AndroidAppShellProps = {
  children: React.ReactNode;
};

const routeTitles: Record<string, string> = {
  "/": "Presences",
  "/attendance": "Live Attendance",
  "/gate": "Live Attendance",
  "/gate/vision": "Gate Vision Scanner",
  "/guard": "Security Scanner",
  "/gate/scanner": "Gate Scanner",
  "/parent": "Parent Safety Portal",
  "/gate-pass": "Digital Gate Pass",
  "/emergency": "Campus Emergency HUD",
  "/teacher": "Faculty Portal",
  "/admin": "Admin Center",
  "/profile": "My Profile",
  "/register": "Register Student",
  "/enroll": "Biometric Enrollment",
  "/enrollment-monitor": "Enrollment Monitor",
  "/features": "Campus Features",
  "/contact": "Support & Help",
  "/portfolio": "Creator Portfolio",
  "/notifications": "Campus Alerts",
  "/shared-media": "Shared Media",
  "/login": "Sign In",
  "/signup": "Create Account",
  "/widgets": "Quick Tools",
  "/smartboard": "Smart Board Mode",
  "/jarvis": "Jarvis AI Assistant",
  "/backup": "System Cloud Backup",
  "/data": "Data Management",
};

export const AndroidAppShell: React.FC<AndroidAppShellProps> = ({ children }) => {
  const isMobile = useIsMobile();
  const location = useLocation();
  const navigate = useNavigate();
  const { isAdminOrPrincipal, isTeacher, isGuard } = useUserRole();
  const [isSignedIn, setIsSignedIn] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const lastBackPressTime = useRef<number>(0);

  // Initialize Android Native Status Bar & Network Listeners
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      // Configure Edge-to-Edge Dark Status Bar
      StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});

      // Android Hardware Back Button Handling
      const backHandler = CapApp.addListener("backButton", ({ canGoBack }) => {
        const path = window.location.pathname;

        if (path === "/" || path === "/attendance") {
          const now = Date.now();
          if (now - lastBackPressTime.current < 2000) {
            CapApp.exitApp();
          } else {
            lastBackPressTime.current = now;
            toast("Press back again to exit Presences", { duration: 2000 });
            Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
          }
        } else if (canGoBack) {
          navigate(-1);
          Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
        } else {
          navigate("/");
        }
      });

      return () => {
        backHandler.then((handle) => handle.remove()).catch(() => {});
      };
    }
  }, [navigate]);

  // Monitor Network Connectivity (Edge Offline Mode)
  useEffect(() => {
    Network.getStatus().then((status) => setIsOffline(!status.connected)).catch(() => {});

    const networkListener = Network.addListener("networkStatusChange", (status) => {
      const offline = !status.connected;
      setIsOffline(offline);
      if (offline) {
        toast.warning("Offline Mode Active — Attendance cached locally", {
          icon: <WifiOff className="w-4 h-4 text-amber-400" />,
        });
      } else {
        toast.success("Online — Syncing cached records to cloud", {
          icon: <Sparkles className="w-4 h-4 text-emerald-400" />,
        });
      }
    });

    return () => {
      networkListener.then((handle) => handle.remove()).catch(() => {});
    };
  }, []);

  // Listen for Supabase session
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setIsSignedIn(Boolean(data.session)));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsSignedIn(Boolean(session));
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const path = location.pathname;

  // Immersive full-bleed camera viewfinder routes (Guard Scanner & Smartboard)
  const isImmersiveRoute =
    path.startsWith("/guard") ||
    path.startsWith("/smartboard");

  // Routes with custom internal headers
  const hasCustomHeader =
    isImmersiveRoute ||
    path === "/emergency" ||
    path.startsWith("/login") ||
    path.startsWith("/signup");

  // Dynamic role-aware bottom navigation tabs
  const tabs = useMemo(() => {
    if (isAdminOrPrincipal) {
      return [
        { key: "home", label: "Home", to: "/", icon: Home },
        { key: "attendance", label: "Scan", to: "/attendance", icon: ScanLine },
        { key: "register", label: "Enroll", to: "/register", icon: UserPlus },
        { key: "admin", label: "Admin", to: "/admin", icon: LayoutDashboard },
        {
          key: "profile",
          label: isSignedIn ? "Profile" : "Sign In",
          to: isSignedIn ? "/profile" : "/login",
          icon: UserCircle,
        },
      ];
    }

    if (isTeacher) {
      return [
        { key: "home", label: "Home", to: "/", icon: Home },
        { key: "attendance", label: "Scan", to: "/attendance", icon: ScanLine },
        { key: "register", label: "Enroll", to: "/register", icon: UserPlus },
        { key: "teacher", label: "Class", to: "/teacher", icon: GraduationCap },
        {
          key: "profile",
          label: isSignedIn ? "Profile" : "Sign In",
          to: isSignedIn ? "/profile" : "/login",
          icon: UserCircle,
        },
      ];
    }

    if (isGuard) {
      return [
        { key: "home", label: "Home", to: "/", icon: Home },
        { key: "guard", label: "Guard", to: "/guard", icon: QrCode },
        { key: "gate-pass", label: "Gate Pass", to: "/gate-pass", icon: ShieldCheck },
        { key: "emergency", label: "SOS", to: "/emergency", icon: ShieldAlert },
        {
          key: "profile",
          label: isSignedIn ? "Profile" : "Sign In",
          to: isSignedIn ? "/profile" : "/login",
          icon: UserCircle,
        },
      ];
    }

    // Default (Parents / Students / Guests)
    return [
      { key: "home", label: "Home", to: "/", icon: Home },
      { key: "attendance", label: "Scan", to: "/attendance", icon: ScanLine },
      { key: "gate-pass", label: "Gate Pass", to: "/gate-pass", icon: QrCode },
      { key: "parent", label: "Safety", to: "/parent", icon: ShieldCheck },
      {
        key: "profile",
        label: isSignedIn ? "Profile" : "Sign In",
        to: isSignedIn ? "/profile" : "/login",
        icon: UserCircle,
      },
    ];
  }, [isAdminOrPrincipal, isGuard, isTeacher, isSignedIn]);

  const handleTabPress = () => {
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  };

  const isAndroidNative = Capacitor.isNativePlatform() || isMobile;

  if (!isAndroidNative) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-[100dvh] w-full bg-[#07090E] text-slate-100 flex flex-col relative select-none antialiased">
      {/* Mobile Liquid Ambient Refraction Atmosphere */}
      <div className="premium-ambient" aria-hidden="true" />

      {/* Offline Toast Banner */}
      {isOffline && (
        <div className="fixed top-0 inset-x-0 z-50 bg-amber-500/20 border-b border-amber-500/30 backdrop-blur-md px-3 py-1.5 flex items-center justify-center gap-2 text-xs font-medium text-amber-200">
          <WifiOff className="w-3.5 h-3.5 animate-pulse" />
          <span>Offline Edge Mode Active — Data Queued Locally</span>
        </div>
      )}

      {/* Top App Bar with Android Ergonomics & Liquid Glass Specular Meniscus */}
      {!hasCustomHeader && (
        <header className="sticky top-0 z-40 w-full bg-[#07090E]/85 backdrop-blur-xl border-b border-white/10 safe-area-top relative">
          <span className="pointer-events-none absolute inset-x-6 bottom-0 h-[1px] bg-gradient-to-r from-transparent via-cyan-400/40 to-transparent" />
          <div className="flex h-14 items-center justify-between px-4">
            <div className="flex items-center gap-2.5">
              <Logo size="sm" className="shrink-0" />
              <div className="flex flex-col">
                <span className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
                  {routeTitles[path] ?? "Presences"}
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                </span>
                <span className="text-[10px] text-slate-400 font-medium">Smart Campus AI</span>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2">
              <LiteModeToggle variant="icon" className="h-8 w-8 text-slate-300 hover:text-white" />

              <Link
                to="/emergency"
                onClick={handleTabPress}
                className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-xs font-semibold active:scale-95 transition-transform touch-manipulation"
                title="Campus Emergency SOS"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
                <span>SOS</span>
              </Link>

              <Link
                to="/notifications"
                onClick={handleTabPress}
                className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-slate-300 active:scale-90 transition-transform relative touch-manipulation"
              >
                <Bell className="w-4 h-4" />
                <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-cyan-400" />
              </Link>
            </div>
          </div>
        </header>
      )}

      {/* Main Content Area */}
      <main
        className={cn(
          "flex-1 w-full",
          isImmersiveRoute
            ? "p-0 min-h-[100dvh]"
            : cn(
                "px-3 sm:px-4 py-3",
                !isImmersiveRoute && "pb-[calc(80px+env(safe-area-inset-bottom))]"
              )
        )}
      >
        {children}
      </main>

      {/* Android Material 3 + Liquid Glass Floating Bottom Dock */}
      {!isImmersiveRoute && (
        <nav className="fixed inset-x-0 bottom-0 z-40 safe-area-bottom pointer-events-none">
          <div className="mx-3 mb-2 pointer-events-auto">
            <div className="liquid-glass-dock p-1.5 flex items-center justify-around relative shadow-2xl">
              {/* Specular Liquid Edge Meniscus Highlight */}
              <span className="pointer-events-none absolute inset-x-6 top-0 h-[1.5px] bg-gradient-to-r from-transparent via-white/95 dark:via-cyan-300/60 to-transparent" />
              {tabs.map((tab) => {
                const isActive =
                  path === tab.to ||
                  (tab.to !== "/" && path.startsWith(tab.to));

                return (
                  <Link
                    key={tab.key}
                    to={tab.to}
                    onClick={handleTabPress}
                    onTouchStart={() => preloadRoute(tab.to)}
                    onMouseEnter={() => preloadRoute(tab.to)}
                    onPointerDown={() => preloadRoute(tab.to)}
                    className={cn(
                      "flex flex-col items-center justify-center py-1.5 px-3 rounded-full relative transition-all duration-200 active:scale-95 min-w-[56px] select-none touch-manipulation",
                      isActive
                        ? "text-white font-bold"
                        : "text-slate-300 hover:text-white"
                    )}
                  >
                    {isActive && (
                      <motion.div
                        layoutId="android-bottom-active-pill"
                        className="liquid-glass-pill absolute inset-0 -z-10 shadow-md"
                        transition={{ type: "spring", stiffness: 460, damping: 32 }}
                      />
                    )}
                    <tab.icon
                      className={cn(
                        "w-5 h-5 transition-transform duration-200",
                        isActive ? "scale-105 text-white stroke-[2.2]" : "stroke-[1.8] text-slate-300"
                      )}
                    />
                    <span className="text-[10px] tracking-tight mt-1 leading-none font-medium">
                      {tab.label}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </nav>
      )}
    </div>
  );
};

export default AndroidAppShell;
