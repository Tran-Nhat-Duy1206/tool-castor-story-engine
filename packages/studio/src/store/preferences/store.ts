import { create } from "zustand";
import type { PreferencesStore } from "./types";

// Same storage convention as the theme preference (`castor:studio:theme`).
export const TOOL_DETAILS_STORAGE_KEY = "castor:studio:tool-details-default-open";

interface PreferenceStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getPreferenceStorage(): PreferenceStorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Default is `true` (keep today's behavior: result details start expanded).
 * Only an explicitly stored "false" turns the preference off.
 */
export function readStoredToolDetailsDefaultOpen(
  storage: Pick<PreferenceStorageLike, "getItem"> | null | undefined,
): boolean {
  return storage?.getItem(TOOL_DETAILS_STORAGE_KEY) !== "false";
}

export const usePreferencesStore = create<PreferencesStore>()((set) => ({
  toolDetailsDefaultOpen: readStoredToolDetailsDefaultOpen(getPreferenceStorage()),

  setToolDetailsDefaultOpen: (open: boolean) => {
    try {
      getPreferenceStorage()?.setItem(TOOL_DETAILS_STORAGE_KEY, String(open));
    } catch {
      // Ignore storage failures (e.g. private mode) and keep the in-memory
      // preference for this session — same policy as the theme preference.
    }
    set({ toolDetailsDefaultOpen: open });
  },
}));
