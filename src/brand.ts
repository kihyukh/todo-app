/** Display names can change without moving the user's workspace or storage keys. */
export const APP_NAME: string =
  import.meta.env.VITE_APP_NAME?.trim() || "GreenDay";
export const APP_VERSION: string =
  import.meta.env.VITE_APP_VERSION?.trim() || "0.1.0";

function publicPage(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export const PUBLIC_PRIVACY_URL = publicPage(
  import.meta.env.VITE_PUBLIC_PRIVACY_URL,
);
export const PUBLIC_SUPPORT_URL = publicPage(
  import.meta.env.VITE_PUBLIC_SUPPORT_URL,
);
