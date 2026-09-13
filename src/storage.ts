import { useEffect, useRef, useState } from "react";
import { createInitialState, mergeState, uid } from "./model";
import type { AppState, Attachment, StorageInfo } from "./model";

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        daymark?: { postMessage: (message: unknown) => void };
      };
    };
    daymarkNativeReceive?: (event: any) => void;
  }
}
export const isNative = () => !!window.webkit?.messageHandlers?.daymark;
export function nativeSend(message: unknown) {
  window.webkit?.messageHandlers?.daymark?.postMessage(message);
}
let database: Promise<IDBDatabase> | undefined;
function db() {
  return (database ??= new Promise((resolve, reject) => {
    const req = indexedDB.open("daymark", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("workspace");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}
export async function readBrowser(): Promise<AppState | null> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const req = database
      .transaction("workspace")
      .objectStore("workspace")
      .get("state");
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}
export async function writeBrowser(state: AppState) {
  const database = await db();
  return new Promise<{ state: AppState; changed: boolean }>(
    (resolve, reject) => {
      const tx = database.transaction("workspace", "readwrite");
      const store = tx.objectStore("workspace");
      const request = store.get("state");
      let merged = state,
        changed = false;
      request.onsuccess = () => {
        merged = mergeState(
          state,
          request.result ?? {
            schemaVersion: 1,
            tasks: [],
            projects: [],
            columns: [],
          },
        );
        changed = JSON.stringify(merged) !== JSON.stringify(request.result);
        if (changed) store.put(merged, "state");
      };
      tx.oncomplete = () => resolve({ state: merged, changed });
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    },
  );
}
export function useWorkspace() {
  const [state, setState] = useState<AppState>({
    schemaVersion: 1,
    tasks: [],
    projects: [],
    columns: [],
  });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [storage, setStorage] = useState<StorageInfo>({ kind: "local" });
  const [saving, setSaving] = useState(false);
  const loaded = useRef(false);
  const broadcast = useRef<BroadcastChannel | null>(null);
  const attachments = useRef(new Map<string, (a: Attachment) => void>());
  useEffect(() => {
    let mounted = true;
    if (!isNative() && typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel("daymark-workspace");
      broadcast.current = channel;
      channel.onmessage = () => {
        readBrowser()
          .then((remote) => {
            if (mounted && loaded.current && remote)
              setState((old) => {
                const merged = mergeState(old, remote);
                return JSON.stringify(old) === JSON.stringify(merged)
                  ? old
                  : merged;
              });
          })
          .catch(() => {});
      };
    }
    window.daymarkNativeReceive = (event: any) => {
      if (!mounted) return;
      if (event.storage) setStorage(event.storage);
      if (event.type === "state") {
        const wasLoaded = loaded.current;
        setState((old) =>
          wasLoaded
            ? event.state
              ? mergeState(old, event.state)
              : old
            : (event.state ?? createInitialState()),
        );
        loaded.current = true;
        setReady(true);
      } else if (event.type === "saved") {
        setSaving(false);
        setError("");
      } else if (event.type === "error") {
        setError(event.message);
        setSaving(false);
        attachments.current.delete(event.requestId);
      } else if (event.type === "cancelled") {
        attachments.current.delete(event.requestId);
      } else if (event.type === "attachment") {
        attachments.current.get(event.requestId)?.(event.attachment);
        attachments.current.delete(event.requestId);
      }
    };
    if (isNative()) nativeSend({ action: "load" });
    else
      readBrowser()
        .then((value) => {
          if (mounted) {
            setState(value ?? createInitialState());
            loaded.current = true;
            setReady(true);
          }
        })
        .catch(() => {
          if (mounted)
            setError(
              "Your workspace could not be opened. Please restart Daymark.",
            );
        });
    return () => {
      mounted = false;
      broadcast.current?.close();
      broadcast.current = null;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    setSaving(true);
    const timer = setTimeout(() => {
      if (isNative()) nativeSend({ action: "save", state });
      else
        writeBrowser(state)
          .then((result) => {
            setState((old) => {
              const merged = mergeState(old, result.state);
              return JSON.stringify(old) === JSON.stringify(merged)
                ? old
                : merged;
            });
            if (result.changed)
              broadcast.current?.postMessage({ changed: true });
            setSaving(false);
            setError("");
          })
          .catch(() => {
            setSaving(false);
            setError(
              "Changes could not be saved. Export a backup before closing this window.",
            );
          });
    }, 150);
    return () => clearTimeout(timer);
  }, [state, ready]);
  // A closing native window must receive the latest edit even before the short save debounce.
  useEffect(() => {
    const flush = (event: Event) => {
      if (ready && isNative())
        nativeSend({
          action: "save",
          state,
          requestId: (event as CustomEvent).detail?.requestId,
        });
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("daymark-flush", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("daymark-flush", flush);
    };
  }, [state, ready]);
  function attachNative(callback: (a: Attachment) => void) {
    const requestId = uid();
    attachments.current.set(requestId, callback);
    nativeSend({ action: "attach", requestId });
  }
  return {
    state,
    setState,
    ready,
    error,
    setError,
    storage,
    saving,
    attachNative,
  };
}
