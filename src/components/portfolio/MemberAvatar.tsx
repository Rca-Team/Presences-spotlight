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

function getMemberFallbackBg(name: string, defaultHue: number): string {
  const n = (name || '').toLowerCase();
  if (n.includes('maurya')) {
    return '#6b21a8'; // Clean matte purple (#9400D3 family)
  }
  if (n.includes('mayank')) {
    return '#0f766e'; // Clean matte teal-mint (#05fac9 family)
  }
  if (n.includes('dhama')) {
    return '#0e7490'; // Clean matte cyan (#05edf5 family)
  }
  if (n.includes('anant') || n.includes('swami')) {
    return '#991b1b'; // Clean matte crimson (#fc0303 family)
  }
  return `hsl(${defaultHue} 55% 42%)`;
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

  const isDeadUrl = !image || image.includes('supabase.co') || image.includes('.asset.json') || image.startsWith('/__l5e/') || image.includes('cvdcbcsonlianbfeessy') || image.includes('eiahucigcvsnuvviajqt');
  const resolvedImage = (!failed && !isDeadUrl) ? image : getKnownPhoto(name);
  const showImage = !!resolvedImage;
  const h = hueFrom(name || 'x');

  return (
    <div className={cn('relative inline-flex overflow-hidden select-none transition-transform duration-300', className)}>
      {showImage ? (
        <img
          src={resolvedImage}
          alt={alt || name}
          onError={() => {
            setFailed(true);
          }}
          className={cn('h-full w-full object-cover transition-transform duration-500 hover:scale-108', imgClassName)}
          loading="lazy"
        />
      ) : (
        <div
          className={cn(
            'flex h-full w-full items-center justify-center font-bold tracking-wider text-white',
            fallbackClassName,
          )}
          style={{
            backgroundColor: getMemberFallbackBg(name || '', h),
          }}
          aria-label={name}
        >
          {initials(name)}
        </div>
      )}
    </div>
  );
}
