import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ScanLine,
  QrCode,
  CalendarCheck,
  Clock,
  MapPin,
  CheckCircle2,
  ShieldAlert,
  ArrowRight,
  TrendingUp,
  UserCheck,
  FileText,
  LayoutDashboard,
  UserPlus,
  Sparkles,
  RefreshCw
} from "lucide-react";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useUserRole } from "@/hooks/useUserRole";

export const AndroidDashboard: React.FC = () => {
  const navigate = useNavigate();
  const { isAdminOrPrincipal, isTeacher } = useUserRole();
  const [userName, setUserName] = useState<string>("Student");
  const [currentTime, setCurrentTime] = useState<string>("");
  const [isCheckedIn, setIsCheckedIn] = useState<boolean>(true);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: true,
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.user_metadata?.full_name) {
        setUserName(user.user_metadata.full_name.split(" ")[0]);
      } else if (user?.email) {
        setUserName(user.email.split("@")[0]);
      }
    });
  }, []);

  const triggerHaptic = () => {
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  };

  return (
    <div className="flex flex-col gap-4 pb-6 max-w-lg mx-auto w-full">
      {/* Welcome Banner */}
      <div className="flex items-center justify-between px-1">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            Hi, {userName} <span className="animate-bounce inline-block">👋</span>
          </h2>
          <p className="text-xs text-slate-400">Campus Day — {currentTime}</p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 text-xs font-semibold">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>On Campus</span>
        </div>
      </div>

      {/* Hero Attendance Status Card with Nano-Glass & Emerald Caustic Glow */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900/90 via-slate-900/70 to-slate-950/90 border border-white/15 p-5 shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
        {/* Subtle Caustic Background Halo */}
        <div className="absolute -top-12 -right-12 w-44 h-44 rounded-full bg-emerald-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-10 -left-10 w-36 h-36 rounded-full bg-sky-500/10 blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col gap-4">
          <div className="flex items-start justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-[11px] font-semibold tracking-wider uppercase text-emerald-400 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Verified Attendance
              </span>
              <h3 className="text-2xl font-extrabold text-white tracking-tight">
                {isCheckedIn ? "Present Today" : "Not Marked Yet"}
              </h3>
              <p className="text-xs text-slate-400 flex items-center gap-1">
                <MapPin className="w-3 h-3 text-sky-400" />
                Main Pedestrian Gate 01 • 08:32 AM
              </p>
            </div>

            {/* Circular Punctuality Dial */}
            <div className="flex flex-col items-center justify-center w-16 h-16 rounded-full bg-slate-800/80 border-2 border-emerald-400/40 relative shadow-inner">
              <span className="text-sm font-bold text-white">98%</span>
              <span className="text-[8px] text-emerald-400 uppercase font-semibold">Streak</span>
            </div>
          </div>

          {/* Quick Face Check-In Trigger */}
          <button
            onClick={() => {
              triggerHaptic();
              navigate("/attendance");
            }}
            className="w-full flex items-center justify-center gap-2 py-3 px-4 rounded-2xl bg-gradient-to-r from-sky-500 via-sky-600 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-semibold text-sm shadow-[0_8px_20px_rgba(14,165,233,0.35)] border border-sky-300/30 active:scale-95 transition-all"
          >
            <ScanLine className="w-4 h-4" />
            <span>Launch Biometric Face Scanner</span>
            <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </button>
        </div>
      </div>

      {/* 4-Tile Quick Action Modular Grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Tile 1: Digital Gate Pass */}
        <Link
          to="/gate-pass"
          onClick={triggerHaptic}
          className="group relative flex flex-col justify-between p-4 rounded-2xl bg-slate-900/60 hover:bg-slate-900/80 border border-white/10 hover:border-sky-400/30 transition-all duration-200 active:scale-95"
        >
          <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-400/25 flex items-center justify-center text-sky-400 mb-2">
            <QrCode className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white group-hover:text-sky-300 transition-colors">
              Digital Gate Pass
            </h4>
            <p className="text-[11px] text-slate-400 mt-0.5">Rolling QR code exit</p>
          </div>
        </Link>

        {/* Tile 2: Parent Safety Portal */}
        <Link
          to="/parent"
          onClick={triggerHaptic}
          className="group relative flex flex-col justify-between p-4 rounded-2xl bg-slate-900/60 hover:bg-slate-900/80 border border-white/10 hover:border-emerald-400/30 transition-all duration-200 active:scale-95"
        >
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-400/25 flex items-center justify-center text-emerald-400 mb-2">
            <UserCheck className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white group-hover:text-emerald-300 transition-colors">
              Parent Portal
            </h4>
            <p className="text-[11px] text-slate-400 mt-0.5">Live gate photo logs</p>
          </div>
        </Link>

        {/* Tile 3: Role-Aware Hub (Admin / Teacher / Quick Tools) */}
        <Link
          to={isAdminOrPrincipal ? "/admin" : isTeacher ? "/teacher" : "/widgets"}
          onClick={triggerHaptic}
          className="group relative flex flex-col justify-between p-4 rounded-2xl bg-slate-900/60 hover:bg-slate-900/80 border border-white/10 hover:border-purple-400/30 transition-all duration-200 active:scale-95"
        >
          <div className="w-10 h-10 rounded-xl bg-purple-500/15 border border-purple-400/25 flex items-center justify-center text-purple-400 mb-2">
            {isAdminOrPrincipal ? (
              <LayoutDashboard className="w-5 h-5" />
            ) : isTeacher ? (
              <UserPlus className="w-5 h-5" />
            ) : (
              <Sparkles className="w-5 h-5" />
            )}
          </div>
          <div>
            <h4 className="text-sm font-bold text-white group-hover:text-purple-300 transition-colors">
              {isAdminOrPrincipal ? "Admin Hub" : isTeacher ? "Teacher Portal" : "Quick Tools"}
            </h4>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {isAdminOrPrincipal ? "School management" : isTeacher ? "Class attendance" : "Smart campus AI"}
            </p>
          </div>
        </Link>

        {/* Tile 4: Emergency SOS Broadcast */}
        <Link
          to="/emergency"
          onClick={triggerHaptic}
          className="group relative flex flex-col justify-between p-4 rounded-2xl bg-rose-950/30 hover:bg-rose-950/50 border border-rose-500/25 hover:border-rose-400/40 transition-all duration-200 active:scale-95"
        >
          <div className="w-10 h-10 rounded-xl bg-rose-500/20 border border-rose-400/30 flex items-center justify-center text-rose-400 mb-2">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-rose-200 group-hover:text-rose-100 transition-colors">
              Crisis Safety HUD
            </h4>
            <p className="text-[11px] text-rose-300/70 mt-0.5">Instant SOS & assembly</p>
          </div>
        </Link>
      </div>

      {/* Today's Academic Schedule Stepper */}
      <div className="flex flex-col gap-2.5 rounded-3xl bg-slate-900/60 border border-white/10 p-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5 text-sky-400" />
            Today's Academic Schedule
          </h4>
          <span className="text-[10px] text-slate-400">4 Lectures Today</span>
        </div>

        <div className="flex flex-col gap-2.5 mt-1">
          {/* Period 1 */}
          <div className="flex items-center justify-between p-2.5 rounded-2xl bg-white/5 border border-white/5">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-emerald-400" />
              <div>
                <p className="text-xs font-bold text-white">Neural Networks & AI</p>
                <p className="text-[10px] text-slate-400">09:00 - 10:15 AM • Room 402</p>
              </div>
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              Present
            </span>
          </div>

          {/* Period 2 */}
          <div className="flex items-center justify-between p-2.5 rounded-2xl bg-sky-500/10 border border-sky-400/20">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-sky-400 animate-ping" />
              <div>
                <p className="text-xs font-bold text-sky-200">Cloud Architecture Lab</p>
                <p className="text-[10px] text-sky-300/70">10:30 - 11:45 AM • Lab B</p>
              </div>
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-400/30">
              In Progress
            </span>
          </div>

          {/* Period 3 */}
          <div className="flex items-center justify-between p-2.5 rounded-2xl bg-white/5 border border-white/5 opacity-80">
            <div className="flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-slate-500" />
              <div>
                <p className="text-xs font-bold text-slate-300">Distributed Database Systems</p>
                <p className="text-[10px] text-slate-400">12:00 - 01:15 PM • Lecture Hall 1</p>
              </div>
            </div>
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-white/10">
              Upcoming
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AndroidDashboard;
