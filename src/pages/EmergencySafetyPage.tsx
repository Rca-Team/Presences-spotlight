import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ShieldAlert,
  ArrowLeft,
  CheckCircle2,
  PhoneCall,
  MapPin,
  Users,
  Compass,
  AlertOctagon,
  Flame,
  Radio
} from "lucide-react";
import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const EmergencySafetyPage: React.FC = () => {
  const navigate = useNavigate();
  const [isMarkedSafe, setIsMarkedSafe] = useState(false);
  const [safeCount, setSafeCount] = useState(1420);

  const handleMarkSafe = () => {
    Haptics.notification({ type: NotificationType.Success }).catch(() => {});
    setIsMarkedSafe(true);
    setSafeCount((prev) => prev + 1);
    toast.success("Status Updated: You have been marked SAFE at Assembly Point Beta", {
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-400" />,
    });
  };

  return (
    <div className="flex flex-col gap-4 max-w-md mx-auto w-full pt-1 pb-8 px-1 min-h-[92dvh] animate-element-coming">
      {/* Top Bar with Urgent Crimson Glow */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => {
            Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
            navigate(-1);
          }}
          className="w-9 h-9 rounded-full bg-rose-950/80 border border-rose-500/30 flex items-center justify-center text-rose-300 active:scale-90 transition-transform"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-xs font-extrabold text-rose-400 uppercase tracking-widest flex items-center gap-1.5">
          <Radio className="w-3.5 h-3.5 text-rose-500 animate-ping" />
          Campus Emergency Broadcast
        </span>
        <div className="w-9" />
      </div>

      {/* Critical Alert Hero Card */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-rose-950/90 via-rose-900/40 to-slate-950/95 border-2 border-rose-500/40 p-5 shadow-[0_20px_50px_rgba(239,68,68,0.3)]">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-rose-500/20 border border-rose-500/40 flex items-center justify-center text-rose-400 shrink-0">
            <Flame className="w-7 h-7 text-rose-500 animate-bounce" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-rose-400">
              Active Evacuation Order
            </span>
            <h2 className="text-xl font-black text-white tracking-tight leading-tight">
              Level 2 Evacuation Drill
            </h2>
            <p className="text-xs text-rose-200/80 mt-1">
              Sector C Fire Sensor Triggered • Proceed immediately to designated assembly points.
            </p>
          </div>
        </div>
      </div>

      {/* Primary Life-Safety Action Button */}
      <div className="rounded-3xl bg-slate-900/80 border border-white/10 p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-slate-300">Your Personal Safety Status</span>
          {isMarkedSafe ? (
            <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-bold flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              Confirmed Safe
            </span>
          ) : (
            <span className="px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-[10px] font-bold">
              Action Required
            </span>
          )}
        </div>

        <button
          onClick={handleMarkSafe}
          disabled={isMarkedSafe}
          className={cn(
            "w-full py-3.5 px-4 rounded-2xl font-bold text-sm shadow-xl flex items-center justify-center gap-2 transition-all active:scale-95 border",
            isMarkedSafe
              ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-300 cursor-default"
              : "bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white border-emerald-300/30 shadow-[0_10px_25px_rgba(16,185,129,0.35)]"
          )}
        >
          <CheckCircle2 className="w-5 h-5" />
          <span>{isMarkedSafe ? "You Are Recorded as Safe" : "I Am Safe at Assembly Point"}</span>
        </button>
        <p className="text-[10px] text-slate-400 text-center">
          Tapping transmits your GPS coordinates and biometric timestamp to campus rescue dispatch.
        </p>
      </div>

      {/* Live Campus Headcount Telemetry */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
          <div className="flex items-center gap-1.5 text-emerald-400 mb-1">
            <Users className="w-4 h-4" />
            <span className="text-[10px] uppercase font-bold">Confirmed Safe</span>
          </div>
          <span className="text-2xl font-black text-white font-mono">{safeCount}</span>
          <span className="text-[10px] text-emerald-300/70 block mt-0.5">Students & Faculty</span>
        </div>

        <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20">
          <div className="flex items-center gap-1.5 text-amber-400 mb-1">
            <AlertOctagon className="w-4 h-4" />
            <span className="text-[10px] uppercase font-bold">Unaccounted</span>
          </div>
          <span className="text-2xl font-black text-white font-mono">18</span>
          <span className="text-[10px] text-amber-300/70 block mt-0.5">Search teams deployed</span>
        </div>
      </div>

      {/* Evacuation Wayfinding Guide */}
      <div className="rounded-3xl bg-slate-900/60 border border-white/10 p-4 flex flex-col gap-2.5">
        <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
          <Compass className="w-4 h-4 text-cyan-400" />
          Evacuation Route Guidance
        </h4>
        <div className="p-3 rounded-2xl bg-white/5 border border-white/5 flex items-start gap-3">
          <MapPin className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-white">Assembly Point Beta (Main Athletic Field)</p>
            <p className="text-[11px] text-slate-300 mt-0.5">
              Exit via North Stairwell. Do NOT take elevators. Follow floor marshals with green vests.
            </p>
          </div>
        </div>
      </div>

      {/* Direct One-Touch Emergency Call Dock */}
      <div className="flex items-center justify-between gap-2 mt-auto">
        <a
          href="tel:911"
          className="flex-1 py-3 px-3 rounded-2xl bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 text-xs font-bold flex items-center justify-center gap-2 active:scale-95 transition-all"
        >
          <PhoneCall className="w-4 h-4" />
          <span>Call Security</span>
        </a>
        <a
          href="tel:102"
          className="flex-1 py-3 px-3 rounded-2xl bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-300 text-xs font-bold flex items-center justify-center gap-2 active:scale-95 transition-all"
        >
          <PhoneCall className="w-4 h-4" />
          <span>Call Medical</span>
        </a>
      </div>
    </div>
  );
};

export default EmergencySafetyPage;
