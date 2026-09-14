const PREFERENCE_KEY = "daymark.completion-sound.v1";
const CHIME_GAP_MS = 600;
const RESUME_WINDOW_MS = 250;

let preferenceFallback = true;
let unsavedPreference: boolean | undefined;
let audioContext: AudioContext | undefined;
let lastAttempt = -Infinity;

/** This preference belongs to the device, not the shared task workspace. */
export function readCompletionSoundPreference(): boolean {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    const saved = localStorage.getItem(PREFERENCE_KEY);
    if (saved !== null) preferenceFallback = saved !== "false";
  } catch {
    // Keep the setting usable for this session if device storage is unavailable.
  }
  return preferenceFallback;
}

export function writeCompletionSoundPreference(enabled: boolean): void {
  preferenceFallback = enabled;
  try {
    localStorage.setItem(PREFERENCE_KEY, String(enabled));
    unsavedPreference = undefined;
  } catch {
    unsavedPreference = enabled;
    // Sound is optional, including when private browsing blocks persistence.
  }
}

function ring(context: AudioContext): void {
  const voices: { oscillator: OscillatorNode; envelope: GainNode }[] = [];
  try {
    const start = context.currentTime + 0.005;
    // A soft rising fifth, with a faint bell partial and no sharp attack.
    for (const [frequency, offset] of [
      [659.25, 0],
      [987.77, 0.1],
    ]) {
      for (const [ratio, volume] of [
        [1, 0.045],
        [2.003, 0.008],
      ]) {
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        voices.push({ oscillator, envelope });
        const onset = start + offset;
        const end = onset + 0.43;
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency * ratio, onset);
        envelope.gain.setValueAtTime(0, onset);
        envelope.gain.linearRampToValueAtTime(volume, onset + 0.009);
        envelope.gain.exponentialRampToValueAtTime(0.0001, end - 0.025);
        envelope.gain.linearRampToValueAtTime(0, end);
        oscillator.connect(envelope);
        envelope.connect(context.destination);
        oscillator.onended = () => {
          oscillator.disconnect();
          envelope.disconnect();
        };
        oscillator.start(onset);
        oscillator.stop(end);
      }
    }
  } catch {
    // A failed audio node must never interrupt a task action or leave a tone on.
    for (const { oscillator, envelope } of voices) {
      try {
        oscillator.stop();
      } catch {
        /* It may not have started. */
      }
      try {
        oscillator.disconnect();
      } catch {
        /* Already disconnected. */
      }
      try {
        envelope.disconnect();
      } catch {
        /* Already disconnected. */
      }
    }
  }
}

/** Call directly from the completion gesture; nothing starts merely on import. */
export function playCompletionChime(): void {
  if (!readCompletionSoundPreference() || typeof window === "undefined") return;

  try {
    const now = performance.now();
    if (now - lastAttempt < CHIME_GAP_MS) return;

    if (!audioContext || audioContext.state === "closed") {
      const Context =
        window.AudioContext ??
        (window as Window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!Context) return;
      audioContext = new Context();
    }
    const context = audioContext;
    lastAttempt = now;

    if (context.state === "running") {
      ring(context);
      return;
    }

    // Invoke resume while the user gesture is still active, including in WebKit.
    // A blocked resume may remain pending. The rate limit permits a later user
    // gesture to retry without queuing bursts or replaying an obsolete chime.
    const resumed = context.resume();
    void resumed
      .then(() => {
        if (
          context.state === "running" &&
          performance.now() - now <= RESUME_WINDOW_MS &&
          readCompletionSoundPreference()
        )
          ring(context);
      })
      .catch(() => {
        // A denied or interrupted resume remains silent; a new gesture can retry.
      });
  } catch {
    // Missing APIs, denied audio, and interrupted WebKit contexts are silent.
  }
}
