import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { activeTasks, emptyDoc } from "../src/model";
import type { AppState, Task } from "../src/model";
import { readBrowser, writeBrowser } from "../src/storage";

const stamp = "2026-09-14T02:00:00.000Z";
const later = "2026-09-14T03:00:00.000Z";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    notes: emptyDoc(),
    projectId: "research",
    columnId: "next",
    doDate: null,
    deadline: null,
    completedAt: null,
    deletedAt: null,
    createdAt: stamp,
    updatedAt: stamp,
    attachments: [],
    ...overrides,
  };
}

function workspace(tasks: Task[]): AppState {
  return {
    schemaVersion: 1,
    tasks,
    projects: [
      { id: "research", name: "Research", color: "#547ce8", updatedAt: stamp },
    ],
    columns: [
      { id: "next", name: "To do", color: "#547ce8", updatedAt: stamp },
    ],
  };
}

beforeEach(async () => {
  // Keep the application's cached connection intact while clearing persisted data.
  await readBrowser();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open("daymark", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const connection = request.result;
      const transaction = connection.transaction("workspace", "readwrite");
      transaction.objectStore("workspace").clear();
      transaction.oncomplete = () => {
        connection.close();
        resolve();
      };
      transaction.onerror = () => {
        connection.close();
        reject(transaction.error);
      };
      transaction.onabort = () => {
        connection.close();
        reject(transaction.error);
      };
    };
  });
});

describe("browser workspace persistence", () => {
  it("keeps tasks created by two stale tabs saving concurrently", async () => {
    const initial = workspace([task("original")]);
    await writeBrowser(initial);
    const tabA = structuredClone(initial);
    const tabB = structuredClone(initial);
    tabA.tasks.push(task("from-tab-a"));
    tabB.tasks.push(task("from-tab-b"));

    const results = await Promise.all([writeBrowser(tabA), writeBrowser(tabB)]);
    const persisted = await readBrowser();

    expect(persisted?.tasks.map((value) => value.id).sort()).toEqual([
      "from-tab-a",
      "from-tab-b",
      "original",
    ]);
    expect(persisted?.projects).toEqual(initial.projects);
    expect(persisted?.columns).toEqual(initial.columns);
    expect(results.every((result) => result.changed)).toBe(true);
    expect(results.some((result) => result.state.tasks.length === 3)).toBe(
      true,
    );
  });

  it("does not resurrect a deleted task when a stale tab later saves unrelated work", async () => {
    const initial = workspace([task("paper")]);
    await writeBrowser(initial);
    await writeBrowser(
      workspace([task("paper", { deletedAt: later, updatedAt: later })]),
    );

    const staleTab = structuredClone(initial);
    staleTab.tasks.push(task("new-work"));
    const result = await writeBrowser(staleTab);
    const persisted = await readBrowser();

    expect(
      result.state.tasks.find((value) => value.id === "paper")?.deletedAt,
    ).toBe(later);
    expect(activeTasks(persisted!).map((value) => value.id)).toEqual([
      "new-work",
    ]);
    expect(persisted).toEqual(result.state);
  });

  it("retains newer rich notes when an older snapshot is saved last", async () => {
    const initial = workspace([task("paper"), task("lecture")]);
    await writeBrowser(initial);
    const notes = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "New proof notes" }],
        },
        { type: "blockMath", attrs: { latex: "\\sum_{i=1}^{n} x_i" } },
      ],
    };
    await writeBrowser(
      workspace([task("paper", { notes, updatedAt: later }), task("lecture")]),
    );
    const staleTab = structuredClone(initial);
    staleTab.tasks[1] = task("lecture", {
      title: "Updated lecture",
      updatedAt: later,
    });

    const result = await writeBrowser(staleTab);
    const persisted = await readBrowser();

    expect(
      result.state.tasks.find((value) => value.id === "paper")?.notes,
    ).toEqual(notes);
    expect(
      persisted?.tasks.find((value) => value.id === "paper")?.notes,
    ).toEqual(notes);
    expect(
      persisted?.tasks.find((value) => value.id === "lecture")?.title,
    ).toBe("Updated lecture");
    expect(staleTab.tasks[0].notes).toEqual(emptyDoc());
  });

  it("reports identical repeated saves as unchanged", async () => {
    const initial = workspace([task("z"), task("a")]);
    expect(await readBrowser()).toBeNull();

    const first = await writeBrowser(initial);
    const second = await writeBrowser(structuredClone(first.state));
    const third = await writeBrowser(structuredClone(second.state));

    expect(first.changed).toBe(true);
    expect(second.changed).toBe(false);
    expect(third.changed).toBe(false);
    expect(await readBrowser()).toEqual(third.state);
  });
});
