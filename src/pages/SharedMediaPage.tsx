import React, { useRef } from 'react';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AndroidShareService } from '@/services/AndroidShareService';
import {
  Share2,
  Upload,
  CreditCard,
  UserCheck,
  CalendarCheck,
  Users,
  Smartphone,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';

const SharedMediaPage: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    let loaded = 0;
    const items: Array<{ name: string; type: string; dataUrl: string }> = [];

    fileList.forEach((file) => {
      const reader = new FileReader();
      reader.onload = () => {
        items.push({
          name: file.name,
          type: file.type || 'image/jpeg',
          dataUrl: reader.result as string,
        });
        loaded++;
        if (loaded === fileList.length) {
          AndroidShareService.emit({
            files: items,
            action: 'android.intent.action.SEND',
            mimeType: fileList[0].type,
            timestamp: Date.now(),
          });
          toast.success(`Loaded ${items.length} photo(s) into Action Center!`);
        }
      };
      reader.readAsDataURL(file);
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 text-white p-4 sm:p-8 flex flex-col items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl space-y-6"
      >
        {/* Header Banner */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-semibold">
            <Smartphone className="w-3.5 h-3.5" />
            Android System Share Target Active
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight bg-gradient-to-r from-white via-cyan-100 to-blue-300 bg-clip-text text-transparent">
            Phone Photo Action Center
          </h1>
          <p className="text-sm text-slate-400 max-w-lg mx-auto">
            Share any photo directly from your Android phone's Gallery, Camera, WhatsApp, or Files to instant ID Card OCR, Student Face ID, and Attendance.
          </p>
        </div>

        {/* Upload & Test Dropzone */}
        <Card className="bg-slate-900/80 border-cyan-500/30 shadow-xl overflow-hidden backdrop-blur">
          <CardHeader className="text-center pb-2">
            <CardTitle className="text-lg font-bold text-white flex items-center justify-center gap-2">
              <Share2 className="w-5 h-5 text-cyan-400" />
              Try or Test with a Photo
            </CardTitle>
            <CardDescription className="text-slate-400 text-xs">
              Upload an ID card photo or student portrait to launch the Action Hub
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-2">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*,application/pdf"
              multiple
              onChange={handleFileUpload}
              className="hidden"
            />

            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-cyan-500/30 hover:border-cyan-400/60 rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer bg-slate-950/40 hover:bg-slate-950/70 transition-all text-center group"
            >
              <div className="p-3.5 rounded-2xl bg-cyan-500/10 text-cyan-400 group-hover:scale-110 transition-transform shadow-md">
                <Upload className="w-6 h-6" />
              </div>
              <div>
                <p className="font-semibold text-sm text-cyan-100">
                  Tap to upload or drop photo here
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Supports student ID cards, portrait photos, or class group photos
                </p>
              </div>
            </div>

            {/* Feature Pills */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-start gap-3">
                <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400">
                  <CreditCard className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-200">ID Card Auto-Extract</h4>
                  <p className="text-[11px] text-slate-400">
                    Extracts name, roll, class, parent contact & auto-crops portrait photo.
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-start gap-3">
                <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
                  <UserCheck className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-200">Student Detail Card</h4>
                  <p className="text-[11px] text-slate-400">
                    Matches face and brings up full profile with direct parent WhatsApp & Call.
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-start gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <CalendarCheck className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-200">1-Tap Attendance</h4>
                  <p className="text-[11px] text-slate-400">
                    Instantly records today's attendance directly from the shared photo.
                  </p>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800 flex items-start gap-3">
                <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
                  <Users className="w-4 h-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-200">Classroom Group Scan</h4>
                  <p className="text-[11px] text-slate-400">
                    Batch identifies every student in a classroom group picture together.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default SharedMediaPage;
