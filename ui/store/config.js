import { invoke } from "@tauri-apps/api/core"
import { create } from "zustand"
import { saveConfig as saveConfigImpl } from "@/utils/config"

export const useConfigStore = create((set) => ({
  config: null,

  hydrate: (config) => set({ config }),

  saveConfig: async (section, key, value) => {
    set((state) => ({
      config: {
        ...state.config,
        [section]: { ...state.config?.[section], [key]: value }
      }
    }))
    await saveConfigImpl(section, key, value)

    if (section === "general" && key === "theme") {
      await invoke("set_theme", { theme: value })
    }
  }
}))
