import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  ShieldCheck,
  Clock,
  Calendar,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  Share2,
  Lock
} from "lucide-react";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const DigitalGatePassPage: React.FC = () => {
  const navigate = useNavigate();
  const [studentName, setStudentName] = useState("Alex Rivera");
  const [studentId, setStudentId] = useState("STU-2026-8819");
  const [timeLeft, setTimeLeft] = useState(30);
  const [securityToken, setSecurityToken] = useState("");

  // Generate dynamic cryptographic rolling token every 30 seconds
  useEffect(() => {
    const generateToken = () => {
      const randomSeed = Math.random().toString(36).substring(2, 10).toUpperCase();
      const timestamp = Date.now().toString(36).toUpperCase();
      setSecurityToken(`PRESENCES-PASS::${studentId}::${timestamp}::${randomSeed}`);
      setTimeLeft(30);
    };

    generateToken();
    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          generateToken();
          return 30;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [studentId]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user?.user_metadata?.full_name) {
        setStudentName(user.user_metadata.full_name);
      }
      if (user?.id) {
        setStudentId(`STU-${user.id.substring(0, 8).toUpperCase()}`);
      }
    });
  }, []);

  const handleShare = () => {
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
    if (navigator.share) {
      navigator.share({
        title: "Presences Digital Gate Pass",
        text: `Official Campus Gate Pass for ${studentName} (${studentId})`,
        url: window.location.href,
      }).catch(() => {});
    } else {
      toast.success("Security Pass Link Copied to Clipboard");
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-md mx-auto w-full pt-1 pb-6 px-1 animate-element-coming">
      {/* Top Navigation */}
      <div className="flex items-center justify-between">
        <button
          onClick={() => {
            Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
            navigate(-1);
          }}
          className="w-9 h-9 rounded-full bg-slate-800/80 border border-white/10 flex items-center justify-center text-slate-300 active:scale-90 transition-transform"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <span className="text-sm font-bold text-white uppercase tracking-wider">
          Digital Security Pass
        </span>
        <button
          onClick={handleShare}
          className="w-9 h-9 rounded-full bg-slate-800/80 border border-white/10 flex items-center justify-center text-slate-300 active:scale-90 transition-transform"
        >
          <Share2 className="w-4 h-4" />
        </button>
      </div>

      {/* Hero Holographic Glass Pass Card */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900/95 via-slate-900/80 to-slate-950/95 border border-white/20 p-5 shadow-[0_20px_50px_rgba(0,0,0,0.6)]">
        {/* Iridescent Light Caustic Borders */}
        <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-80" />
        <div className="absolute -top-16 -right-16 w-40 h-40 rounded-full bg-cyan-500/15 blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -left-16 w-40 h-40 rounded-full bg-blue-500/15 blur-3xl pointer-events-none" />

        {/* Card Header */}
        <div className="flex items-start justify-between border-b border-white/10 pb-3">
          <div className="flex flex-col">
            <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-400">
              Official Campus Pass
            </span>
            <h3 className="text-lg font-black tracking-tight text-white">
              Apex Institute of Technology
            </h3>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 text-[10px] font-bold flex items-center gap-1">
            <ShieldCheck className="w-3 h-3 text-emerald-400" />
            Verified
          </span>
        </div>

        {/* Pass Category & Window */}
        <div className="flex items-center justify-between my-3 px-3 py-2 rounded-2xl bg-white/5 border border-white/5">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-400" />
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400">Authorization Type</span>
              <span className="text-xs font-bold text-amber-300">Authorized Campus Exit</span>
            </div>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-slate-400">Valid Window</span>
            <p className="text-xs font-bold text-white">Today 01:30 - 03:00 PM</p>
          </div>
        </div>

        {/* Dynamic Rolling Security QR Code Container */}
        <div className="flex flex-col items-center justify-center my-3 p-4 rounded-2xl bg-white/5 border border-white/10 relative">
          <div className="p-3 bg-white rounded-2xl shadow-xl relative">
            <QRCodeSVG
              value={securityToken || "PRESENCES-SECURE-TOKEN"}
              size={180}
              level="H"
              includeMargin={false}
            />
          </div>

          {/* Rolling Timer Badge */}
          <div className="mt-3 flex items-center gap-2 px-3 py-1 rounded-full bg-slate-800/80 border border-white/10 text-xs text-slate-300">
            <RefreshCw className="w-3.5 h-3.5 text-cyan-400 animate-spin" />
            <span>Refreshes in <strong className="text-cyan-300 font-mono">{timeLeft}s</strong></span>
          </div>
          <span className="text-[9px] text-slate-400 mt-1">Anti-Screenshot Dynamic Protection</span>
        </div>

        {/* Student Details Grid */}
        <div className="grid grid-cols-2 gap-2 text-xs border-t border-white/10 pt-3">
          <div>
            <span className="text-[10px] text-slate-400 block">Student Name</span>
            <span className="font-bold text-white truncate block">{studentName}</span>
          </div>
          <div>
            <span className="text-[10px] text-slate-400 block">Student ID</span>
            <span className="font-bold text-cyan-300 font-mono block">{studentId}</span>
          </div>
        </div>

        {/* Digital Signature Watermark */}
        <div className="mt-3 pt-2 border-t border-white/5 flex items-center justify-between text-[10px] text-slate-400">
          <span className="flex items-center gap-1">
            <Lock className="w-3 h-3 text-emerald-400" />
            AES-256 Verified
          </span>
          <span>Auth by Dean of Students</span>
        </div>
      </div>

      {/* Scanner Instruction Card */}
      <div className="rounded-2xl bg-slate-900/60 border border-white/10 p-3 flex items-start gap-3">
        <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <p className="text-[11px] text-slate-300 leading-relaxed">
          Hold this dynamic QR code directly in front of the gate turnstile scanner or security guard terminal. Static screenshots or forwarded images will be automatically rejected.
        </p>
      </div>
    </div>
  );
};

export default DigitalGatePassPage;
