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
  finishMacWorkspaceSetup,
  needsIOSWorkspaceSetup,
} from "../src/platform";
import { nativeSend } from "../src/storage";
import { isWindowDragTarget } from "../src/window-drag";

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

describe("sandboxed Mac workspace setup", () => {
  it("explains explicit adoption of the existing iCloud folder without changing tasks", async () => {
    initialStorage = {
      kind: "local",
      sandboxed: true,
      needsFolderSelection: true,
    };
    await mount("macos");
    const setup = onboarding()!;
    expect(setup).not.toBeNull();
    expect(setup.textContent).toContain("GreenDay or Daymark");
    expect(setup.textContent).toContain("iCloud Drive");
    expect(setup.textContent).toContain(
      "new tasks stay in this app on your Mac",
    );
    expect(actionableNativeMessages()).toEqual([]);
    expect(document.activeElement).toBe(textButton("Choose workspace folder"));
    await click(textButton("Choose workspace folder"));
    expect(actionableNativeMessages()).toEqual([{ action: "chooseFolder" }]);
    expect(onboarding()).not.toBeNull();
    await act(async () =>
      changeStorage({
        kind: "folder",
        sandboxed: true,
        needsFolderSelection: false,
      }),
    );
    expect(onboarding()).toBeNull();
    expect(latest).toEqual(initial);
  });

  it("remembers a local Mac choice without changing the iPhone setup preference", async () => {
    initialStorage = {
      kind: "local",
      sandboxed: true,
      needsFolderSelection: true,
    };
    await mount("macos");
    await click(textButton("Continue on this Mac"));
    expect(onboarding()).toBeNull();
    expect(actionableNativeMessages()).toEqual([]);
    expect(localStorage.getItem("daymark.ios.workspace-setup.v1")).toBeNull();
    await act(async () => root!.unmount());
    root = undefined;
    document.body.replaceChildren();
    await mount("macos");
    expect(onboarding()).toBeNull();
    expect(latest).toEqual(initial);
  });

  it("prompts to reconnect an unavailable bookmark even after setup, and preserves retries", async () => {
    finishMacWorkspaceSetup();
    initialStorage = {
      kind: "local",
      sandboxed: true,
      needsFolderSelection: true,
      reconnectRequired: true,
      message: "Choose your previous folder again.",
    };
    await mount("macos");
    expect(onboarding()!.textContent).toContain("Reconnect your workspace");
    expect(onboarding()!.textContent).toContain("not been moved or deleted");
    await click(textButton("Choose workspace folder"));
    await act(async () =>
      changeError("The folder is unavailable. Please try again."),
    );
    expect(
      onboarding()!.querySelector('[role="alert"]')?.textContent,
    ).toContain("folder is unavailable");
    await click(textButton("Choose workspace folder"));
    expect(onboarding()!.querySelector('[role="alert"]')).toBeNull();
    expect(actionableNativeMessages()).toEqual([
      { action: "chooseFolder" },
      { action: "chooseFolder" },
    ]);
    await click(textButton("Continue on this Mac"));
    expect(onboarding()).toBeNull();
    expect(latest).toEqual(initial);
  });

  it("opens a restored sandbox workspace without asking to adopt it again", async () => {
    initialStorage = {
      kind: "folder",
      sandboxed: true,
      needsFolderSelection: false,
    };
    await mount("macos");
    expect(onboarding()).toBeNull();
    expect(actionableNativeMessages()).toEqual([]);
  });
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

describe("Mac window dragging", () => {
  function mouseDown(element: Element) {
    const event = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: 1,
      clientX: 220,
      clientY: 36,
      detail: 1,
    });
    act(() => {
      element.dispatchEvent(event);
    });
    return event;
  }

  it("moves the native Mac window from top headers while keeping body space and controls untouched", async () => {
    const stamp = "2026-09-15T00:00:00.000Z";
    initialState = {
      ...initial,
      tasks: [
        {
          id: "drag-check",
          title: "Window drag check",
          notes: emptyDoc(),
          projectId: "",
          columnId: "next",
          doDate: dateKey(),
          deadline: null,
          completedAt: null,
          deletedAt: null,
          createdAt: stamp,
          updatedAt: stamp,
          attachments: [],
        },
      ],
    };
    const app = await mount("macos");
    await click(app.querySelector<HTMLElement>(".task-content")!);
    const before = structuredClone(latest);
    vi.mocked(nativeSend).mockClear();
    for (const selector of [
      ".sidebar-window-drag",
      ".workspace-top",
      ".workspace-header",
      ".detail-top",
    ]) {
      const header = app.querySelector(selector)!;
      expect(header, selector).not.toBeNull();
      expect(isWindowDragTarget(header), selector).toBe(true);
      expect(mouseDown(header).defaultPrevented, selector).toBe(true);
    }
    expect(actionableNativeMessages()).toEqual(
      Array.from({ length: 4 }, () => ({
        action: "dragWindow",
        x: 220,
        y: 36,
        clickCount: 1,
      })),
    );
    vi.mocked(nativeSend).mockClear();
    for (const selector of [
      ".sidebar",
      ".sidebar-collections",
      ".workspace",
      ".task-scroll",
      ".task-row",
      ".detail",
      ".detail-scroll",
      ".detail-footer",
      ".detail-top button",
      ".workspace-header button",
      ".search input",
      '[aria-label="Task notes"]',
    ]) {
      const area = app.querySelector(selector)!;
      expect(area, selector).not.toBeNull();
      expect(isWindowDragTarget(area), selector).toBe(false);
      expect(mouseDown(area).defaultPrevented, selector).toBe(false);
    }
    expect(actionableNativeMessages()).toEqual([]);
    expect(latest).toEqual(before);
  });

  it.each([undefined, "ios"] as const)(
    "leaves header mouse gestures alone on %s",
    async (platform) => {
      if (platform === "ios") {
        window.__DAYMARK_PLATFORM__ = "ios";
        finishIOSWorkspaceSetup();
      }
      const app = await mount(platform);
      expect(app.querySelector(".sidebar-window-drag")).toBeNull();
      vi.mocked(nativeSend).mockClear();
      for (const selector of [".workspace-top", ".workspace-header"]) {
        const header = app.querySelector(selector)!;
        expect(header).not.toBeNull();
        expect(mouseDown(header).defaultPrevented).toBe(false);
      }
      expect(actionableNativeMessages()).toEqual([]);
    },
  );
});
