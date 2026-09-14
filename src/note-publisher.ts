/** Keep typing inside ProseMirror; serialize and publish only after a short pause. */
export function createNotePublisher<T>(
  publish: (value: T) => void,
  pendingChanged: (pending: boolean) => void = () => {},
  delay = 350,
  maxWait = 2000,
) {
  let snapshot: (() => T) | undefined;
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  let maxTimer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(quietTimer);
    clearTimeout(maxTimer);
    quietTimer = maxTimer = undefined;
    const latest = snapshot;
    snapshot = undefined;
    if (!latest) return;
    publish(latest());
    pendingChanged(false);
  };
  return {
    schedule(latest: () => T) {
      if (!snapshot) {
        pendingChanged(true);
        maxTimer = setTimeout(flush, maxWait);
      }
      snapshot = latest;
      clearTimeout(quietTimer);
      quietTimer = setTimeout(flush, delay);
    },
    flush,
    get pending() {
      return snapshot !== undefined;
    },
  };
}
