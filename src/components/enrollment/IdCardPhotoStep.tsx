import { useState, useRef, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { 
  Upload, 
  RotateCw, 
  ZoomIn, 
  ZoomOut, 
  Sparkles, 
  Sliders, 
  Check, 
  ArrowRight, 
  ArrowLeft, 
  Undo, 
  Image as ImageIcon,
  Sun,
  Contrast,
  Palette,
  ShieldCheck,
  Crop
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import type { StudentDetails } from '@/services/enrollment/types';

interface IdCardPhotoStepProps {
  student: StudentDetails;
  defaultPhoto: string;
  onConfirm: (finalPhoto: string) => void;
  onBack: () => void;
}

type AspectRatio = '3:4' | '1:1' | '2:3';

export default function IdCardPhotoStep({
  student,
  defaultPhoto,
  onConfirm,
  onBack,
}: IdCardPhotoStepProps) {
  // Source image state
  const [sourceImage, setSourceImage] = useState<string>(defaultPhoto);
  const [isUploaded, setIsUploaded] = useState(false);

  // Transform / Crop States
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('3:4');
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // Enhancement States
  const [autoEnhanced, setAutoEnhanced] = useState(false);
  const [brightness, setBrightness] = useState(0); // -50 to +50
  const [contrast, setContrast] = useState(0); // -50 to +50
  const [saturation, setSaturation] = useState(0); // -50 to +50
  const [sharpness, setSharpness] = useState(0); // 0 to 50
  const [activeTab, setActiveTab] = useState<'crop' | 'enhance'>('crop');

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
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
        setZoom(1);
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
      setBrightness(12);
      setContrast(18);
      setSaturation(14);
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
    setZoom(1);
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

    // Standard output dimension: 600px width
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
        const factor = (sharpness / 100) * 0.6;
        // Simple 3x3 sharpening convolution
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
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
            <ShieldCheck size={16} />
            <span>Step 3 of 4: Student ID Photo</span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSkip}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            Skip & Use Camera Photo
          </Button>
        </div>
        <h2 className="text-xl font-bold text-slate-100 mt-1">Student ID Card Portrait</h2>
        <p className="text-sm text-slate-400 mt-0.5">
          Crop, enhance, or upload a portrait for {student.name.split(' ')[0]}’s official school ID badge.
        </p>
      </div>

      {/* Main Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left / Center: Interactive Cropper Canvas */}
        <div className="lg:col-span-7 flex flex-col items-center">
          <div 
            className="relative w-full max-w-sm aspect-[3/4] rounded-2xl overflow-hidden border-2 border-emerald-500/40 bg-slate-950 shadow-2xl shadow-emerald-950/30 flex items-center justify-center cursor-grab active:cursor-grabbing select-none"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* Live Cropper Canvas (Offscreen render) */}
            <canvas ref={canvasRef} className="hidden" />

            {/* Display rendered live preview */}
            <img 
              src={previewDataUrl} 
              alt="Cropped Student Preview" 
              className="w-full h-full object-cover pointer-events-none"
            />

            {/* Subtle Grid Guidelines (Rule of thirds) */}
            <div className="absolute inset-0 pointer-events-none border border-emerald-400/20 grid grid-cols-3 grid-rows-3">
              <div className="border-r border-b border-white/10" />
              <div className="border-r border-b border-white/10" />
              <div className="border-b border-white/10" />
              <div className="border-r border-b border-white/10" />
              <div className="border-r border-b border-white/10" />
              <div className="border-b border-white/10" />
              <div className="border-r border-white/10" />
              <div className="border-r border-white/10" />
              <div />
            </div>

            {/* Subtle Badge */}
            <div className="absolute top-2.5 left-2.5 bg-slate-900/80 backdrop-blur-md px-2.5 py-1 rounded-full text-[10px] font-medium text-emerald-300 border border-emerald-500/30 flex items-center gap-1.5 shadow-sm">
              <Crop size={11} />
              <span>Drag to position • {aspectRatio}</span>
            </div>
          </div>

          {/* Quick Toolbar below preview */}
          <div className="flex items-center gap-2 mt-3 w-full max-w-sm justify-between">
            <div className="flex items-center gap-1.5 bg-slate-900/60 p-1 rounded-xl border border-slate-800">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                className="h-8 px-2.5 text-xs text-slate-300 hover:text-emerald-300"
                title="Rotate 90°"
              >
                <RotateCw size={14} className="mr-1" /> 90°
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="h-8 px-2.5 text-xs text-slate-400 hover:text-slate-200"
                title="Reset crop & filters"
              >
                <Undo size={14} className="mr-1" /> Reset
              </Button>
            </div>

            {/* Upload Separate ID Photo */}
            <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700/80 text-xs text-slate-200 font-medium cursor-pointer border border-slate-700 transition-colors shadow-sm">
              <Upload size={13} className="text-emerald-400" />
              <span>{isUploaded ? 'Change Photo' : 'Upload ID Photo'}</span>
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileUpload}
              />
            </label>
          </div>
        </div>

        {/* Right: Studio Controls & Live ID Card Mockup */}
        <div className="lg:col-span-5 space-y-4">
          {/* Tabs: Crop & Sizing vs AI Enhance */}
          <div className="flex bg-slate-900/80 p-1 rounded-xl border border-slate-800 text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('crop')}
              className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                activeTab === 'crop'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Crop size={14} />
              <span>Crop & Scale</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('enhance')}
              className={`flex-1 py-1.5 rounded-lg flex items-center justify-center gap-1.5 transition-all ${
                activeTab === 'enhance'
                  ? 'bg-emerald-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Sparkles size={14} />
              <span>Enhance & Lighting</span>
            </button>
          </div>

          {/* Tab 1: Crop & Scale Controls */}
          {activeTab === 'crop' && (
            <div className="enrollment-inset space-y-4 p-4 rounded-2xl bg-slate-900/40 border border-slate-800/80">
              {/* Aspect Ratio Presets */}
              <div>
                <label className="text-xs font-medium text-slate-300 block mb-1.5">
                  ID Card Aspect Ratio
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {(['3:4', '1:1', '2:3'] as AspectRatio[]).map((ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => setAspectRatio(ratio)}
                      className={`py-1.5 text-xs font-semibold rounded-lg border transition-all ${
                        aspectRatio === ratio
                          ? 'border-emerald-400 bg-emerald-950/40 text-emerald-300 shadow-sm'
                          : 'border-slate-800 bg-slate-900/60 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {ratio === '3:4' && 'Passport (3:4)'}
                      {ratio === '1:1' && 'Square (1:1)'}
                      {ratio === '2:3' && 'Badge (2:3)'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Zoom Slider */}
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs font-medium text-slate-300">
                  <span className="flex items-center gap-1">
                    <ZoomIn size={13} className="text-emerald-400" /> Zoom Level
                  </span>
                  <span className="text-emerald-300">{Math.round(zoom * 100)}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-slate-400"
                    onClick={() => setZoom((z) => Math.max(0.8, Number((z - 0.1).toFixed(1))))}
                  >
                    <ZoomOut size={14} />
                  </Button>
                  <Slider
                    value={[zoom]}
                    min={0.8}
                    max={2.8}
                    step={0.05}
                    onValueChange={([val]) => setZoom(val)}
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-slate-400"
                    onClick={() => setZoom((z) => Math.min(2.8, Number((z + 0.1).toFixed(1))))}
                  >
                    <ZoomIn size={14} />
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* Tab 2: Image Enhancement & Filters */}
          {activeTab === 'enhance' && (
            <div className="enrollment-inset space-y-3.5 p-4 rounded-2xl bg-slate-900/40 border border-slate-800/80">
              {/* 1-Click Auto Enhance Button */}
              <Button
                type="button"
                onClick={toggleAutoEnhance}
                className={`w-full text-xs font-semibold py-2 rounded-xl flex items-center justify-center gap-2 transition-all ${
                  autoEnhanced
                    ? 'bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20'
                    : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white'
                }`}
              >
                <Sparkles size={14} className={autoEnhanced ? 'animate-spin' : ''} />
                <span>{autoEnhanced ? 'Auto-Enhanced (Active)' : '✨ 1-Click Auto Enhance Portrait'}</span>
              </Button>

              {/* Brightness */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Sun size={13} className="text-amber-400" /> Brightness
                  </span>
                  <span className="text-slate-400">{brightness > 0 ? `+${brightness}` : brightness}</span>
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
                <div className="flex justify-between text-xs text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Contrast size={13} className="text-cyan-400" /> Contrast
                  </span>
                  <span className="text-slate-400">{contrast > 0 ? `+${contrast}` : contrast}</span>
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
                <div className="flex justify-between text-xs text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Palette size={13} className="text-pink-400" /> Saturation / Skin Tone
                  </span>
                  <span className="text-slate-400">{saturation > 0 ? `+${saturation}` : saturation}</span>
                </div>
                <Slider
                  value={[saturation]}
                  min={-40}
                  max={40}
                  step={1}
                  onValueChange={([val]) => setSaturation(val)}
                />
              </div>

              {/* Sharpness & Facial Contour Clarity */}
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-300">
                  <span className="flex items-center gap-1.5">
                    <Sliders size={13} className="text-emerald-400" /> Portrait Clarity
                  </span>
                  <span className="text-slate-400">{sharpness}%</span>
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
          )}

          {/* Mini Live ID Card Preview Badge */}
          <div className="p-3.5 rounded-2xl bg-gradient-to-br from-slate-900/90 to-slate-950 border border-emerald-500/30 shadow-lg relative overflow-hidden">
            <div className="flex justify-between items-center text-[10px] uppercase font-bold tracking-widest text-emerald-400 mb-2">
              <span>Official Student ID Preview</span>
              <span>Presences</span>
            </div>
            <div className="flex items-center gap-3">
              <img
                src={previewDataUrl}
                alt="Card Thumbnail"
                className="w-14 h-16 rounded-xl object-cover ring-2 ring-emerald-400/40 shadow-md"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-100 truncate">{student.name}</p>
                <p className="text-xs text-slate-300">Class {student.class} - {student.section}</p>
                <p className="text-[11px] font-mono text-emerald-300/90 mt-0.5">{student.admission_number}</p>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="pt-2 space-y-2">
            <Button
              type="button"
              onClick={handleSaveAndContinue}
              className="w-full enrollment-primary py-2.5 font-semibold text-sm shadow-xl flex items-center justify-center gap-2"
            >
              <span>Save & Continue to Review</span>
              <ArrowRight size={16} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={onBack}
              className="w-full text-xs text-slate-400 hover:text-slate-200"
            >
              <ArrowLeft size={14} className="mr-1.5" /> Back to Face Capture
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
