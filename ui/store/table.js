import { create } from "zustand"

const createTableState = () => ({
  fileList: {},
  archiveList: []
})

export const useTableStore = create((set) => ({
  rename: createTableState(),
  download: createTableState(),

  setFileList: (scope, updater) => set((state) => ({
    [scope]: {
      ...state[scope],
      fileList: updater(state[scope].fileList)
    }
  })),
  setArchiveList: (scope, updater) => set((state) => ({
    [scope]: {
      ...state[scope],
      archiveList: updater(state[scope].archiveList)
    }
  })),

  clearAll: (scope) => set({
    [scope]: createTableState()
  })
}))
