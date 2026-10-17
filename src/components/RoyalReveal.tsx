import React from 'react';
import { motion, useReducedMotion, Variants } from 'framer-motion';
import { cn } from '@/lib/utils';
import { usePerformanceMode } from '@/hooks/usePerformanceMode';

export type RoyalRevealEffect = 'fade-up' | 'fade-in' | 'scale-subtle' | 'slide-left' | 'slide-right' | 'card-lift';

interface RoyalRevealProps {
  children: React.ReactNode;
  className?: string;
  effect?: RoyalRevealEffect;
  delay?: number;
  duration?: number;
  threshold?: number;
  staggerChildren?: number;
  once?: boolean;
}

/**
 * Ultra-Smooth "Elements-Coming" Scroll Reveal Engine
 * 
 * Performance & Aesthetics:
 * - Fluid, cinematic entrance animations starting from clean opacity 0 and gentle offset.
 * - Apple/Linear-grade cubic-bezier ease-out curve [0.16, 1, 0.3, 1] — eliminates all vibrating springs, jitter, and abrupt twitches.
 * - Positive bottom viewport margin (60px) triggers elements early as user scrolls, guaranteeing zero blank-frame delay or popping.
 * - Hardware accelerated with 3D compositing (translate3d) and backface-visibility protection.
 */
const revealVariants: Record<RoyalRevealEffect, Variants> = {
  'fade-up': {
    hidden: { opacity: 0, y: 22 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        duration: 0.55,
        ease: [0.16, 1, 0.3, 1],
      },
    },
  },
  'fade-in': {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        duration: 0.45,
        ease: [0.16, 1, 0.3, 1],
      },
    },
  },
  'scale-subtle': {
    hidden: { opacity: 0, scale: 0.97, y: 14 },
    visible: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: {
        duration: 0.55,
        ease: [0.16, 1, 0.3, 1],
      },
    },
  },
  'slide-left': {
    hidden: { opacity: 0, x: -22 },
    visible: {
      opacity: 1,
      x: 0,
      transition: {
        duration: 0.55,
        ease: [0.16, 1, 0.3, 1],
      },
    },
  },
  'slide-right': {
    hidden: { opacity: 0, x: 22 },
    visible: {
      opacity: 1,
      x: 0,
      transition: {
        duration: 0.55,
        ease: [0.16, 1, 0.3, 1],
      },
    },
  },
  'card-lift': {
    hidden: { opacity: 0, y: 26, scale: 0.985 },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1,
      transition: {
        duration: 0.6,
        ease: [0.16, 1, 0.3, 1],
      },
    },
  },
};

export const RoyalReveal: React.FC<RoyalRevealProps> = ({
  children,
  className = '',
  effect = 'fade-up',
  delay = 0,
  duration,
  threshold = 0.05,
  staggerChildren,
  once = true,
}) => {
  const prefersReducedMotion = useReducedMotion();
  const { liteMode } = usePerformanceMode();

  if (prefersReducedMotion || liteMode) {
    return <div className={className}>{children}</div>;
  }

  const baseVariant = revealVariants[effect] || revealVariants['fade-up'];
  const customVariant: Variants = {
    hidden: baseVariant.hidden,
    visible: {
      ...baseVariant.visible,
      transition: {
        ...(typeof baseVariant.visible === 'object' && 'transition' in baseVariant.visible
          ? (baseVariant.visible.transition as object)
          : {}),
        delay: delay || undefined,
        ...(duration ? { duration } : {}),
        ...(staggerChildren ? { staggerChildren: 0.06, delayChildren: delay } : {}),
      },
    },
  };

  return (
    <motion.div
      variants={customVariant}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, margin: '0px 0px 60px 0px', amount: threshold }}
      style={{ transform: 'translate3d(0, 0, 0)', backfaceVisibility: 'hidden' }}
      className={cn('royal-reveal-item', className)}
    >
      {children}
    </motion.div>
  );
};

export const RoyalStaggerGroup: React.FC<{
  children: React.ReactNode;
  className?: string;
  stagger?: number;
  delay?: number;
}> = ({ children, className = '', stagger = 0.06, delay = 0 }) => {
  const prefersReducedMotion = useReducedMotion();
  const { liteMode } = usePerformanceMode();

  if (prefersReducedMotion || liteMode) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '0px 0px 60px 0px', amount: 0.05 }}
      variants={{
        hidden: { opacity: 0 },
        visible: {
          opacity: 1,
          transition: {
            staggerChildren: stagger,
            delayChildren: delay,
          },
        },
      }}
      style={{ transform: 'translate3d(0, 0, 0)', backfaceVisibility: 'hidden' }}
      className={className}
    >
      {children}
    </motion.div>
  );
};

export const RoyalStaggerItem: React.FC<{
  children: React.ReactNode;
  className?: string;
  yOffset?: number;
}> = ({ children, className = '', yOffset = 18 }) => {
  const prefersReducedMotion = useReducedMotion();
  const { liteMode } = usePerformanceMode();

  if (prefersReducedMotion || liteMode) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0, y: yOffset },
        visible: {
          opacity: 1,
          y: 0,
          transition: {
            duration: 0.5,
            ease: [0.16, 1, 0.3, 1],
          },
        },
      }}
      style={{ transform: 'translate3d(0, 0, 0)', backfaceVisibility: 'hidden' }}
      className={className}
    >
      {children}
    </motion.div>
  );
};

export default RoyalReveal;
