import React, { useState, useId } from 'react';
import { cn } from '@/lib/utils';
import { resolveStudentPhotoUrlSync } from '@/utils/studentPhotoResolver';

export type StudentAvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
export type StudentAvatarShape = 'circle' | 'rounded-lg' | 'rounded-xl' | 'rounded-2xl' | 'square';

export interface StudentAvatarProps {
  name?: string | null;
  photoUrl?: string | null;
  avatarUrl?: string | null;
  src?: string | null;
  admissionNumber?: string | null;
  studentId?: string | null;
  size?: StudentAvatarSize | number;
  shape?: StudentAvatarShape;
  className?: string;
  imageClassName?: string;
  fallbackClassName?: string;
  showFallbackInitials?: boolean;
  isEnrolled?: boolean;
  statusBadge?: 'present' | 'absent' | 'late' | 'enrolled' | 'pending';
  onClick?: (e: React.MouseEvent) => void;
  alt?: string;
}

const SIZE_CLASSES: Record<StudentAvatarSize, { container: string; text: string; badge: string }> = {
  xs: { container: 'h-6 w-6', text: 'text-[9px] font-bold', badge: 'h-1.5 w-1.5 ring-1' },
  sm: { container: 'h-8 w-8', text: 'text-xs font-bold', badge: 'h-2 w-2 ring-1' },
  md: { container: 'h-10 w-10', text: 'text-xs sm:text-sm font-bold', badge: 'h-2.5 w-2.5 ring-1.5' },
  lg: { container: 'h-12 w-12', text: 'text-sm sm:text-base font-bold', badge: 'h-3 w-3 ring-2' },
  xl: { container: 'h-14 w-14', text: 'text-base sm:text-lg font-bold', badge: 'h-3.5 w-3.5 ring-2' },
  '2xl': { container: 'h-20 w-20', text: 'text-xl sm:text-2xl font-black', badge: 'h-4 w-4 ring-2' },
};

const SHAPE_CLASSES: Record<StudentAvatarShape, string> = {
  circle: 'rounded-full',
  'rounded-lg': 'rounded-lg',
  'rounded-xl': 'rounded-xl',
  'rounded-2xl': 'rounded-2xl',
  square: 'rounded-none',
};

const PALETTES = [
  { bg: 'bg-gradient-to-br from-indigo-600 via-indigo-700 to-blue-900', text: 'text-indigo-100', border: 'border-indigo-500/40' },
  { bg: 'bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-900', text: 'text-emerald-100', border: 'border-emerald-500/40' },
  { bg: 'bg-gradient-to-br from-violet-600 via-purple-700 to-fuchsia-900', text: 'text-violet-100', border: 'border-violet-500/40' },
  { bg: 'bg-gradient-to-br from-cyan-600 via-sky-700 to-blue-900', text: 'text-cyan-100', border: 'border-cyan-500/40' },
  { bg: 'bg-gradient-to-br from-rose-600 via-pink-700 to-red-900', text: 'text-rose-100', border: 'border-rose-500/40' },
  { bg: 'bg-gradient-to-br from-amber-600 via-orange-700 to-amber-900', text: 'text-amber-100', border: 'border-amber-500/40' },
  { bg: 'bg-gradient-to-br from-teal-600 via-emerald-700 to-cyan-900', text: 'text-teal-100', border: 'border-teal-500/40' },
  { bg: 'bg-gradient-to-br from-blue-600 via-cyan-700 to-indigo-900', text: 'text-blue-100', border: 'border-blue-500/40' },
];

export function getStudentInitials(name?: string | null): string {
  if (!name) return 'ST';
  const clean = name.trim().replace(/[^a-zA-Z\s]/g, '');
  if (!clean) return 'ST';
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return clean.slice(0, 2).toUpperCase();
}

function getDeterministicPalette(key: string) {
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % PALETTES.length;
  return PALETTES[index];
}

export const StudentAvatar: React.FC<StudentAvatarProps> = ({
  name,
  photoUrl,
  avatarUrl,
  src,
  admissionNumber,
  studentId,
  size = 'md',
  shape = 'rounded-xl',
  className,
  imageClassName,
  fallbackClassName,
  showFallbackInitials = true,
  isEnrolled,
  statusBadge,
  onClick,
  alt,
}) => {
  const rawCandidate = photoUrl || avatarUrl || src;
  const resolvedUrl = React.useMemo(() => {
    return resolveStudentPhotoUrlSync(rawCandidate, { width: 160, quality: 80 });
  }, [rawCandidate]);

  const [hasError, setHasError] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  // Reset state if URL changes
  React.useEffect(() => {
    setHasError(false);
    setIsLoaded(false);
  }, [resolvedUrl]);

  const initials = React.useMemo(() => getStudentInitials(name), [name]);
  const paletteKey = (name || admissionNumber || studentId || 'student').trim().toLowerCase();
  const palette = React.useMemo(() => getDeterministicPalette(paletteKey), [paletteKey]);

  const sizeConfig = typeof size === 'string' ? SIZE_CLASSES[size] || SIZE_CLASSES.md : null;
  const customStyle: React.CSSProperties = typeof size === 'number' ? { width: size, height: size } : {};

  const shapeClass = SHAPE_CLASSES[shape] || SHAPE_CLASSES['rounded-xl'];
  const shouldRenderImage = Boolean(resolvedUrl && !hasError);

  const containerClasses = cn(
    'relative shrink-0 flex items-center justify-center overflow-hidden select-none border shadow-sm transition-all',
    sizeConfig?.container,
    shapeClass,
    shouldRenderImage && isLoaded ? 'bg-slate-900 border-slate-700/60' : `${palette.bg} ${palette.border}`,
    onClick && 'cursor-pointer hover:ring-2 hover:ring-primary/60 hover:opacity-95',
    className
  );

  return (
    <div className={containerClasses} style={customStyle} onClick={onClick}>
      {/* Fallback Initials (always present underneath to prevent any blank flashes or empty squares) */}
      <div
        className={cn(
          'absolute inset-0 flex items-center justify-center tracking-wider font-mono uppercase transition-opacity duration-200',
          palette.text,
          sizeConfig?.text,
          fallbackClassName,
          shouldRenderImage && isLoaded ? 'opacity-0 pointer-events-none' : 'opacity-100'
        )}
      >
        {showFallbackInitials ? initials : null}
      </div>

      {/* Actual Student Photo with crisp object-cover centering */}
      {shouldRenderImage && (
        <img
          src={resolvedUrl}
          alt={alt || name || 'Student'}
          className={cn(
            'h-full w-full object-cover object-top transition-opacity duration-300',
            isLoaded ? 'opacity-100' : 'opacity-0',
            imageClassName
          )}
          loading="lazy"
          decoding="async"
          onLoad={() => setIsLoaded(true)}
          onError={() => {
            setHasError(true);
            setIsLoaded(false);
          }}
        />
      )}

      {/* Optional Status Indicator Badge */}
      {statusBadge && sizeConfig && (
        <span
          className={cn(
            'absolute bottom-0 right-0 rounded-full ring-background z-10',
            sizeConfig.badge,
            statusBadge === 'present' || statusBadge === 'enrolled'
              ? 'bg-emerald-500'
              : statusBadge === 'late'
              ? 'bg-amber-500'
              : 'bg-rose-500'
          )}
        />
      )}
    </div>
  );
};

export default StudentAvatar;
