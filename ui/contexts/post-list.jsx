import { openUrl } from "@tauri-apps/plugin-opener"
import { useCallback } from "react"
import { toast } from "@/components/toast"
import { ContextMenu, ContextItem } from "@/components/context-menu"
import { BrowserIcon } from "@phosphor-icons/react"

export function PostListContextMenu({ cell, onClose }) {
  const handleOpenPost = useCallback(async () => {
    try {
      await openUrl(cell.post.url)
    } catch (error) {
      toast.error({ title: "无法在网页中打开", description: error.message || String(error) })
    }
  }, [cell])

  return (
    <ContextMenu cell={cell} onClose={onClose}>
      {cell && (
        <ContextItem
          title="在网页中打开"
          icon={<BrowserIcon className="size-4" />}
          onClick={handleOpenPost}
        />
      )}
    </ContextMenu>
  )
}
