import * as React from "react"
import { Capacitor } from "@capacitor/core"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const isNative = typeof window !== "undefined" && Capacitor.isNativePlatform()

  const [isMobile, setIsMobile] = React.useState(() => {
    if (typeof window !== "undefined") {
      if (Capacitor.isNativePlatform()) return true
      return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches
    }
    return false
  })

  React.useEffect(() => {
    if (isNative) {
      setIsMobile(true)
      return
    }
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(mql.matches)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(mql.matches)
    return () => mql.removeEventListener("change", onChange)
  }, [isNative])

  return isMobile
}
