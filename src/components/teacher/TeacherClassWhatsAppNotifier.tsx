import React, { useState, useMemo, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  MessageSquare,
  Copy,
  Check,
  Send,
  Phone,
  Share2,
  Users,
  UserX,
  Clock,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Smartphone,
  Eye,
  FileText,
  School,
  Calendar,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

export interface WhatsAppStudent {
  id: string;
  name: string;
  roll_number?: string;
  admission_number?: string;
  parent_name?: string;
  parent_phone?: string;
  today_status?: 'present' | 'late' | 'absent' | 'unmarked';
  today_time?: string;
}

export interface TeacherClassWhatsAppNotifierProps {
  isOpen: boolean;
  onClose: () => void;
  activeClass: { class: string; section: string; category: string };
  students: WhatsAppStudent[];
  teacherName: string;
  teacherEmail?: string;
  teacherPhone?: string;
  schoolName?: string;
}

type MessagePreset = 'daily_summary' | 'urgent_absentee' | 'full_present' | 'custom';

export const TeacherClassWhatsAppNotifier: React.FC<TeacherClassWhatsAppNotifierProps> = ({
  isOpen,
  onClose,
  activeClass,
  students,
  teacherName,
  teacherEmail,
  teacherPhone,
  schoolName = 'PM Shri KV NFC Vigyan Vihar',
}) => {
  const { toast } = useToast();

  // Customization state
  const [selectedPreset, setSelectedPreset] = useState<MessagePreset>('daily_summary');
  const [customRemark, setCustomRemark] = useState('');
  const [overrideTeacherName, setOverrideTeacherName] = useState(teacherName || '');
  const [includeLateDetails, setIncludeLateDetails] = useState(true);
  const [includeRollOnly, setIncludeRollOnly] = useState(false);
  const [cutoffTime, setCutoffTime] = useState('08:15 AM');
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<'broadcast' | 'individual'>('broadcast');
  const [individualSearch, setIndividualSearch] = useState('');

  // Update teacher name when prop changes
  React.useEffect(() => {
    if (teacherName && !overrideTeacherName) {
      setOverrideTeacherName(teacherName);
    }
  }, [teacherName, overrideTeacherName]);

  // Compute live class statistics
  const stats = useMemo(() => {
    const total = students.length;
    const presentList = students.filter(s => s.today_status === 'present');
    const lateList = students.filter(s => s.today_status === 'late');
    const absentList = students.filter(s => s.today_status === 'absent');
    const unmarkedList = students.filter(s => !s.today_status || s.today_status === 'unmarked');
    
    // Effective absentees: marked absent + unmarked after cutoff
    const effectiveAbsentees = [...absentList, ...unmarkedList].sort((a, b) => {
      const rollA = parseInt(a.roll_number || '999', 10);
      const rollB = parseInt(b.roll_number || '999', 10);
      if (rollA !== rollB) return rollA - rollB;
      return a.name.localeCompare(b.name);
    });

    const attendedCount = presentList.length + lateList.length;
    const percentage = total > 0 ? Math.round((attendedCount / total) * 100) : 0;

    return {
      total,
      presentCount: presentList.length,
      lateCount: lateList.length,
      absentCount: effectiveAbsentees.length,
      attendedCount,
      percentage,
      presentList,
      lateList,
      effectiveAbsentees,
    };
  }, [students]);

  // Today's formatted date string
  const todayDateStr = useMemo(() => {
    try {
      return format(new Date(), 'EEEE, dd MMMM yyyy');
    } catch {
      return new Date().toLocaleDateString('en-IN', {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      });
    }
  }, []);

  const shortDateStr = useMemo(() => {
    try {
      return format(new Date(), 'dd-MM-yyyy');
    } catch {
      return new Date().toLocaleDateString('en-IN');
    }
  }, []);

  // Format the WhatsApp message based on chosen preset & customization options
  const formattedMessage = useMemo(() => {
    const divider = '━━━━━━━━━━━━━━━━━━━━━━';
    const teacherDisplay = overrideTeacherName.trim() || teacherName || 'Class Incharge';
    const classCategory = activeClass.category || `Class ${activeClass.class}-${activeClass.section}`;

    if (selectedPreset === 'full_present' || (stats.total > 0 && stats.absentCount === 0)) {
      return (
        `🏫 *${schoolName.toUpperCase()}*\n` +
        `🌟 *100% ATTENDANCE CELEBRATION*\n` +
        `📋 *${classCategory}*\n` +
        `🗓️ *Date:* ${todayDateStr}\n` +
        `👩‍🏫 *Class Teacher:* ${teacherDisplay}\n` +
        `${divider}\n` +
        `🎉 *Hearty Congratulations Parents & Students!*\n` +
        `All *${stats.total}* students of ${classCategory} are marked *PRESENT* today.\n\n` +
        `Thank you for ensuring punctuality and regular school attendance.\n` +
        (customRemark.trim() ? `\n📌 *Special Note:* ${customRemark.trim()}\n` : '') +
        `${divider}\n` +
        `🇮🇳 _PM Shri KV NFC Vigyan Vihar Attendance Desk_`
      );
    }

    if (selectedPreset === 'urgent_absentee') {
      const absenteeLines = stats.effectiveAbsentees.map((s, idx) => {
        const roll = s.roll_number ? `Roll ${s.roll_number}` : `S.No ${idx + 1}`;
        return includeRollOnly ? `• ${roll}` : `• ${roll} — *${s.name}*`;
      }).join('\n');

      return (
        `⚠️ *${schoolName.toUpperCase()}*\n` +
        `🚨 *URGENT: ABSENTEE NOTIFICATION*\n` +
        `📋 *${classCategory}*\n` +
        `🗓️ *Date:* ${todayDateStr} (Gate Cutoff: ${cutoffTime})\n` +
        `👩‍🏫 *Class Teacher:* ${teacherDisplay}\n` +
        `${divider}\n` +
        `Dear Parents,\nThe following *${stats.absentCount}* students are recorded *ABSENT / NOT REPORTED* at school as of ${cutoffTime}:\n\n` +
        `${absenteeLines || 'None'}\n\n` +
        `⚠️ *ACTION REQUIRED:*\n` +
        `If your ward departed from home for school, please check with the school desk immediately. If on medical/planned leave, kindly send a leave note to the class teacher.\n` +
        (customRemark.trim() ? `\n📌 *Teacher's Note:* ${customRemark.trim()}\n` : '') +
        `${divider}\n` +
        `📞 *School Desk / Teacher:* ${teacherPhone || 'Official School Channel'}\n` +
        `🇮🇳 _PM Shri Kendriya Vidyalaya NFC Vigyan Vihar_`
      );
    }

    // Default: 'daily_summary' or 'custom'
    const absenteeLines = stats.effectiveAbsentees.length > 0
      ? stats.effectiveAbsentees.map((s, idx) => {
          const roll = s.roll_number ? `Roll ${s.roll_number}` : `S.No ${idx + 1}`;
          return includeRollOnly ? `  ${idx + 1}. ${roll}` : `  ${idx + 1}. ${roll} • *${s.name}*`;
        }).join('\n')
      : '  ✅ None! All students are present.';

    const lateLines = includeLateDetails && stats.lateList.length > 0
      ? stats.lateList.map((s, idx) => {
          const roll = s.roll_number ? `Roll ${s.roll_number}` : `S.No ${idx + 1}`;
          const time = s.today_time || 'Late Check-in';
          return `  ${idx + 1}. ${roll} • ${s.name} (${time})`;
        }).join('\n')
      : '';

    let msg =
      `🏫 *${schoolName.toUpperCase()}*\n` +
      `📋 *DAILY ATTENDANCE REPORT — ${classCategory}*\n` +
      `🗓️ *Date:* ${todayDateStr}\n` +
      `👩‍🏫 *Class Teacher:* ${teacherDisplay}\n` +
      `${divider}\n` +
      `📊 *ATTENDANCE SUMMARY:*\n` +
      `👥 Total Students: *${stats.total}*\n` +
      `✅ Present Today: *${stats.attendedCount}* (${stats.percentage}%)\n` +
      `❌ Absent / Unreported: *${stats.absentCount}*\n` +
      (includeLateDetails && stats.lateCount > 0 ? `⏰ Late Arrivals: *${stats.lateCount}*\n` : '') +
      `${divider}\n` +
      `❌ *ABSENT STUDENTS TODAY (${stats.absentCount}):*\n` +
      `${absenteeLines}\n`;

    if (includeLateDetails && lateLines) {
      msg += `\n⏰ *LATE ARRIVALS (${stats.lateCount}):*\n${lateLines}\n`;
    }

    msg +=
      `${divider}\n` +
      `📢 *Notice for Parents:*\n` +
      `If your child is listed as absent above and had left from home for school, please verify immediately with the school gate desk. Regular attendance is mandatory as per KVS norms.\n`;

    if (customRemark.trim()) {
      msg += `\n📌 *Special Announcement:* ${customRemark.trim()}\n`;
    }

    msg +=
      `${divider}\n` +
      `🇮🇳 _Jai Hind • PM Shri KV NFC Vigyan Vihar_`;

    return msg;
  }, [
    schoolName,
    activeClass,
    todayDateStr,
    overrideTeacherName,
    teacherName,
    selectedPreset,
    stats,
    customRemark,
    cutoffTime,
    includeRollOnly,
    includeLateDetails,
    teacherPhone,
  ]);

  // Clean phone number for WhatsApp direct links
  const normalizeWhatsAppPhone = (phone?: string) => {
    if (!phone) return null;
    let clean = phone.replace(/[\s\-\(\)\+]/g, '');
    if (/^\d{10}$/.test(clean)) {
      clean = '91' + clean;
    }
    return clean;
  };

  // 1-Click Share to WhatsApp Group or Native App
  const handleShareToWhatsApp = useCallback(async () => {
    const text = formattedMessage;

    // 1. Try native Web Share API on mobile devices first (lets teacher pick WhatsApp directly)
    if (navigator.share && /mobile|android|iphone|ipad/i.test(navigator.userAgent)) {
      try {
        await navigator.share({
          title: `Attendance Report - ${activeClass.category} (${shortDateStr})`,
          text: text,
        });
        toast({
          title: 'Shared Successfully',
          description: `Attendance report dispatched for ${activeClass.category}.`,
        });
        return;
      } catch (err: any) {
        if (err.name !== 'AbortError') {
          console.warn('Native share fallback to direct WhatsApp URL:', err);
        } else {
          return; // User cancelled the share dialog
        }
      }
    }

    // 2. Direct WhatsApp URL
    const encoded = encodeURIComponent(text);
    const waUrl = `https://wa.me/?text=${encoded}`;
    window.open(waUrl, '_blank', 'noopener,noreferrer');

    toast({
      title: 'Opening WhatsApp...',
      description: 'Select your Class Parents Group to post the report.',
    });
  }, [formattedMessage, activeClass.category, shortDateStr, toast]);

  // 1-Click Copy to Clipboard
  const handleCopyMessage = useCallback(() => {
    navigator.clipboard.writeText(formattedMessage);
    setCopied(true);
    toast({
      title: '✅ Copied to Clipboard!',
      description: 'Ready to paste into WhatsApp, Telegram, or School SMS.',
    });
    setTimeout(() => setCopied(false), 2500);
  }, [formattedMessage, toast]);

  // Direct 1-on-1 WhatsApp Chat with an Absentee's Parent
  const handleDirectParentWhatsApp = (student: WhatsAppStudent) => {
    const phone = normalizeWhatsAppPhone(student.parent_phone);
    if (!phone) {
      toast({
        title: 'Phone Number Missing',
        description: `No parent phone number registered for ${student.name}.`,
        variant: 'destructive',
      });
      return;
    }

    const teacherDisplay = overrideTeacherName.trim() || teacherName || 'Class Teacher';
    const personalMsg =
      `🏫 *PM Shri KV NFC Vigyan Vihar*\n` +
      `📋 *Class ${activeClass.category} — Attendance Notice*\n\n` +
      `Dear Parent of *${student.name}* (Roll: ${student.roll_number || 'N/A'}),\n\n` +
      `Your ward was marked *ABSENT* today (*${todayDateStr}*) during morning gate scan.\n\n` +
      `If your child left home for school, please check immediately. If your ward is absent due to illness or personal reasons, kindly send a leave application.\n\n` +
      `Warm regards,\n` +
      `*${teacherDisplay}* (Class Teacher)\n` +
      `PM Shri KV NFC Vigyan Vihar`;

    const url = `https://wa.me/${phone}?text=${encodeURIComponent(personalMsg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  // Filtered absentees for individual tab
  const filteredIndividualAbsentees = useMemo(() => {
    if (!individualSearch.trim()) return stats.effectiveAbsentees;
    const q = individualSearch.toLowerCase().trim();
    return stats.effectiveAbsentees.filter(
      s =>
        s.name.toLowerCase().includes(q) ||
        (s.roll_number && s.roll_number.toLowerCase().includes(q)) ||
        (s.parent_phone && s.parent_phone.includes(q))
    );
  }, [stats.effectiveAbsentees, individualSearch]);

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto p-4 sm:p-6 rounded-3xl border border-emerald-500/20 bg-background/95 backdrop-blur-2xl shadow-2xl">
        <DialogHeader className="border-b border-border/40 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
                <MessageSquare className="h-6 w-6" />
              </div>
              <div>
                <DialogTitle className="text-xl font-black tracking-tight flex items-center gap-2">
                  <span>1-Click WhatsApp Class Attendance</span>
                  <Badge
                    variant="outline"
                    className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-xs font-bold"
                  >
                    100% Free
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-foreground">
                    Class {activeClass.category}
                  </span>
                  <span>•</span>
                  <span>{todayDateStr}</span>
                  <span>•</span>
                  <span>Teacher: {overrideTeacherName || teacherName}</span>
                </DialogDescription>
              </div>
            </div>

            {/* Quick Stats Chips */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant="outline"
                className="bg-blue-500/10 text-blue-600 border-blue-500/30 text-xs py-1 px-2.5 font-bold"
              >
                Total: {stats.total}
              </Badge>
              <Badge
                variant="outline"
                className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30 text-xs py-1 px-2.5 font-bold"
              >
                Present: {stats.attendedCount} ({stats.percentage}%)
              </Badge>
              <Badge
                variant="outline"
                className={`text-xs py-1 px-2.5 font-bold ${
                  stats.absentCount > 0
                    ? 'bg-rose-500/10 text-rose-600 border-rose-500/30 animate-pulse'
                    : 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
                }`}
              >
                Absent: {stats.absentCount}
              </Badge>
            </div>
          </div>

          {/* Sub Navigation */}
          <div className="flex items-center gap-2 mt-4 pt-2 border-t border-border/30">
            <Button
              type="button"
              size="sm"
              variant={activeTab === 'broadcast' ? 'default' : 'ghost'}
              onClick={() => setActiveTab('broadcast')}
              className={`rounded-xl text-xs font-bold gap-1.5 h-8 ${
                activeTab === 'broadcast'
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20'
                  : ''
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              Class Group Broadcast ({activeClass.category})
            </Button>

            <Button
              type="button"
              size="sm"
              variant={activeTab === 'individual' ? 'default' : 'ghost'}
              onClick={() => setActiveTab('individual')}
              className={`rounded-xl text-xs font-bold gap-1.5 h-8 ${
                activeTab === 'individual'
                  ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md shadow-emerald-600/20'
                  : ''
              }`}
            >
              <UserX className="h-3.5 w-3.5" />
              Direct 1-on-1 Parent WhatsApp ({stats.absentCount})
            </Button>
          </div>
        </DialogHeader>

        {/* TAB 1: CLASS GROUP BROADCAST */}
        {activeTab === 'broadcast' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-3">
            {/* Left Column: Customization Controls */}
            <div className="lg:col-span-5 space-y-4">
              <Card className="border border-border/60 bg-card/60 backdrop-blur-md rounded-2xl shadow-xs">
                <CardHeader className="p-4 pb-2">
                  <CardTitle className="text-sm font-bold flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-emerald-500" />
                    Customization & Template
                  </CardTitle>
                </CardHeader>

                <CardContent className="p-4 space-y-3.5 text-xs">
                  {/* Preset Selector */}
                  <div className="space-y-1.5">
                    <Label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
                      Message Template
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setSelectedPreset('daily_summary')}
                        className={`p-2.5 rounded-xl border text-left transition font-semibold ${
                          selectedPreset === 'daily_summary'
                            ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 shadow-xs'
                            : 'border-border/60 hover:bg-muted/50'
                        }`}
                      >
                        <div className="font-bold text-xs">Full Summary</div>
                        <div className="text-[10px] text-muted-foreground">Stats + Absentees + Late</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSelectedPreset('urgent_absentee')}
                        className={`p-2.5 rounded-xl border text-left transition font-semibold ${
                          selectedPreset === 'urgent_absentee'
                            ? 'border-rose-500 bg-rose-500/10 text-rose-700 dark:text-rose-300 shadow-xs'
                            : 'border-border/60 hover:bg-muted/50'
                        }`}
                      >
                        <div className="font-bold text-xs">Urgent Absentee</div>
                        <div className="text-[10px] text-muted-foreground">Action required alert</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSelectedPreset('full_present')}
                        className={`p-2.5 rounded-xl border text-left transition font-semibold ${
                          selectedPreset === 'full_present'
                            ? 'border-emerald-500 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 shadow-xs'
                            : 'border-border/60 hover:bg-muted/50'
                        }`}
                      >
                        <div className="font-bold text-xs">100% Present</div>
                        <div className="text-[10px] text-muted-foreground">Class celebration</div>
                      </button>

                      <button
                        type="button"
                        onClick={() => setSelectedPreset('custom')}
                        className={`p-2.5 rounded-xl border text-left transition font-semibold ${
                          selectedPreset === 'custom'
                            ? 'border-indigo-500 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 shadow-xs'
                            : 'border-border/60 hover:bg-muted/50'
                        }`}
                      >
                        <div className="font-bold text-xs">Custom Note</div>
                        <div className="text-[10px] text-muted-foreground">Add remarks/homework</div>
                      </button>
                    </div>
                  </div>

                  {/* Teacher Name & Gate Cutoff */}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="space-y-1">
                      <Label htmlFor="teacher-name-override" className="text-[11px] font-bold">
                        Class Teacher
                      </Label>
                      <Input
                        id="teacher-name-override"
                        value={overrideTeacherName}
                        onChange={e => setOverrideTeacherName(e.target.value)}
                        placeholder="Teacher Name"
                        className="h-8 text-xs rounded-xl"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="gate-cutoff" className="text-[11px] font-bold">
                        Gate Cutoff Time
                      </Label>
                      <Input
                        id="gate-cutoff"
                        value={cutoffTime}
                        onChange={e => setCutoffTime(e.target.value)}
                        placeholder="e.g. 08:15 AM"
                        className="h-8 text-xs rounded-xl"
                      />
                    </div>
                  </div>

                  {/* Toggles */}
                  <div className="space-y-2 pt-2 border-t border-border/40">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="toggle-late" className="text-xs font-semibold cursor-pointer">
                        Include Late Arrival Timestamps
                      </Label>
                      <Switch
                        id="toggle-late"
                        checked={includeLateDetails}
                        onCheckedChange={setIncludeLateDetails}
                      />
                    </div>

                    <div className="flex items-center justify-between">
                      <Label htmlFor="toggle-roll-only" className="text-xs font-semibold cursor-pointer">
                        Display Roll Numbers Only (Privacy Mode)
                      </Label>
                      <Switch
                        id="toggle-roll-only"
                        checked={includeRollOnly}
                        onCheckedChange={setIncludeRollOnly}
                      />
                    </div>
                  </div>

                  {/* Custom Note/Remark */}
                  <div className="space-y-1.5 pt-2 border-t border-border/40">
                    <Label htmlFor="custom-remark" className="text-[11px] font-bold">
                      Special Note for Parents (Optional)
                    </Label>
                    <Textarea
                      id="custom-remark"
                      value={customRemark}
                      onChange={e => setCustomRemark(e.target.value)}
                      placeholder="e.g. Tomorrow is Unit Test 2, please check school diary."
                      className="text-xs rounded-xl min-h-[60px] resize-none"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row gap-2.5">
                <Button
                  onClick={handleShareToWhatsApp}
                  className="flex-1 h-11 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white font-extrabold text-sm shadow-lg shadow-emerald-600/25 gap-2"
                >
                  <MessageSquare className="h-4 w-4" />
                  1-Click Share to WhatsApp Group
                </Button>

                <Button
                  variant="outline"
                  onClick={handleCopyMessage}
                  className="h-11 px-4 rounded-2xl border-emerald-500/30 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-500/10 font-bold text-xs gap-1.5"
                >
                  {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copied!' : 'Copy Text'}
                </Button>
              </div>
            </div>

            {/* Right Column: WhatsApp Real-Time Visual Preview */}
            <div className="lg:col-span-7">
              <Card className="border border-emerald-500/30 bg-emerald-950/10 dark:bg-emerald-950/20 rounded-3xl overflow-hidden shadow-lg">
                <CardHeader className="bg-emerald-700 text-white p-3.5 flex flex-row items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-full bg-white/20 border border-white/40 flex items-center justify-center font-black text-xs">
                      KV
                    </div>
                    <div>
                      <div className="font-bold text-xs leading-none">
                        {activeClass.category} Parents & Teachers Official
                      </div>
                      <div className="text-[10px] text-white/80 mt-0.5">
                        {stats.total} participants • Tap to post
                      </div>
                    </div>
                  </div>

                  <Badge className="bg-white/20 text-white hover:bg-white/30 text-[10px] font-bold border-none">
                    Preview Mode
                  </Badge>
                </CardHeader>

                <CardContent className="p-4 sm:p-5 bg-slate-900/40 dark:bg-black/40 min-h-[380px] max-h-[460px] overflow-y-auto">
                  {/* WhatsApp Chat Bubble */}
                  <div className="max-w-[92%] sm:max-w-[85%] bg-emerald-50 dark:bg-emerald-950/80 border border-emerald-500/30 text-foreground rounded-2xl rounded-tl-xs p-3.5 shadow-md space-y-2 text-xs">
                    <pre className="font-sans whitespace-pre-wrap leading-relaxed text-xs selection:bg-emerald-500/20">
                      {formattedMessage}
                    </pre>
                    <div className="flex items-center justify-end gap-1 text-[10px] text-muted-foreground pt-1 border-t border-border/20">
                      <span>{format(new Date(), 'hh:mm a')}</span>
                      <span className="text-emerald-500 font-bold">✓✓</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        )}

        {/* TAB 2: DIRECT 1-ON-1 PARENT CHATS */}
        {activeTab === 'individual' && (
          <div className="space-y-4 pt-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-muted/40 p-3.5 rounded-2xl border border-border/50">
              <div>
                <h4 className="text-sm font-bold text-foreground flex items-center gap-2">
                  <UserX className="h-4 w-4 text-rose-500" />
                  Individual Absentee Parent Alerts
                </h4>
                <p className="text-xs text-muted-foreground">
                  Send personalized WhatsApp messages or call parents of absent students with 1 tap.
                </p>
              </div>

              <div className="w-full sm:w-64">
                <Input
                  value={individualSearch}
                  onChange={e => setIndividualSearch(e.target.value)}
                  placeholder="Search by student name, roll, phone..."
                  className="h-8 text-xs rounded-xl"
                />
              </div>
            </div>

            {filteredIndividualAbsentees.length === 0 ? (
              <div className="text-center py-12 border border-dashed rounded-3xl border-border/60 bg-muted/20">
                <CheckCircle2 className="h-10 w-10 text-emerald-500 mx-auto mb-2" />
                <h5 className="font-bold text-sm">No Absent Students Found</h5>
                <p className="text-xs text-muted-foreground mt-0.5">
                  All students in {activeClass.category} are marked present or no absentees matched search.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[460px] overflow-y-auto pr-1">
                {filteredIndividualAbsentees.map(student => {
                  const hasPhone = Boolean(normalizeWhatsAppPhone(student.parent_phone));
                  return (
                    <Card
                      key={student.id}
                      className="border border-border/60 hover:border-emerald-500/40 transition rounded-2xl bg-card/60 backdrop-blur-md shadow-xs"
                    >
                      <CardContent className="p-3.5 flex items-center justify-between gap-3">
                        <div className="space-y-0.5 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs truncate">{student.name}</span>
                            {student.roll_number && (
                              <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-bold">
                                Roll {student.roll_number}
                              </Badge>
                            )}
                          </div>
                          <div className="text-[11px] text-muted-foreground flex items-center gap-2 truncate">
                            <span>Parent: {student.parent_name || 'Guardian'}</span>
                            {student.parent_phone && <span>• {student.parent_phone}</span>}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {hasPhone ? (
                            <>
                              <Button
                                size="sm"
                                onClick={() => handleDirectParentWhatsApp(student)}
                                className="h-8 px-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1 shadow-xs"
                                title={`WhatsApp parent of ${student.name}`}
                              >
                                <MessageSquare className="h-3.5 w-3.5" />
                                WhatsApp
                              </Button>
                              <a
                                href={`tel:${student.parent_phone}`}
                                className="inline-flex items-center justify-center h-8 w-8 rounded-xl border border-border/60 hover:bg-muted text-muted-foreground hover:text-foreground transition"
                                title={`Call ${student.parent_phone}`}
                              >
                                <Phone className="h-3.5 w-3.5" />
                              </a>
                            </>
                          ) : (
                            <Badge variant="secondary" className="text-[10px] text-muted-foreground">
                              No Phone
                            </Badge>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default TeacherClassWhatsAppNotifier;
