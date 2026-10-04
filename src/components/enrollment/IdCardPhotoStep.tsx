import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import { 
  Upload, 
  RotateCw, 
  ZoomIn, 
  ZoomOut, 
  Sparkles, 
  Sliders, 
  ArrowRight, 
  ArrowLeft, 
  Undo, 
  Sun, 
  Contrast, 
  Palette, 
  ShieldCheck, 
  Crop, 
  Building2, 
  Wifi, 
  CheckCircle2 
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import type { StudentDetails } from '@/services/enrollment/types';
import { resolveIdentityDisplay } from '@/utils/studentIdentityResolver';

interface IdCardPhotoStepProps {
  student: StudentDetails;
  defaultPhoto: string;
  onConfirm: (finalPhoto: string) => void;
  onBack: () => void;
}

type AspectRatio = '3:4' | '1:1' | '2:3';

const RATIO_OPTIONS: { id: AspectRatio; label: string; ratio: string }[] = [
  { id: '3:4', label: 'Passport', ratio: '3:4' },
  { id: '1:1', label: 'Square', ratio: '1:1' },
  { id: '2:3', label: 'Badge', ratio: '2:3' },
];

export default function IdCardPhotoStep({
  student,
  defaultPhoto,
  onConfirm,
  onBack,
}: IdCardPhotoStepProps) {
  // Identity Resolution for teacher vs student separation
  const identity = useMemo(() => resolveIdentityDisplay({
    student_name: student.name,
    class: student.class,
    section: student.section,
    category: student.category,
    role: (student as any).role,
  }), [student]);

  // Source image state
  const [sourceImage, setSourceImage] = useState<string>(defaultPhoto);
  const [isUploaded, setIsUploaded] = useState(false);

  // Transform / Crop States
  const [zoom, setZoom] = useState(1.15);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('3:4');
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Enhancement States
  const [autoEnhanced, setAutoEnhanced] = useState(false);
  const [brightness, setBrightness] = useState(0); // -40 to +40
  const [contrast, setContrast] = useState(0); // -40 to +40
  const [saturation, setSaturation] = useState(0); // -40 to +40
  const [sharpness, setSharpness] = useState(0); // 0 to 50
  const [activeTab, setActiveTab] = useState<'crop' | 'enhance'>('crop');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string>(defaultPhoto);
  const imgElementRef = useRef<HTMLImageElement | null>(null);

  // Load image element
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      imgElementRef.current = img;
      renderEnhancedImage();
    };
    img.src = sourceImage;
  }, [sourceImage]);

  // Handle file upload
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const dataUrl = ev.target?.result as string;
      if (dataUrl) {
        setSourceImage(dataUrl);
        setIsUploaded(true);
        // Reset crop & enhancements for new image
        setZoom(1.15);
        setRotation(0);
        setPan({ x: 0, y: 0 });
        setBrightness(0);
        setContrast(0);
        setSaturation(0);
        setSharpness(0);
        setAutoEnhanced(false);
      }
    };
    reader.readAsDataURL(file);
  };

  // Toggle 1-Click Auto Enhance
  const toggleAutoEnhance = () => {
    if (!autoEnhanced) {
      setAutoEnhanced(true);
      setBrightness(10);
      setContrast(16);
      setSaturation(12);
      setSharpness(25);
    } else {
      setAutoEnhanced(false);
      setBrightness(0);
      setContrast(0);
      setSaturation(0);
      setSharpness(0);
    }
  };

  // Reset all adjustments
  const handleReset = () => {
    setZoom(1.15);
    setRotation(0);
    setPan({ x: 0, y: 0 });
    setBrightness(0);
    setContrast(0);
    setSaturation(0);
    setSharpness(0);
    setAutoEnhanced(false);
  };

  // Re-render cropped and enhanced image to preview canvas
  const renderEnhancedImage = useCallback(() => {
    const img = imgElementRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Standard high-res output dimension: 600px width
    const targetW = 600;
    let targetH = 800; // 3:4 default
    if (aspectRatio === '1:1') targetH = 600;
    else if (aspectRatio === '2:3') targetH = 900;

    canvas.width = targetW;
    canvas.height = targetH;

    ctx.clearRect(0, 0, targetW, targetH);

    // Apply CSS filters for Brightness, Contrast, Saturation
    const bVal = 100 + brightness;
    const cVal = 100 + contrast;
    const sVal = 100 + saturation;
    ctx.filter = `brightness(${bVal}%) contrast(${cVal}%) saturate(${sVal}%)`;

    ctx.save();
    // Move origin to center of canvas
    ctx.translate(targetW / 2 + pan.x, targetH / 2 + pan.y);
    ctx.rotate((rotation * Math.PI) / 180);
    ctx.scale(zoom, zoom);

    // Calculate aspect fill
    const imgAspect = img.width / img.height;
    const canvasAspect = targetW / targetH;
    let drawW = targetW;
    let drawH = targetH;

    if (imgAspect > canvasAspect) {
      drawH = targetH;
      drawW = targetH * imgAspect;
    } else {
      drawW = targetW;
      drawH = targetW / imgAspect;
    }

    ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
    ctx.restore();

    // Optional unsharp mask / sharpness convolution pass if sharpness > 0
    if (sharpness > 0) {
      try {
        const imgData = ctx.getImageData(0, 0, targetW, targetH);
        const d = imgData.data;
        const factor = (sharpness / 100) * 0.55;
        const copy = new Uint8ClampedArray(d);
        const stride = targetW * 4;

        for (let y = 1; y < targetH - 1; y++) {
          for (let x = 1; x < targetW - 1; x++) {
            const idx = y * stride + x * 4;
            for (let c = 0; c < 3; c++) {
              const current = copy[idx + c];
              const up = copy[idx - stride + c];
              const down = copy[idx + stride + c];
              const left = copy[idx - 4 + c];
              const right = copy[idx + 4 + c];
              const lap = current * 5 - (up + down + left + right);
              d[idx + c] = Math.min(255, Math.max(0, current + (lap - current) * factor));
            }
          }
        }
        ctx.putImageData(imgData, 0, 0);
      } catch {
        // Fallback gracefully if CORS prevents imageData
      }
    }

    const exportedUrl = canvas.toDataURL('image/jpeg', 0.92);
    setPreviewDataUrl(exportedUrl);
  }, [aspectRatio, brightness, contrast, pan.x, pan.y, rotation, saturation, sharpness, zoom]);

  useEffect(() => {
    renderEnhancedImage();
  }, [renderEnhancedImage]);

  // Drag & Pan handlers
  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPan({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  // Touch support for mobile/tablets
  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsDragging(true);
      setDragStart({ x: e.touches[0].clientX - pan.x, y: e.touches[0].clientY - pan.y });
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return;
    setPan({
      x: e.touches[0].clientX - dragStart.x,
      y: e.touches[0].clientY - dragStart.y,
    });
  };

  const handleTouchEnd = () => setIsDragging(false);

  const handleSkip = () => {
    onConfirm(defaultPhoto);
  };

  const handleSaveAndContinue = () => {
    onConfirm(previewDataUrl || defaultPhoto);
  };

  return (
    <div className="space-y-6 select-none">
      {/* Offscreen High-Res Canvas */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-white/10">
        <div>
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider">
            <ShieldCheck size={16} />
            <span>Step 3 of 4: ID Card Photo Calibration</span>
          </div>
          <h2 className="text-xl sm:text-2xl font-black text-white mt-1">
            {identity.isTeacher ? 'Faculty / Staff ID Badge Portrait' : 'Student ID Card Portrait'}
          </h2>
          <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
            Crop, frame, and enhance {student.name}’s official school badge photo.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleSkip}
          className="text-xs font-semibold h-8 rounded-xl border-white/15 bg-white/5 hover:bg-white/10 text-slate-300 self-start sm:self-auto shrink-0"
        >
          Skip & Use Raw Capture
        </Button>
      </div>

      {/* Main Studio Grid: Left Cropper Viewport, Right Controls & Live Badge */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
        
        {/* Left / Center: Interactive Cropper Viewport */}
        <div className="md:col-span-6 lg:col-span-7 flex flex-col items-center">
          <div 
            className="relative w-full max-w-sm sm:max-w-md aspect-[3/4] rounded-3xl overflow-hidden border-2 border-emerald-500/40 bg-slate-950 shadow-2xl shadow-emerald-950/40 flex items-center justify-center cursor-grab active:cursor-grabbing touch-none select-none transition-shadow hover:shadow-emerald-500/15"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* Display rendered live preview */}
            <img 
              src={previewDataUrl} 
              alt="Cropped Preview" 
              className="w-full h-full object-cover pointer-events-none"
            />

            {/* Subtle Rule of Thirds Grid Guidelines */}
            <div className="absolute inset-0 pointer-events-none border border-emerald-400/20 grid grid-cols-3 grid-rows-3">
              <div className="border-r border-b border-white/10" />
              <div className="border-r border-b border-white/10" />
              <div className="border-b border-white/10" />
              <div className="border-r border-b border-white/10" />
              <div className="border-r border-b border-white/10" />
              <div className="border-b border-white/10" />
              <div className="border-r border-b border-white/10" />
              <div className="border-r border-b border-white/10" />
              <div />
            </div>

            {/* Viewfinder Corner Accents */}
            <div className="absolute top-3 left-3 w-4 h-4 border-t-2 border-l-2 border-emerald-400 rounded-tl pointer-events-none" />
            <div className="absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2 border-emerald-400 rounded-tr pointer-events-none" />
            <div className="absolute bottom-3 left-3 w-4 h-4 border-b-2 border-l-2 border-emerald-400 rounded-bl pointer-events-none" />
            <div className="absolute bottom-3 right-3 w-4 h-4 border-b-2 border-r-2 border-emerald-400 rounded-br pointer-events-none" />

            {/* Floating Top Badge */}
            <div className="absolute top-3.5 left-3.5 bg-slate-950/85 backdrop-blur-md px-3 py-1 rounded-full text-[11px] font-semibold text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5 shadow-lg">
              <Crop size={12} className="text-emerald-400" />
              <span>Drag to position • {aspectRatio}</span>
            </div>

            {/* Zoom Percentage Chip */}
            <div className="absolute bottom-3.5 right-3.5 bg-slate-950/85 backdrop-blur-md px-2.5 py-1 rounded-full text-[10px] font-mono font-bold text-slate-300 border border-white/15">
              {Math.round(zoom * 100)}%
            </div>
          </div>

          {/* Quick Action Toolbar Below Viewport */}
          <div className="flex items-center gap-2 mt-3.5 w-full max-w-sm sm:max-w-md justify-between">
            <div className="flex items-center gap-1.5 bg-slate-900/80 backdrop-blur-md p-1 rounded-2xl border border-white/10 shadow-md">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="h-8 px-3 text-xs font-semibold text-slate-200 hover:text-emerald-300 rounded-xl hover:bg-white/5 active:scale-95"
                title="Rotate 90 degrees"
              >
                <RotateCw size={13} className="mr-1.5 text-emerald-400" /> 90°
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="h-8 px-3 text-xs font-semibold text-slate-300 hover:text-slate-100 rounded-xl hover:bg-white/5 active:scale-95"
                title="Reset adjustments"
              >
                <Undo size={13} className="mr-1.5 text-slate-400" /> Reset
              </Button>
            </div>

            {/* Upload Custom ID Photo */}
            <label className="flex items-center gap-1.5 px-3.5 py-2 rounded-2xl bg-gradient-to-r from-slate-800 to-slate-900 hover:from-slate-700 hover:to-slate-800 text-xs text-white font-bold cursor-pointer border border-white/15 transition-all shadow-md active:scale-95">
              <Upload size={13} className="text-emerald-400" />
              <span>{isUploaded ? 'Change Photo' : 'Upload Photo'}</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileUpload}
              />
            </label>
          </div>
        </div>

        {/* Right: Studio Controls & Live Official ID Card Mockup */}
        <div className="md:col-span-6 lg:col-span-5 space-y-4">
          
          {/* Segmented Tab Navigation */}
          <div className="flex bg-slate-900/90 backdrop-blur-md p-1.5 rounded-2xl border border-white/10 text-xs font-bold shadow-inner">
            <button
              type="button"
              onClick={() => setActiveTab('crop')}
              className={cn(
                'flex-1 py-2 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer',
                activeTab === 'crop'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/25 font-extrabold'
                  : 'text-slate-400 hover:text-slate-200'
              )}
            >
              <Crop size={14} />
              <span>Crop & Sizing</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('enhance')}
              className={cn(
                'flex-1 py-2 rounded-xl flex items-center justify-center gap-1.5 transition-all cursor-pointer',
                activeTab === 'enhance'
                  ? 'bg-emerald-500 text-slate-950 shadow-md shadow-emerald-500/25 font-extrabold'
                  : 'text-slate-400 hover:text-slate-200'
              )}
            >
              <Sparkles size={14} />
              <span>Enhance & Lighting</span>
            </button>
          </div>

          {/* Tab 1: Crop & Scale Controls */}
          {activeTab === 'crop' && (
            <motion.div 
              initial={{ opacity: 0, y: 6 }} 
              animate={{ opacity: 1, y: 0 }} 
              className="space-y-4 p-4 rounded-2xl bg-slate-900/70 border border-white/10 shadow-xl"
            >
              {/* Aspect Ratio Presets (Clean 2-line layout to prevent horizontal overlap) */}
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-slate-300 block mb-2">
                  ID Card Aspect Ratio
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {RATIO_OPTIONS.map((item) => {
                    const isSelected = aspectRatio === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setAspectRatio(item.id)}
                        className={cn(
                          'py-2 px-1.5 rounded-xl border transition-all flex flex-col items-center justify-center min-w-0 select-none touch-manipulation cursor-pointer',
                          isSelected
                            ? 'border-emerald-400 bg-emerald-500/20 text-emerald-300 shadow-md shadow-emerald-500/10 ring-1 ring-emerald-400/30'
                            : 'border-white/10 bg-white/5 text-slate-400 hover:text-slate-200 hover:bg-white/10'
                        )}
                      >
                        <span className="text-xs font-bold leading-tight truncate w-full text-center">
                          {item.label}
                        </span>
                        <span className="text-[10px] font-mono opacity-70 mt-0.5">
                          ({item.ratio})
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Zoom Slider with Precise Controls */}
              <div className="space-y-2 pt-1">
                <div className="flex justify-between text-xs font-bold text-slate-200">
                  <span className="flex items-center gap-1.5">
                    <ZoomIn size={14} className="text-emerald-400" /> Zoom & Framing
                  </span>
                  <span className="text-emerald-400 font-mono">{Math.round(zoom * 100)}%</span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 shrink-0 active:scale-95"
                    onClick={() => setZoom((z) => Math.max(0.7, Number((z - 0.1).toFixed(2))))}
                  >
                    <ZoomOut size={14} />
                  </Button>
                  <Slider
                    value={[zoom]}
                    min={0.7}
                    max={2.8}
                    step={0.05}
                    onValueChange={([val]) => setZoom(val)}
                    className="flex-1 py-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 shrink-0 active:scale-95"
                    onClick={() => setZoom((z) => Math.min(2.8, Number((z + 0.1).toFixed(2))))}
                  >
                    <ZoomIn size={14} />
                  </Button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Tab 2: Image Enhancement & Filters */}
          {activeTab === 'enhance' && (
            <motion.div 
              initial={{ opacity: 0, y: 6 }} 
              animate={{ opacity: 1, y: 0 }} 
              className="space-y-3.5 p-4 rounded-2xl bg-slate-900/70 border border-white/10 shadow-xl"
            >
              {/* 1-Click Auto Enhance Button */}
              <Button
                type="button"
                onClick={toggleAutoEnhance}
                className={cn(
                  'w-full text-xs font-extrabold py-2.5 h-auto rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95',
                  autoEnhanced
                    ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/30'
                    : 'bg-gradient-to-r from-emerald-600 via-teal-600 to-cyan-600 hover:from-emerald-500 hover:to-cyan-500 text-white shadow-md'
                )}
              >
                <Sparkles size={14} className={autoEnhanced ? 'animate-spin' : ''} />
                <span>{autoEnhanced ? '✨ Auto-Enhanced Active' : '✨ 1-Click AI Auto-Enhance'}</span>
              </Button>

              <div className="grid grid-cols-1 gap-2.5 pt-1">
                {/* Brightness */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-medium text-slate-300">
                    <span className="flex items-center gap-1.5">
                      <Sun size={13} className="text-amber-400" /> Brightness
                    </span>
                    <span className="text-slate-400 font-mono text-[11px]">{brightness > 0 ? `+${brightness}` : brightness}</span>
                  </div>
                  <Slider
                    value={[brightness]}
                    min={-40}
                    max={40}
                    step={1}
                    onValueChange={([val]) => setBrightness(val)}
                  />
                </div>

                {/* Contrast */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-medium text-slate-300">
                    <span className="flex items-center gap-1.5">
                      <Contrast size={13} className="text-cyan-400" /> Contrast
                    </span>
                    <span className="text-slate-400 font-mono text-[11px]">{contrast > 0 ? `+${contrast}` : contrast}</span>
                  </div>
                  <Slider
                    value={[contrast]}
                    min={-40}
                    max={40}
                    step={1}
                    onValueChange={([val]) => setContrast(val)}
                  />
                </div>

                {/* Saturation */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-medium text-slate-300">
                    <span className="flex items-center gap-1.5">
                      <Palette size={13} className="text-pink-400" /> Saturation
                    </span>
                    <span className="text-slate-400 font-mono text-[11px]">{saturation > 0 ? `+${saturation}` : saturation}</span>
                  </div>
                  <Slider
                    value={[saturation]}
                    min={-40}
                    max={40}
                    step={1}
                    onValueChange={([val]) => setSaturation(val)}
                  />
                </div>

                {/* Sharpness & Clarity */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs font-medium text-slate-300">
                    <span className="flex items-center gap-1.5">
                      <Sliders size={13} className="text-emerald-400" /> Clarity
                    </span>
                    <span className="text-emerald-400 font-mono text-[11px]">{sharpness}%</span>
                  </div>
                  <Slider
                    value={[sharpness]}
                    min={0}
                    max={50}
                    step={2}
                    onValueChange={([val]) => setSharpness(val)}
                  />
                </div>
              </div>
            </motion.div>
          )}

          {/* Authentic Official School ID Badge Card Preview */}
          <div className="p-3.5 sm:p-4 rounded-3xl bg-gradient-to-br from-[#0c1f1c] via-[#09151e] to-[#040a10] border-2 border-emerald-500/40 shadow-2xl relative overflow-hidden">
            {/* Holographic Header Bar */}
            <div className="flex justify-between items-center pb-2.5 border-b border-white/10 mb-2.5">
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-lg bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center text-emerald-300 shadow-sm shrink-0">
                  <Building2 size={13} />
                </div>
                <div className="min-w-0">
                  <span className="text-[10px] font-black uppercase tracking-wider text-white block leading-none truncate">
                    PM Shri KV · Vigyan Vihar
                  </span>
                  <span className="text-[8px] font-mono font-semibold tracking-widest text-emerald-400 uppercase">
                    Official Identity Pass
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 text-[9px] font-mono font-bold shrink-0">
                <Wifi size={10} className="rotate-90 text-emerald-400" />
                <span>RFID</span>
              </div>
            </div>

            {/* Badge Body: Cropped Photo + Person Info */}
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                <img
                  src={previewDataUrl}
                  alt={student.name}
                  className="w-16 h-20 sm:w-18 sm:h-22 rounded-2xl object-cover ring-2 ring-emerald-400/60 shadow-lg bg-slate-950"
                />
                <div className="absolute -bottom-1 -right-1 bg-emerald-500 text-slate-950 rounded-full p-0.5 shadow-md">
                  <CheckCircle2 size={12} className="stroke-[3]" />
                </div>
              </div>

              <div className="min-w-0 flex-1 space-y-1">
                <h4 className="text-sm sm:text-base font-extrabold text-white leading-snug break-words">
                  {student.name}
                </h4>

                {/* Dynamic Role / Class Badge */}
                <div className="flex flex-wrap items-center gap-1 pt-0.5">
                  {identity.isTeacher ? (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-purple-500/20 text-purple-300 border border-purple-400/40">
                      ★ {identity.roleLabel}
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-400/40">
                      Class {student.class} {student.section && `· ${student.section}`}
                    </span>
                  )}
                </div>

                <p className="text-[11px] font-mono text-slate-300 pt-0.5">
                  <span className="text-slate-500">{identity.admissionOrEmpLabel}: </span>
                  <strong className="text-emerald-400 font-bold">{student.admission_number || 'N/A'}</strong>
                </p>
              </div>
            </div>
          </div>

          {/* Action Buttons Section */}
          <div className="pt-2 space-y-2">
            <button
              type="button"
              onClick={handleSaveAndContinue}
              className="w-full h-11 sm:h-12 rounded-2xl bg-gradient-to-r from-emerald-400 via-teal-400 to-emerald-500 hover:from-emerald-300 hover:to-teal-300 text-slate-950 font-black text-sm sm:text-base shadow-xl shadow-emerald-500/25 flex items-center justify-center gap-2 border-0 transition-all cursor-pointer active:scale-[0.98] select-none"
            >
              <span>Save & Continue to Review</span>
              <ArrowRight size={18} className="stroke-[3]" />
            </button>

            <button
              type="button"
              onClick={onBack}
              className="w-full h-9 rounded-xl text-xs font-semibold text-slate-400 hover:text-white hover:bg-white/5 flex items-center justify-center gap-2 transition-all cursor-pointer select-none"
            >
              <ArrowLeft size={14} /> 
              <span>Back to Face Capture</span>
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
