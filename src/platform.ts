/** Device preferences stay local; they never change a shared workspace. */
const IOS_SETUP_KEY = "daymark.ios.workspace-setup.v1";

declare global {
  interface Window {
    __DAYMARK_PLATFORM__?: "macos" | "ios";
    __DAYMARK_NATIVE__?: boolean;
  }
}

export function isNativeIOS(): boolean {
  return window.__DAYMARK_PLATFORM__ === "ios";
}

export function usesTouchInterface(): boolean {
  return isNativeIOS() || !!window.matchMedia?.("(pointer: coarse)").matches;
}

export function needsIOSWorkspaceSetup(): boolean {
  if (!isNativeIOS()) return false;
  try {
    return localStorage.getItem(IOS_SETUP_KEY) !== "complete";
  } catch {
    return true;
  }
}

export function finishIOSWorkspaceSetup(): void {
  try {
    localStorage.setItem(IOS_SETUP_KEY, "complete");
  } catch {
    /* The current session can continue without device storage. */
  }
}

export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLTextAreaElement)
    return !target.readOnly && !target.disabled;
  if (target instanceof HTMLInputElement)
    return (
      !target.readOnly &&
      !target.disabled &&
      ![
        "button",
        "checkbox",
        "radio",
        "submit",
        "reset",
        "range",
        "file",
        "color",
        "hidden",
      ].includes(target.type)
    );
  return (
    target.isContentEditable || !!target.closest('[contenteditable="true"]')
  );
}

export function dismissSoftwareKeyboard(): void {
  if (document.activeElement instanceof HTMLElement)
    document.activeElement.blur();
}
