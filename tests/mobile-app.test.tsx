// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { AppState, StorageInfo } from "../src/model";
import { dateKey, emptyDoc } from "../src/model";
import App from "../src/App";
import {
  finishIOSWorkspaceSetup,
  needsIOSWorkspaceSetup,
} from "../src/platform";
import { nativeSend } from "../src/storage";

let root: Root | undefined;
let initialStorage: StorageInfo = { kind: "local" };
let changeStorage: (value: StorageInfo) => void;
let changeError: (value: string) => void;
let latest: AppState;
const initial: AppState = {
  schemaVersion: 1,
  tasks: [],
  projects: [],
  columns: [],
  tags: [],
};
let initialState = initial;
vi.mock("../src/storage", () => ({
  isNative: () => window.__DAYMARK_PLATFORM__ !== undefined,
  nativeSend: vi.fn(),
  useWorkspace: () => {
    const [state, setState] = useState(initialState);
    const [storage, setStorage] = useState(initialStorage);
    const [error, setError] = useState("");
    latest = state;
    changeStorage = setStorage;
    changeError = setError;
    return {
      state,
      setState,
      ready: true,
      storage,
      error,
      setError,
      saving: false,
      attachNative: vi.fn(),
    };
  },
}));
vi.mock("../src/TaskEditor", () => ({
  default: () => (
    <div
      aria-label="Task notes"
      contentEditable
      suppressContentEditableWarning
    />
  ),
}));
beforeAll(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
});
beforeEach(() => {
  vi.mocked(nativeSend).mockImplementation((message) => {
    if (message.action === "calendarStatus") {
      window.dispatchEvent(
        new CustomEvent("daymark-native-message", {
          detail: {
            type: "calendarStatus",
            requestId: message.requestId,
            status: "notDetermined",
            calendars: [],
          },
        }),
      );
    }
  });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  localStorage.clear();
  delete window.__DAYMARK_PLATFORM__;
  initialStorage = { kind: "local" };
  initialState = initial;
  vi.clearAllMocks();
});
async function mount(platform?: "ios" | "macos") {
  window.__DAYMARK_PLATFORM__ = platform;
  const element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  await act(async () => root!.render(<App />));
  return element;
}
const textButton = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === text,
  )!;
const onboarding = () =>
  document.querySelector('[aria-labelledby="ios-workspace-title"]');
const label = <T extends HTMLElement = HTMLElement>(name: string) =>
  document.querySelector<T>(`[aria-label="${name}"]`);
async function click(button: HTMLElement) {
  await act(async () => button.click());
}
// Reading calendar permission is allowed at startup; permission requests and
// every workspace mutation must still be explicitly initiated by the user.
const actionableNativeMessages = () =>
  vi
    .mocked(nativeSend)
    .mock.calls.map(([message]) => message)
    .filter((message) => message.action !== "calendarStatus");

describe("iPhone workspace setup", () => {
  it("offers the existing Mac folder on first launch and finishes only when the folder is connected", async () => {
    await mount("ios");
    expect(onboarding()).not.toBeNull();
    expect(onboarding()!.textContent).toContain("same workspace folder");
    expect(document.activeElement).toBe(textButton("Choose workspace folder"));
    const before = structuredClone(latest);
    await click(textButton("Choose workspace folder"));
    expect(actionableNativeMessages()).toEqual([
      {
        action: "chooseFolder",
      },
    ]);
    expect(onboarding()).not.toBeNull();
    expect(needsIOSWorkspaceSetup()).toBe(true);
    await act(async () =>
      changeStorage({ kind: "folder", path: "/chosen/workspace" }),
    );
    expect(onboarding()).toBeNull();
    expect(needsIOSWorkspaceSetup()).toBe(false);
    expect(latest).toEqual(before);
  });

  it("can continue locally and remembers that choice across app launches without changing the workspace", async () => {
    await mount("ios");
    await click(textButton("Continue on this device"));
    expect(onboarding()).toBeNull();
    expect(needsIOSWorkspaceSetup()).toBe(false);
    expect(actionableNativeMessages()).toEqual([]);
    expect(latest).toEqual(initial);
    await act(async () => root!.unmount());
    root = undefined;
    document.body.replaceChildren();
    await mount("ios");
    expect(onboarding()).toBeNull();
  });

  it("shows a failed folder connection inside setup and allows retry without dismissing setup", async () => {
    await mount("ios");
    await click(textButton("Choose workspace folder"));
    await act(async () =>
      changeError(
        "The selected folder could not be opened. Please choose it again.",
      ),
    );
    const setup = onboarding()!;
    expect(setup.querySelector('[role="alert"]')?.textContent).toContain(
      "folder could not be opened",
    );
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1);
    expect(needsIOSWorkspaceSetup()).toBe(true);
    await click(textButton("Choose workspace folder"));
    expect(actionableNativeMessages()).toEqual([
      { action: "chooseFolder" },
      { action: "chooseFolder" },
    ]);
    expect(onboarding()!.querySelector('[role="alert"]')).toBeNull();
    expect(needsIOSWorkspaceSetup()).toBe(true);
    expect(latest).toEqual(initial);
  });

  it.each(["folder", "icloud"] as const)(
    "skips setup when already connected through %s storage",
    async (kind) => {
      initialStorage = { kind };
      await mount("ios");
      expect(onboarding()).toBeNull();
      expect(needsIOSWorkspaceSetup()).toBe(false);
      expect(actionableNativeMessages()).toEqual([]);
    },
  );

  it.each(["macos", undefined] as const)(
    "never prompts outside native iOS (%s)",
    async (platform) => {
      await mount(platform);
      expect(onboarding()).toBeNull();
      expect(document.querySelector(".is-touch-device")).toBeNull();
      expect(actionableNativeMessages()).toEqual([]);
      if (platform === undefined) expect(nativeSend).not.toHaveBeenCalled();
    },
  );
});

