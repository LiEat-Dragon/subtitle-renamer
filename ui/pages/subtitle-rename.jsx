import { basename } from "@tauri-apps/api/path"
import { useState, useCallback, useEffect } from "react"
import { useConfig } from "@/hooks/useConfig"
import { useSubtitleStore } from "@/store/subtitle"
import { Link } from "react-router-dom"
import { detectFiles } from "@/utils/detect"
import { renameSubtitles } from "@/utils/rename"
import { elapsedTime } from "@/utils/time"
import { highlightDiff } from "@/utils/highlight"
import { moveSubOptions, removeSubOptions } from "@/pages/settings-rename"
import { SubtitleTableContextMenu } from "@/contexts/subtitle-table"
import { toast } from "@/components/toast"
import { Page, PageBlock } from "@/components/page"
import { DropArea } from "@/components/drop"
import { Table } from "@/components/table"
import { Button } from "@/components/button"
import { Badge } from "@/components/badge"
import { Combobox } from "@/components/combobox"
import { FileVideoIcon, FileTextIcon, FileArchiveIcon, FolderIcon, GearIcon } from "@phosphor-icons/react"

export function SubtitleRename() {
  const [cell, setCell] = useState(null)
  const [fileData, setFileData] = useState([]) // 展平为带路径的数组，用于重命名
  const [tableData, setTableData] = useState([]) // 上面数组的基础上移除了路径，只保留文件名

  const { config, saveConfig } = useConfig()
  const { fileList, archiveList, setFileList, setArchiveList, clearAll } = useSubtitleStore()

  const tableColumns = [
    { key: "video", title: "视频文件" },
    { key: "sc", title: config?.subtitle?.detect_language ? "简体字幕" : "字幕文件" },
    ...(config?.subtitle?.detect_language ? [{ key: "tc", title: "繁体字幕" }] : [])
  ]

  useEffect(() => {
    const processData = async () => {
      const entries = Object.entries(fileList)
      const maxLength = Math.max(0, ...entries.map(([, v]) => v?.length || 0))

      const data = Array.from({ length: maxLength }, (_, i) =>
        Object.fromEntries(entries.map(([k, v]) => [k, v?.[i] || ""]))
      )

      const result = await Promise.all(
        data.map((row) =>
          Promise.all(
            Object.entries(row).map(async ([k, v]) => [k, v ? await basename(v) : ""])
          ).then(Object.fromEntries)
        )
      )

      if (config?.subtitle?.highlight_diff) {
        setFileData(data)
        setTableData(highlightDiff(result, config.subtitle.highlight_ignore_case, config.subtitle.highlight_numbers_only))
      } else {
        setFileData(data)
        setTableData(result)
      }
    }
    processData()
  }, [fileList, config])

  // 拖拽添加文件
  const handleFileDrop = useCallback(async (paths) => {
    if (!paths || paths.length === 0) return

    const dropPromise = (async () => {
      const startTime = Date.now()
      const { files, archives, addedCount, filteredCount, duplicateCount, excludedCount, skippedFolderCount } = await detectFiles(paths, fileList, archiveList)

      const reasons = []
      if (filteredCount > 0) reasons.push(`${filteredCount} 个无效文件`)
      if (duplicateCount > 0) reasons.push(`${duplicateCount} 个重复文件`)
      if (excludedCount > 0) reasons.push(`${excludedCount} 个设置中排除的文件`)
      if (skippedFolderCount > 0) reasons.push(`${skippedFolderCount} 个跳过的文件夹`)
      const filterText = reasons.length ? `过滤了 ${reasons.join("和 ")}` : ""

      if (addedCount === 0) {
        throw new Error(`${filterText || "没有可添加的文件"}，耗时 ${elapsedTime(startTime)}`)
      } else {
        setFileList(() => files)
        setArchiveList(() => archives)
        return { message: `添加了 ${addedCount} 个文件${filterText && `，${filterText}`}，耗时 ${elapsedTime(startTime)}` }
      }
    })()

    toast.promise(dropPromise, {
      loading: { title: "正在添加文件" },
      success: { title: (data) => data.message, duration: 1000 },
      error: { type: "warning", title: (error) => error.message || String(error) }
    })
  }, [fileList, archiveList, setFileList, setArchiveList])

  // 切换配置标签状态
  const handleCycleSubtitleConfig = useCallback((key, options) => {
    const currentValue = config?.subtitle?.[key]
    const currentIndex = options.findIndex((option) => option.value === currentValue)
    const nextValue = options[(currentIndex + 1) % options.length].value
    saveConfig("subtitle", key, nextValue)
  }, [config, saveConfig])

  // 重命名字幕
  const handleRename = async () => {
    const success = await renameSubtitles(fileData, archiveList)
    if (success) clearAll()
  }

  return (
    <Page className="flex flex-col h-screen bg-transparent">
      <SubtitleTableContextMenu cell={cell} fileData={fileData} onClose={() => setCell(null)} />

      <PageBlock className="flex-1">
        <DropArea title="松手以添加所选内容" onFileDrop={handleFileDrop}>
          {tableData.length > 0
            ? (
                <Table columns={tableColumns} data={tableData} onContextMenu={setCell} />
              )
            : (
                <div className="flex-1 flex-center flex-col gap-3 text-secondary">
                  <div className="flex-center gap-3">
                    <FileVideoIcon className="size-7" weight="light" />
                    <FileTextIcon className="size-7" weight="light" />
                    <FileArchiveIcon className="size-7" weight="light" />
                    <FolderIcon className="size-7" weight="light" />
                  </div>
                  <span>请拖入视频、字幕、压缩包或文件夹</span>
                </div>
              )}
        </DropArea>
      </PageBlock>

      <PageBlock className="items-center justify-end gap-3 p-4" last>
        <div className="flex-1 flex items-center gap-2">
          {config?.subtitle?.config_quick_union_extension && (
            <Combobox
              options={config?.subtitle?.union_extension_options}
              value={config?.subtitle?.union_extension}
              onChange={(value) => saveConfig("subtitle", "union_extension", value)}
              onOptionsChange={(options) => saveConfig("subtitle", "union_extension_options", options)}
              placeholder="无后缀"
              className="w-56"
            />
          )}
          {config?.subtitle?.config_badge_union_extension && config?.subtitle?.union_extension && (
            <Badge variant="outline">添加后缀 {config.subtitle.union_extension}</Badge>
          )}
          {config?.subtitle?.config_badge_move_sub && config?.subtitle?.move_sub && (
            <Badge
              variant="outline"
              onClick={() => handleCycleSubtitleConfig("move_sub", moveSubOptions)}
            >
              {moveSubOptions.find((option) => option.value === config.subtitle.move_sub)?.label}
            </Badge>
          )}
          {config?.subtitle?.config_badge_remove_sub && config?.subtitle?.remove_sub && (
            <Badge
              variant="outline"
              onClick={() => handleCycleSubtitleConfig("remove_sub", removeSubOptions)}
            >
              {removeSubOptions.find((option) => option.value === config.subtitle.remove_sub)?.label}
            </Badge>
          )}
        </div>

        <Link to="/settings/rename" draggable={false}>
          <Button className="w-8 p-0">
            <GearIcon className="size-4" />
          </Button>
        </Link>
        <Button className="w-26" onClick={() => clearAll()}>清空列表</Button>
        <Button variant="primary" className="w-26" onClick={handleRename}>重命名</Button>
      </PageBlock>
    </Page>
  )
}
