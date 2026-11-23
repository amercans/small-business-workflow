import { useRef } from 'react'
import { useRouter } from '@tanstack/react-router'

export function useSheetState(isOpen: boolean, go: (open: boolean, replace: boolean) => void) {
  const openedHere = useRef(false)
  const router = useRouter()
  return {
    open: isOpen,
    openSheet: () => {
      openedHere.current = true
      go(true, false)
    },
    closeSheet: () => {
      if (openedHere.current) {
        openedHere.current = false
        router.history.back()
      } else go(false, true)
    },
  }
}
