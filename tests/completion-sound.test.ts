// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Sound = typeof import("../src/completion-sound");
let sound: Sound;

function mockAudio(initialState: AudioContextState = "running") {
  const oscillators: {
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }[] = [];
  const gains: { linearRampToValueAtTime: ReturnType<typeof vi.fn> }[] = [];
  const context = {
    state: initialState,
    currentTime: 12,
    destination: {},
    resume: vi.fn(async () => {
      context.state = "running";
    }),
    createOscillator: vi.fn(() => {
      const oscillator = {
        type: "sine",
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      };
      oscillators.push(oscillator);
      return oscillator;
    }),
    createGain: vi.fn(() => {
      const gain = {
        setValueAtTime: vi.fn(),
        linearRampToValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      };
      gains.push(gain);
      return { gain, connect: vi.fn(), disconnect: vi.fn() };
    }),
  };
  const Constructor = vi.fn(function () {
    return context;
  });
  vi.stubGlobal("AudioContext", Constructor);
  return { context, Constructor, oscillators, gains };
}

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["performance"] });
  vi.stubGlobal("AudioContext", undefined);
  vi.stubGlobal("webkitAudioContext", undefined);
  sound = await import("../src/completion-sound");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("completion chime", () => {
  it("does not create audio on import or when the device preference is disabled", async () => {
    const { Constructor } = mockAudio();
    vi.resetModules();
    sound = await import("../src/completion-sound");
    expect(Constructor).not.toHaveBeenCalled();
    expect(sound.readCompletionSoundPreference()).toBe(true);

    sound.writeCompletionSoundPreference(false);
    expect(localStorage.getItem("daymark.completion-sound.v1")).toBe("false");
    sound.playCompletionChime();
    expect(Constructor).not.toHaveBeenCalled();
  });

  it("remembers a disabled setting on reload and retains it when storage fails", async () => {
    localStorage.setItem("daymark.completion-sound.v1", "false");
    expect(sound.readCompletionSoundPreference()).toBe(false);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { Constructor } = mockAudio();
    sound.writeCompletionSoundPreference(false);
    expect(() => sound.playCompletionChime()).not.toThrow();
    expect(Constructor).not.toHaveBeenCalled();
    sound.writeCompletionSoundPreference(true);
    expect(sound.readCompletionSoundPreference()).toBe(true);
  });

  it("reuses one context, caps rapid completions, and keeps every chime short and quiet", () => {
    const { Constructor, oscillators, gains } = mockAudio();
    sound.playCompletionChime();
    for (let i = 0; i < 20; i++) sound.playCompletionChime();
    expect(Constructor).toHaveBeenCalledTimes(1);
    expect(oscillators).toHaveLength(4);
    const starts = oscillators.map(
      (voice) => voice.start.mock.calls[0][0] as number,
    );
    const ends = oscillators.map(
      (voice) => voice.stop.mock.calls[0][0] as number,
    );
    expect(Math.max(...ends) - Math.min(...starts)).toBeLessThanOrEqual(0.65);
    expect(
      Math.max(
        ...gains.flatMap((gain) =>
          gain.linearRampToValueAtTime.mock.calls.map(
            (call) => call[0] as number,
          ),
        ),
      ),
    ).toBeLessThanOrEqual(0.05);

    vi.advanceTimersByTime(601);
    sound.playCompletionChime();
    expect(Constructor).toHaveBeenCalledTimes(1);
    expect(oscillators).toHaveLength(8);
  });

  it("honors a changed preference for this session when storage can read but cannot write", () => {
    localStorage.setItem("daymark.completion-sound.v1", "true");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    const { Constructor } = mockAudio();
    sound.writeCompletionSoundPreference(false);
    sound.playCompletionChime();
    expect(sound.readCompletionSoundPreference()).toBe(false);
    expect(Constructor).not.toHaveBeenCalled();
  });

  it("resumes synchronously in the gesture and plays after a prompt unlock", async () => {
    const { context, oscillators } = mockAudio("suspended");
    sound.playCompletionChime();
    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(oscillators).toHaveLength(0);
    await Promise.resolve();
    expect(oscillators).toHaveLength(4);
  });

  it("does not queue sound after a delayed unlock or while the preference is turned off", async () => {
    const { context, oscillators } = mockAudio("suspended");
    let resolve!: () => void;
    context.resume.mockImplementation(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    sound.playCompletionChime();
    sound.playCompletionChime();
    expect(context.resume).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    context.state = "running";
    resolve();
    await Promise.resolve();
    expect(oscillators).toHaveLength(0);

    context.state = "suspended";
    sound.playCompletionChime();
    sound.writeCompletionSoundPreference(false);
    context.state = "running";
    resolve();
    await Promise.resolve();
    expect(oscillators).toHaveLength(0);
  });

  it("recovers on a later gesture even if an earlier resume never settles", async () => {
    const { context, Constructor, oscillators } = mockAudio("suspended");
    let resolveFirst!: () => void;
    context.resume.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolveFirst = done;
        }),
    );
    sound.playCompletionChime();
    vi.advanceTimersByTime(1000);
    sound.playCompletionChime();
    expect(context.resume).toHaveBeenCalledTimes(2);
    expect(Constructor).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(oscillators).toHaveLength(4);

    // The obsolete request must not replay a chime when it eventually resolves.
    resolveFirst();
    await Promise.resolve();
    expect(oscillators).toHaveLength(4);
  });

  it("silently handles unsupported audio, constructor denial, and rejected resumes", async () => {
    expect(() => sound.playCompletionChime()).not.toThrow();
    vi.stubGlobal(
      "AudioContext",
      vi.fn(function () {
        throw new Error("denied");
      }),
    );
    expect(() => sound.playCompletionChime()).not.toThrow();

    const { context, oscillators } = mockAudio("suspended");
    context.resume.mockRejectedValue(new Error("not allowed"));
    expect(() => sound.playCompletionChime()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(oscillators).toHaveLength(0);
    vi.advanceTimersByTime(601);
    context.resume.mockImplementation(async () => {
      context.state = "running";
    });
    sound.playCompletionChime();
    await Promise.resolve();
    expect(oscillators).toHaveLength(4);
  });
});
