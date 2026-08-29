export interface PreferencesStore {
  /**
   * Whether pipeline tool result blocks ("Xem kết quả thao tác") in chat render
   * expanded by default. Persisted per browser via localStorage.
   */
  toolDetailsDefaultOpen: boolean;

  setToolDetailsDefaultOpen: (open: boolean) => void;
}
