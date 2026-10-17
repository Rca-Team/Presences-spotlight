import React, { ReactNode, createContext, useContext } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { usePerformanceMode } from '@/hooks/usePerformanceMode';

interface PageTransitionProps {
  children: ReactNode;
  className?: string;
  delay?: number;
}

const PageTransitionContext = createContext<boolean>(false);

/**
 * Universal Smooth Transmission & Frame Customizer
 * 
 * Performance Architecture:
 * - Eliminates redundant nested frames: If a frame is already active, inner calls customize
 *   the existing frame rather than allocating a new frame DOM node.
 * - Hardware-accelerated GPU compositor transmission (translate3d, opacity)
 * - Zero layout reflow or repaint lag on mobile or desktop devices.
 */
export const pageTransmissionVariants = {
  initial: {
    opacity: 0.94,
    y: 4,
  },
  animate: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.2,
      ease: [0.25, 0.1, 0.25, 1],
    },
  },
};

export const PageTransition = ({ children, className = '', delay = 0 }: PageTransitionProps) => {
  const prefersReducedMotion = useReducedMotion();
  const { liteMode } = usePerformanceMode();
  const hasParentTransition = useContext(PageTransitionContext);

  if (hasParentTransition || prefersReducedMotion || liteMode) {
    return <div className={`relative w-full ${className}`}>{children}</div>;
  }

  return (
    <PageTransitionContext.Provider value={true}>
      <motion.div
        variants={pageTransmissionVariants}
        initial="initial"
        animate="animate"
        transition={delay ? { delay, duration: 0.2 } : undefined}
        className={`relative w-full ${className}`}
        style={{
          transform: 'translate3d(0, 0, 0)',
          backfaceVisibility: 'hidden',
        }}
      >
        {children}
      </motion.div>
    </PageTransitionContext.Provider>
  );
};

export const contentComingVariants = pageTransmissionVariants;

export const AnimatedSection = ({ children, className = '', delay = 0 }: PageTransitionProps) => {
  const prefersReducedMotion = useReducedMotion();
  const { liteMode } = usePerformanceMode();

  if (prefersReducedMotion || liteMode) {
    return <div className={className}>{children}</div>;
  }

  return (
    <motion.div
      variants={contentComingVariants}
      initial="initial"
      animate="animate"
      transition={delay ? { delay, duration: 0.2 } : undefined}
      className={className}
      style={{
        transform: 'translate3d(0, 0, 0)',
        backfaceVisibility: 'hidden',
      }}
    >
      {children}
    </motion.div>
  );
};

export default PageTransition;
