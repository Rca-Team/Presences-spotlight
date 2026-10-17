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
 * Optimized Elements-Coming Scroll Engine
 * 
 * Physics:
 * - Starts at 90% opacity (never 0%) so content is immediately readable without blank-frame pop-in.
 * - Subtle 8px vertical spring glide into place ({ stiffness: 400, damping: 30, mass: 0.8 }).
 * - Eliminates the jarring, delayed "sprinkling" pop-in during scrolling.
 * - Hardware accelerated with translateZ(0) to ensure locked 60/120fps scrolling.
 */
const revealVariants: Record<RoyalRevealEffect, Variants> = {
  'fade-up': {
    hidden: { opacity: 0.90, y: 8 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        type: 'spring',
        stiffness: 400,
        damping: 30,
        mass: 0.8,
      },
    },
  },
  'fade-in': {
    hidden: { opacity: 0.92 },
    visible: {
      opacity: 1,
      transition: {
        type: 'spring',
        stiffness: 400,
        damping: 30,
        mass: 0.8,
      },
    },
  },
  'scale-subtle': {
    hidden: { opacity: 0.90, scale: 0.99, y: 6 },
    visible: {
      opacity: 1,
      scale: 1,
      y: 0,
      transition: {
        type: 'spring',
        stiffness: 400,
        damping: 30,
        mass: 0.8,
      },
    },
  },
  'slide-left': {
    hidden: { opacity: 0.90, x: -8 },
    visible: {
      opacity: 1,
      x: 0,
      transition: {
        type: 'spring',
        stiffness: 400,
        damping: 30,
        mass: 0.8,
      },
    },
  },
  'slide-right': {
    hidden: { opacity: 0.90, x: 8 },
    visible: {
      opacity: 1,
      x: 0,
      transition: {
        type: 'spring',
        stiffness: 400,
        damping: 30,
        mass: 0.8,
      },
    },
  },
  'card-lift': {
    hidden: { opacity: 0.90, y: 8 },
    visible: {
      opacity: 1,
      y: 0,
      transition: {
        type: 'spring',
        stiffness: 400,
        damping: 30,
        mass: 0.8,
      },
    },
  },
};

export const RoyalReveal: React.FC<RoyalRevealProps> = ({
  children,
  className = '',
  effect = 'fade-up',
  delay = 0,
  threshold = 0.04,
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
        ...(staggerChildren ? { staggerChildren: 0.04, delayChildren: delay } : {}),
      },
    },
  };

  return (
    <motion.div
      variants={customVariant}
      initial="hidden"
      whileInView="visible"
      viewport={{ once, margin: '0px 0px -20px 0px', amount: threshold }}
      style={{ transform: 'translate3d(0, 0, 0)' }}
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
}> = ({ children, className = '', stagger = 0.04, delay = 0 }) => {
  const prefersReducedMotion = useReducedMotion();
  const { liteMode } = usePerformanceMode();

  if (prefersReducedMotion || liteMode) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '0px 0px -20px 0px', amount: 0.04 }}
      variants={{
        hidden: { opacity: 0.90 },
        visible: {
          opacity: 1,
          transition: {
            staggerChildren: stagger,
            delayChildren: delay,
          },
        },
      }}
      style={{ transform: 'translate3d(0, 0, 0)' }}
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
}> = ({ children, className = '', yOffset = 8 }) => {
  const prefersReducedMotion = useReducedMotion();
  const { liteMode } = usePerformanceMode();

  if (prefersReducedMotion || liteMode) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      variants={{
        hidden: { opacity: 0.90, y: Math.min(yOffset, 8) },
        visible: {
          opacity: 1,
          y: 0,
          transition: {
            type: 'spring',
            stiffness: 400,
            damping: 30,
            mass: 0.8,
          },
        },
      }}
      style={{ transform: 'translate3d(0, 0, 0)' }}
      className={className}
    >
      {children}
    </motion.div>
  );
};

export default RoyalReveal;

