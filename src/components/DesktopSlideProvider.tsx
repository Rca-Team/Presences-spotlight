import React, { createContext, useContext, useEffect, useRef } from 'react';

interface DesktopSlideContextType {
  isDesktop: boolean;
}

const DesktopSlideContext = createContext<DesktopSlideContextType>({
  isDesktop: true,
});

export const useDesktopSlide = () => useContext(DesktopSlideContext);

interface DesktopSlideProviderProps {
  children: React.ReactNode;
}

/**
 * Universal Desktop Drag-to-Slide & Mouse-Wheel Sliding Engine
 * 
 * Provides buttery-smooth desktop interactions across the entire app:
 * 1. Click-and-Drag Horizontal Sliding for all tabs, carousels, filter chips, decks & strips.
 * 2. Natural Mouse-Wheel to Horizontal Scroll conversion for overflowing containers.
 * 3. Physics-based momentum inertia coasting upon mouse release.
 * 4. Automatic click-suppression when dragging (prevents unwanted clicks on buttons/tabs).
 * 5. Dynamic cursor indicators (grab / grabbing) for desktop mouse users.
 * 6. Zero interference with canvas drawing, inputs, text selection, or mobile touch.
 */
export const DesktopSlideProvider: React.FC<DesktopSlideProviderProps> = ({ children }) => {
  const activeDragRef = useRef<{
    element: HTMLElement;
    startX: number;
    startY: number;
    initialScrollLeft: number;
    isDragging: boolean;
    hasMoved: boolean;
    lastX: number;
    lastTime: number;
    velocityX: number;
    animationFrameId: number | null;
  } | null>(null);

  useEffect(() => {
    // Only engage desktop listeners on devices with fine pointer / mouse
    const isFinePointer = typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (!isFinePointer) {
      return;
    }

    // Helper: Determine if an element is horizontally scrollable
    const findHorizontallyScrollableParent = (target: HTMLElement | null): HTMLElement | null => {
      let cur = target;
      while (cur && cur !== document.body && cur !== document.documentElement) {
        // Exclude interactive controls, canvas, video, and elements explicitly marked as no-drag
        if (
          cur.tagName === 'CANVAS' ||
          cur.tagName === 'VIDEO' ||
          cur.tagName === 'INPUT' ||
          cur.tagName === 'TEXTAREA' ||
          cur.tagName === 'SELECT' ||
          cur.isContentEditable ||
          cur.getAttribute('role') === 'slider' ||
          cur.classList.contains('no-drag') ||
          cur.classList.contains('no-slide') ||
          cur.classList.contains('liquid-glass-dock') ||
          cur.classList.contains('liquid-glass-pill')
        ) {
          return null;
        }

        const overflowX = window.getComputedStyle(cur).overflowX;
        const isScrollable =
          (overflowX === 'auto' || overflowX === 'scroll' || cur.classList.contains('overflow-x-auto') || cur.dataset.slidable === 'true') &&
          cur.scrollWidth > cur.clientWidth + 2;

        if (isScrollable) {
          return cur;
        }

        cur = cur.parentElement;
      }
      return null;
    };

    // 1. Pointer Down Handler (Mousedown / Drag-start)
    const onPointerDown = (e: PointerEvent) => {
      // Only process primary left button from a mouse
      if (e.button !== 0 || (e.pointerType && e.pointerType !== 'mouse')) {
        return;
      }

      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Do not initiate drag on interactive text fields or native sliders
      if (
        target.closest('input, textarea, select, [contenteditable="true"], [role="slider"], canvas, video, .no-drag, .liquid-glass-dock, .liquid-glass-pill')
      ) {
        return;
      }

      const scrollContainer = findHorizontallyScrollableParent(target);
      if (!scrollContainer) return;

      // Cancel any ongoing momentum animation on this container
      if (activeDragRef.current?.animationFrameId) {
        cancelAnimationFrame(activeDragRef.current.animationFrameId);
      }

      activeDragRef.current = {
        element: scrollContainer,
        startX: e.clientX,
        startY: e.clientY,
        initialScrollLeft: scrollContainer.scrollLeft,
        isDragging: false,
        hasMoved: false,
        lastX: e.clientX,
        lastTime: performance.now(),
        velocityX: 0,
        animationFrameId: null,
      };

      window.addEventListener('pointermove', onPointerMove, { passive: true });
      window.addEventListener('pointerup', onPointerUp, { passive: true });
      window.addEventListener('pointercancel', onPointerUp, { passive: true });
    };

    // 2. Pointer Move Handler (Dragging)
    const onPointerMove = (e: PointerEvent) => {
      const state = activeDragRef.current;
      if (!state) return;

      const dx = e.clientX - state.startX;
      const dy = e.clientY - state.startY;

      // Initiation threshold: 8px horizontal movement with clear horizontal intent
      if (!state.isDragging) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
          // User is scrolling vertically - cancel horizontal drag tracking immediately
          activeDragRef.current = null;
          return;
        }

        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.5) {
          state.isDragging = true;
          state.hasMoved = true;
          state.element.classList.add('is-sliding');
          document.body.classList.add('is-sliding-active');
          document.body.style.userSelect = 'none';
        }
      }

      if (state.isDragging) {
        // Track instantaneous velocity for release momentum
        const now = performance.now();
        const dt = now - state.lastTime;
        if (dt > 0) {
          const instantV = (e.clientX - state.lastX) / dt;
          // Smooth low-pass filter on velocity
          state.velocityX = state.velocityX * 0.4 + instantV * 0.6;
        }
        state.lastX = e.clientX;
        state.lastTime = now;

        // Perform instant horizontal slide
        state.element.scrollLeft = state.initialScrollLeft - dx;
      }
    };

    // 3. Pointer Up / Cancel Handler (Release & Coasting Momentum)
    const onPointerUp = (e: PointerEvent) => {
      const state = activeDragRef.current;
      if (!state) return;

      const { element, hasMoved, isDragging, velocityX } = state;

      if (isDragging) {
        element.classList.remove('is-sliding');
        document.body.classList.remove('is-sliding-active');
        document.body.style.userSelect = '';

        // Apply smooth coasting momentum if released with velocity
        if (Math.abs(velocityX) > 0.08) {
          let currentVelocity = velocityX * 16;
          const decay = 0.92;
          const maxScroll = element.scrollWidth - element.clientWidth;

          const momentumStep = () => {
            if (Math.abs(currentVelocity) < 0.15) {
              state.animationFrameId = null;
              return;
            }
            const nextScroll = element.scrollLeft - currentVelocity;
            if (nextScroll <= 0) {
              element.scrollLeft = 0;
              state.animationFrameId = null;
              return;
            } else if (nextScroll >= maxScroll) {
              element.scrollLeft = maxScroll;
              state.animationFrameId = null;
              return;
            }
            element.scrollLeft = nextScroll;
            currentVelocity *= decay;
            state.animationFrameId = requestAnimationFrame(momentumStep);
          };

          state.animationFrameId = requestAnimationFrame(momentumStep);
        }
      }

      // If user performed a drag gesture, prevent the subsequent click event from triggering
      // child buttons, links, or tab switches
      if (hasMoved) {
        const preventGhostClick = (clickEvent: MouseEvent) => {
          clickEvent.stopPropagation();
          clickEvent.preventDefault();
          window.removeEventListener('click', preventGhostClick, true);
        };
        window.addEventListener('click', preventGhostClick, true);
        window.setTimeout(() => {
          window.removeEventListener('click', preventGhostClick, true);
        }, 120);
      }

      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);

      activeDragRef.current = null;
    };

    // 4. Mouse Wheel Horizontal Scroll Redirection
    // NEVER hijack normal vertical page scrolling! Only redirect wheel events if the container
    // explicitly requests horizontal mouse-wheel handling (e.g. data-wheel-horizontal="true")
    // or when the user holds Shift.
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) {
        return;
      }

      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Only engage for elements explicitly opt-in to horizontal wheel scroll
      const explicitHorizontal = target.closest('[data-wheel-horizontal="true"]') as HTMLElement | null;
      if (!explicitHorizontal) {
        return;
      }

      const canScrollRight = explicitHorizontal.scrollLeft < explicitHorizontal.scrollWidth - explicitHorizontal.clientWidth - 1;
      const canScrollLeft = explicitHorizontal.scrollLeft > 1;

      if ((e.deltaY > 0 && canScrollRight) || (e.deltaY < 0 && canScrollLeft)) {
        explicitHorizontal.scrollLeft += e.deltaY * 0.85;
        e.preventDefault();
      }
    };

    window.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      window.removeEventListener('wheel', onWheel);
    };
  }, []);

  return (
    <DesktopSlideContext.Provider value={{ isDesktop: true }}>
      {children}
    </DesktopSlideContext.Provider>
  );
};

export default DesktopSlideProvider;