describe("mobile workspace errors", () => {
  it("shows save errors in the active task and preserves them when returning to the task list", async () => {
    window.__DAYMARK_PLATFORM__ = "ios";
    finishIOSWorkspaceSetup();
    initialState = {
      ...initial,
      tasks: [
        {
          id: "phone-task",
          title: "Mobile task",
          notes: emptyDoc(),
          projectId: "",
          columnId: "next",
          doDate: dateKey(),
          deadline: null,
          attachments: [],
          createdAt: "2020-01-01T00:00:00.000Z",
          updatedAt: "2020-01-01T00:00:00.000Z",
          completedAt: null,
          deletedAt: null,
        },
      ],
    };
    const element = await mount("ios");
    await click(element.querySelector<HTMLButtonElement>(".task-content")!);
    await act(async () =>
      changeError("Changes could not be saved. Your workspace is unavailable."),
    );
    const detail = element.querySelector(".detail")!;
    expect(detail.querySelector('[role="alert"]')?.textContent).toContain(
      "Changes could not be saved",
    );
    expect(
      detail.querySelector(".saved-label.has-save-error")?.textContent,
    ).toBe("Not saved");
    expect(element.querySelectorAll('[role="alert"]')).toHaveLength(1);
    await click(label("Back to tasks")!);
    expect(element.querySelector(".detail")).toBeNull();
    expect(element.querySelector('main [role="alert"]')?.textContent).toContain(
      "Changes could not be saved",
    );
    await click(element.querySelector<HTMLButtonElement>(".task-content")!);
    await click(label("Dismiss error")!);
    expect(element.querySelector('[role="alert"]')).toBeNull();
    expect(element.querySelector(".saved-label.has-save-error")).toBeNull();
    expect(latest).toEqual(initialState);
  });
});

describe("optional calendar access", () => {
  it.each(["ios", "macos"] as const)(
    "only requests calendar access after Connect is chosen in %s Settings",
    async (platform) => {
      initialStorage = { kind: "folder" };
      vi.mocked(nativeSend).mockImplementation((message) => {
        if (
          message.action === "calendarStatus" ||
          message.action === "calendarConnect"
        ) {
          window.dispatchEvent(
            new CustomEvent("daymark-native-message", {
              detail: {
                type: "calendarStatus",
                requestId: message.requestId,
                status:
                  message.action === "calendarConnect"
                    ? "denied"
                    : "notDetermined",
                calendars: [],
              },
            }),
          );
        }
      });
      await mount(platform);
      const before = structuredClone(latest);
      await click(label("Settings")!);
      expect(textButton("Choose workspace folder")).toBeTruthy();
      expect(textButton("Export task data")).toBeTruthy();
      expect(textButton("Connect calendars")).toBeTruthy();
      expect(actionableNativeMessages()).toEqual([]);
      await click(textButton("Connect calendars"));
      expect(actionableNativeMessages()).toEqual([
        {
          action: "calendarConnect",
          requestId: expect.stringMatching(/^calendar:/),
        },
      ]);
      expect(
        document.querySelector(".calendar-settings")?.textContent,
      ).toContain("Allow full calendar access");
      expect(latest).toEqual(before);
      expect(document.querySelector('[role="alert"]')).toBeNull();
    },
  );
});

describe("mobile keyboard dismissal", () => {
  it("offers Done for text entry and blurs the input without discarding its draft", async () => {
    window.__DAYMARK_PLATFORM__ = "ios";
    finishIOSWorkspaceSetup();
    await mount("ios");
    const input = label<HTMLInputElement>("New task title")!;
    await act(async () => {
      input.focus();
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(input, "Draft task");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(label("Dismiss keyboard")).not.toBeNull();
    await click(label("Dismiss keyboard")!);
    expect(document.activeElement).not.toBe(input);
    expect(label("Dismiss keyboard")).toBeNull();
    expect(input.value).toBe("Draft task");
    expect(latest.tasks).toEqual([]);
  });

  it("keeps the desktop UI free of the keyboard control", async () => {
    await mount("macos");
    await act(async () => label<HTMLInputElement>("New task title")!.focus());
    expect(label("Dismiss keyboard")).toBeNull();
  });
});
