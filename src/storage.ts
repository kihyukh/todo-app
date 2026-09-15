import { useEffect, useRef, useState } from "react";
import { createInitialState, mergeState, uid } from "./model";
import type { AppState, Attachment, StorageInfo } from "./model";
import { APP_NAME } from "./brand";

export const AUTOSAVE_DELAY_MS = 800;

function stateSnapshot(state: AppState): string {
  // Older workspaces omit tags. Treat that as the same empty collection so a
  // cloud poll does not restart autosave merely by filling an optional field.
  return JSON.stringify({
    schemaVersion: state.schemaVersion,
    tasks: state.tasks,
    projects: state.projects,
    columns: state.columns,
    tags: state.tags ?? [],
  });
}

function mergeIfChanged(local: AppState, remote: AppState): AppState {
  const merged = mergeState(local, remote);
  return stateSnapshot(local) === stateSnapshot(merged) ? local : merged;
}

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
        changed =
          !request.result ||
          stateSnapshot(merged) !== stateSnapshot(request.result);
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
  const stateRef = useRef(state);
  const readyRef = useRef(ready);
  stateRef.current = state;
  readyRef.current = ready;
  const nativeSaves = useRef(new Map<string, AppState>());
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
              setState((old) => mergeIfChanged(old, remote));
          })
          .catch(() => {});
      };
    }
    window.daymarkNativeReceive = (event: any) => {
      window.dispatchEvent(
        new CustomEvent("daymark-native-message", { detail: event }),
      );
      if (
        String(event.requestId ?? "").startsWith("calendar:") ||
        String(event.requestId ?? "").startsWith("note-file:") ||
        String(event.type ?? "").startsWith("calendar")
      )
        return;
      if (!mounted) return;
      if (event.storage)
        setStorage((old) =>
          JSON.stringify(old) === JSON.stringify(event.storage)
            ? old
            : event.storage,
        );
      if (event.type === "state") {
        const wasLoaded = loaded.current;
        setState((old) =>
          wasLoaded
            ? event.state
              ? mergeIfChanged(old, event.state)
              : old
            : (event.state ?? createInitialState()),
        );
        loaded.current = true;
        setReady(true);
      } else if (event.type === "saved") {
        const saved = nativeSaves.current.get(event.requestId);
        nativeSaves.current.delete(event.requestId);
        // A completed older write must not label newer unsaved edits as saved.
        if (saved === stateRef.current) {
          setSaving(false);
          setError("");
        }
      } else if (event.type === "error") {
        setError(event.message);
        const failed = nativeSaves.current.get(event.requestId);
        nativeSaves.current.delete(event.requestId);
        if (!failed || failed === stateRef.current) setSaving(false);
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
              `Your workspace could not be opened. Please restart ${APP_NAME}.`,
            );
        });
    return () => {
      mounted = false;
      broadcast.current?.close();
      broadcast.current = null;
    };
  }, []);
  const saveSnapshot = (snapshot: AppState, requestId = uid()) => {
    if (isNative()) {
      nativeSaves.current.set(requestId, snapshot);
      nativeSend({ action: "save", state: snapshot, requestId });
    } else {
      void writeBrowser(snapshot)
        .then((result) => {
          setState((old) => mergeIfChanged(old, result.state));
          if (result.changed) broadcast.current?.postMessage({ changed: true });
          if (snapshot === stateRef.current) {
            setSaving(false);
            setError("");
          }
        })
        .catch(() => {
          if (snapshot === stateRef.current) setSaving(false);
          setError(
            "Changes could not be saved. Export a backup before closing this window.",
          );
        });
    }
  };
  const saveRef = useRef(saveSnapshot);
  saveRef.current = saveSnapshot;
  useEffect(() => {
    if (!ready) return;
    setSaving(true);
    const timer = setTimeout(() => {
      saveRef.current(state);
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state, ready]);
  // The editor flushes its draft in the event's capture phase. Read the fresh
  // workspace after that flush, without waiting for the normal autosave pause.
  useEffect(() => {
    const flush = (event: Event) => {
      if (readyRef.current)
        saveRef.current(
          stateRef.current,
          (event as CustomEvent).detail?.requestId,
        );
    };
    window.addEventListener("pagehide", flush);
    window.addEventListener("daymark-flush", flush);
    return () => {
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("daymark-flush", flush);
    };
  }, []);
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
