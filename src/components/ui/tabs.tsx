import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "relative inline-flex items-center justify-start sm:justify-center gap-1",
      "rounded-2xl p-1 sm:p-1.5",
      "bg-slate-100/90 dark:bg-slate-900/85",
      "backdrop-blur-md",
      "border border-slate-200/70 dark:border-white/10",
      "shadow-xs",
      "text-muted-foreground",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, children, style, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "relative z-10 inline-flex items-center justify-center whitespace-nowrap",
      "rounded-xl px-3.5 py-2 text-xs sm:text-sm font-semibold min-h-[38px]",
      "ring-offset-background transition-all duration-150 ease-out cursor-pointer",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "disabled:pointer-events-none disabled:opacity-50",
      // Inactive state
      "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/5",
      // Active state - Crisp Clean Pill
      "data-[state=active]:text-foreground data-[state=active]:font-bold",
      "data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800",
      "data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-slate-200/80 dark:data-[state=active]:border-white/15",
      // Tap scale
      "active:scale-[0.98]",
      className
    )}
    style={style}
    {...props}
  >
    {children}
  </TabsPrimitive.Trigger>
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

interface TabsContentProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content> {
  keepMounted?: boolean;
}

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  TabsContentProps
>(({ className, keepMounted, forceMount, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    forceMount={(forceMount ?? keepMounted) ? true : undefined}
    className={cn(
      "mt-3.5 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      "data-[state=active]:animate-in data-[state=active]:fade-in-50 data-[state=active]:duration-150 data-[state=inactive]:hidden",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
