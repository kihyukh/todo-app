/** Display names can change without moving the user's workspace or storage keys. */
export const APP_NAME: string =
  import.meta.env.VITE_APP_NAME?.trim() || "GreenDay";
export const APP_VERSION: string =
  import.meta.env.VITE_APP_VERSION?.trim() || "0.1.0";
