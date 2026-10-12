import React, { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import gauravPhoto from '@/assets/gaurav-photo.png';
import swamiAnantVyasPhoto from '@/assets/swami-anant-vyas.png';
import jatinDhamaPhoto from '@/assets/jatin-dhama.jpg';

interface MemberAvatarProps {
  name: string;
  image?: string;
  className?: string;
  imgClassName?: string;
  fallbackClassName?: string;
  alt?: string;
}

function initials(name: string) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function hueFrom(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function getKnownPhoto(name: string): string | null {
  const n = (name || '').toLowerCase().trim();
  if (n.includes('gaurav')) return gauravPhoto;
  if (n.includes('swami') || n.includes('anant')) return swamiAnantVyasPhoto;
  if (n.includes('dhama') || n === 'jatin') return jatinDhamaPhoto;
  return null;
}

function getMemberFallbackGradient(name: string, defaultHue: number): string {
  const n = (name || '').toLowerCase();
  if (n.includes('maurya')) {
    return 'linear-gradient(135deg, #9400D3 0%, #b829ff 50%, #581c87 100%)';
  }
  if (n.includes('mayank')) {
    return 'linear-gradient(135deg, #05fac9 0%, #10b981 55%, #065f46 100%)';
  }
  if (n.includes('dhama')) {
    return 'linear-gradient(135deg, #05edf5 0%, #0284c7 100%)';
  }
  if (n.includes('anant') || n.includes('swami')) {
    return 'linear-gradient(135deg, #fc0303 0%, #be123c 100%)';
  }
  return `linear-gradient(135deg, hsl(${defaultHue} 70% 55%), hsl(${(defaultHue + 60) % 360} 70% 45%))`;
}

export function MemberAvatar({
  name,
  image,
  className,
  imgClassName,
  fallbackClassName,
  alt,
}: MemberAvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [image]);

  const resolvedImage = (!failed && image && !image.includes('.asset.json')) ? image : getKnownPhoto(name);
  const showImage = !!resolvedImage;
  const h = hueFrom(name || 'x');

  return (
    <div className={cn('relative inline-flex overflow-hidden select-none transition-transform duration-300', className)}>
      {showImage ? (
        <img
          src={resolvedImage}
          alt={alt || name}
          onError={() => setFailed(true)}
          className={cn('h-full w-full object-cover transition-transform duration-500 hover:scale-108', imgClassName)}
          loading="lazy"
        />
      ) : (
        <div
          className={cn(
            'flex h-full w-full items-center justify-center font-black tracking-wider text-white shadow-inner',
            fallbackClassName,
          )}
          style={{
            background: getMemberFallbackGradient(name || '', h),
            textShadow: '0 1px 4px rgba(0,0,0,0.35)',
          }}
          aria-label={name}
        >
          {initials(name)}
        </div>
      )}
    </div>
  );
}
