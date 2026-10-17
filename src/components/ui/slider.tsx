import * as React from "react"
import * as SliderPrimitive from "@radix-ui/react-slider"

import { cn } from "@/lib/utils"

/**
 * Apple iOS 26 Liquid Glass Slider
 * Visual Match: Image 1 & 2 reference design
 * - Volumetric translucent frosted track with inner refraction shadow
 * - Glowing liquid progress range with blue-to-cyan gradient
 * - Iconic floating liquid glass pill thumb with center specular refraction
 */
const Slider = React.forwardRef<
  React.ElementRef<typeof SliderPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SliderPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SliderPrimitive.Root
    ref={ref}
    className={cn(
      "relative flex w-full touch-none select-none items-center cursor-pointer py-2",
      className
    )}
    {...props}
  >
    {/* Translucent Liquid Glass Track with Meniscus Glow */}
    <SliderPrimitive.Track className="relative h-3 w-full grow overflow-hidden rounded-full bg-white/35 dark:bg-white/12 backdrop-blur-2xl border border-white/50 dark:border-white/20 shadow-[inset_0_1.5px_2px_rgba(0,0,0,0.12),inset_0_-1px_1px_rgba(255,255,255,0.4)] transition-all duration-200">
      <SliderPrimitive.Range className="absolute h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-cyan-400 shadow-[0_0_14px_rgba(59,130,246,0.55),inset_0_1px_1px_rgba(255,255,255,0.7)] transition-all duration-150 ease-out rounded-full" />
    </SliderPrimitive.Track>

    {/* Iconic Floating Liquid Pill Thumb (Image 1 & 2 visual match) */}
    <SliderPrimitive.Thumb className="relative block h-5 w-8 rounded-full border border-white/90 bg-white/95 dark:bg-white shadow-[0_4px_16px_rgba(0,0,0,0.25),0_0_12px_rgba(59,130,246,0.45),inset_0_1.5px_1px_rgba(255,255,255,1)] transition-transform duration-150 ease-out hover:scale-105 active:scale-95 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50 cursor-grab active:cursor-grabbing">
      {/* Specular internal pill indicator */}
      <span className="absolute inset-x-2.5 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-gradient-to-r from-blue-500 to-cyan-400 opacity-70" />
    </SliderPrimitive.Thumb>
  </SliderPrimitive.Root>
))
Slider.displayName = SliderPrimitive.Root.displayName

export { Slider }
