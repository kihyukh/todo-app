const KEY = "daymark.editor.vim";

export function readVimPreference(): boolean {
  try {
    return localStorage.getItem(KEY) === "true";
  } catch {
    return false;
  }
}

export function writeVimPreference(enabled: boolean) {
  try {
    localStorage.setItem(KEY, String(enabled));
  } catch {
    // The current session remains usable if browser storage is unavailable.
  }
}

/** Disable OS/browser predictions without changing the user's system settings. */
export const noTextSuggestions = {
  autoComplete: "off",
  autoCorrect: "off",
  autoCapitalize: "off",
  spellCheck: false,
  writingsuggestions: "false",
} as const;
