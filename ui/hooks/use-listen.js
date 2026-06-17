import { listen } from "@tauri-apps/api/event"
import { useEffect, useRef } from "react"

export function useListen(eventName, handler) {
  const handlerRef = useRef(handler)

  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    let disposed = false
    let cleanup

    listen(eventName, (event) => {
      if (!disposed) handlerRef.current(event)
    }).then((unlisten) => {
      if (disposed) {
        unlisten()
      } else {
        cleanup = unlisten
      }
    })

    return () => {
      disposed = true
      cleanup?.()
    }
  }, [eventName])
}
