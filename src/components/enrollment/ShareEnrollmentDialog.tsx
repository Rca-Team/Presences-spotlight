import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Share2,
  Copy,
  Check,
  Send,
  MessageCircle,
  Sparkles,
  ExternalLink,
  ShieldCheck,
  School,
  Code2,
} from 'lucide-react';
import { toast } from 'sonner';

interface ShareEnrollmentDialogProps {
  trigger?: React.ReactNode;
}

const ENROLL_URL = 'https://www.presences.dev/enroll';
const SCHOOL_NAME = 'PM Shri Kendriya Vidyalaya NFC Vigyan Vihar';
const DEVELOPER_NAME = 'Gaurav';
const TEAM_NAME = 'Team RCA';

export default function ShareEnrollmentDialog({ trigger }: ShareEnrollmentDialogProps) {
  const [open, setOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedMessage, setCopiedMessage] = useState(false);

  const formattedMessage = `🎓 *${SCHOOL_NAME}*
📸 *Official Student Face Biometric Enrollment Portal*

Dear Parents & Students,
Please complete your digital face registration for contactless morning attendance & campus safety:
👉 ${ENROLL_URL}

⚡ *Quick 10-Second Setup* — requires Admission Number & Parent Mobile.
🛡️ *Secure & Encrypted* biometric profile.

_Powered by Presences AI • Engineered by ${DEVELOPER_NAME} (${TEAM_NAME})_`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(ENROLL_URL);
      setCopiedLink(true);
      toast.success('Enrollment link copied to clipboard!');
      setTimeout(() => setCopiedLink(false), 2000);
    } catch {
      toast.error('Could not copy link');
    }
  };

  const handleCopyMessage = async () => {
    try {
      await navigator.clipboard.writeText(formattedMessage);
      setCopiedMessage(true);
      toast.success('WhatsApp invite message copied!');
      setTimeout(() => setCopiedMessage(false), 2000);
    } catch {
      toast.error('Could not copy message');
    }
  };

  const handleWhatsAppShare = () => {
    const encoded = encodeURIComponent(formattedMessage);
    const whatsappUrl = `https://api.whatsapp.com/send?text=${encoded}`;
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  };

  const handleNativeShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({
          title: `Student Face Enrollment | ${SCHOOL_NAME}`,
          text: `Official Student Face Biometric Enrollment Portal for ${SCHOOL_NAME}. Engineered by ${DEVELOPER_NAME} (${TEAM_NAME}).`,
          url: ENROLL_URL,
        });
        toast.success('Shared successfully!');
      } catch {
        // User canceled or failed
      }
    } else {
      handleWhatsAppShare();
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25 transition-all shadow-sm active:scale-95 cursor-pointer"
          >
            <Share2 size={13} className="text-emerald-400" />
            <span>Share Link</span>
          </button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-md bg-slate-950 border-slate-800 text-white p-6 rounded-3xl shadow-2xl overflow-hidden">
        {/* Glow backdrop */}
        <div className="absolute -top-16 -left-16 w-44 h-44 bg-emerald-500/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-16 -right-16 w-44 h-44 bg-cyan-500/20 rounded-full blur-3xl pointer-events-none" />

        <DialogHeader className="space-y-1 relative">
          <div className="flex items-center gap-2">
            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-400/30 gap-1 text-[11px] font-bold">
              <Sparkles size={11} /> Share Portal
            </Badge>
            <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-400/30 gap-1 text-[11px] font-bold">
              <School size={11} /> PM Shri KV NFC
            </Badge>
          </div>
          <DialogTitle className="text-xl font-black text-white tracking-tight pt-1">
            Send Enrollment Link
          </DialogTitle>
          <DialogDescription className="text-slate-400 text-xs">
            Send this official portal link to parents or students on WhatsApp, SMS, or Telegram with school &amp; developer branding.
          </DialogDescription>
        </DialogHeader>

        {/* Live WhatsApp Preview Card (matches what recipient will see) */}
        <div className="mt-2 space-y-2">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">
            Link Preview on WhatsApp
          </span>

          <div className="rounded-2xl border border-slate-700/80 bg-slate-900/95 overflow-hidden shadow-xl transition-all">
            {/* OG Banner Image */}
            <div className="relative aspect-[1.91/1] w-full bg-slate-950 overflow-hidden border-b border-white/5">
              <img
                src="/og-enroll.png"
                alt="Student Face Enrollment Portal"
                className="w-full h-full object-cover"
                loading="eager"
              />
              <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-2 py-0.5 rounded-full border border-white/10 text-[10px] text-emerald-300 font-bold">
                <ShieldCheck size={11} className="text-emerald-400" /> Official Portal
              </div>
            </div>

            {/* Link Preview Meta */}
            <div className="p-3.5 space-y-1 bg-slate-900/90">
              <p className="text-[10px] font-mono font-medium text-slate-400 uppercase tracking-wider">
                presences.dev
              </p>
              <h4 className="text-sm font-bold text-white line-clamp-1 leading-snug">
                Student Face Enrollment • PM Shri KV NFC Vigyan Vihar
              </h4>
              <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                Official face biometric &amp; attendance enrollment portal for {SCHOOL_NAME}. Engineered by {DEVELOPER_NAME} ({TEAM_NAME}).
              </p>
            </div>
          </div>
        </div>

        {/* Developer & Institution Credit Callout */}
        <div className="flex items-center justify-between p-2.5 rounded-xl bg-white/[0.03] border border-white/10 text-xs text-slate-300">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full overflow-hidden border border-emerald-400/50 bg-slate-800 shrink-0">
              <img src="/gaurav-photo.png" alt="Gaurav" className="w-full h-full object-cover" />
            </div>
            <div>
              <span className="text-slate-400 text-[10px] block">Developed &amp; Architected by</span>
              <span className="font-bold text-white text-[11px]">{DEVELOPER_NAME} ({TEAM_NAME})</span>
            </div>
          </div>
          <a
            href="/portfolio"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            <span>Portfolio</span>
            <ExternalLink size={10} />
          </a>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2.5 pt-1">
          <Button
            type="button"
            onClick={handleWhatsAppShare}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs h-10 rounded-xl gap-2 shadow-lg shadow-emerald-600/20"
          >
            <MessageCircle size={15} />
            <span>Send WhatsApp</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleCopyLink}
            className="w-full border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-slate-200 font-semibold text-xs h-10 rounded-xl gap-2"
          >
            {copiedLink ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            <span>{copiedLink ? 'Link Copied!' : 'Copy Link'}</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleCopyMessage}
            className="w-full border-slate-700 bg-slate-900/80 hover:bg-slate-800 text-slate-200 font-semibold text-xs h-10 rounded-xl gap-2 col-span-2"
          >
            {copiedMessage ? <Check size={14} className="text-emerald-400" /> : <Send size={14} />}
            <span>{copiedMessage ? 'Invite Message Copied!' : 'Copy Full Invite Message'}</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
