import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { resolve, join } from "node:path";
import { JSDOM } from "jsdom";
import { convertTickTick } from "../../src/migrations/ticktick";

const [snapshotFolder, planFile, outputFolder] = process.argv.slice(2);
if (!snapshotFolder || !planFile || !outputFolder) {
  throw new Error(
    "Usage: prepare-ticktick SNAPSHOT_FOLDER PLAN_JSON PRIVATE_OUTPUT_FOLDER",
  );
}
const output = resolve(outputFolder);
const repository = resolve(import.meta.dirname, ".."); // Compiled entry lives in build/.
if (output === repository || output.startsWith(repository + "/")) {
  throw new Error("Keep personal migration data outside the source repository");
}
try {
  await access(join(output, "state.json"));
  throw new Error(
    "Output already contains a staged migration; choose a fresh folder",
  );
} catch (error: any) {
  if (error.code !== "ENOENT") throw error;
}
const json = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const [normalized, snapshot, inventory, plan] = await Promise.all([
  json(join(snapshotFolder, "ticktick-normalized-tasks.json")),
  json(join(snapshotFolder, "ticktick-task-snapshot.json")),
  json(join(snapshotFolder, "attachment-inventory.json")),
  json(planFile),
]);
const dom = new JSDOM("<!doctype html><html><body></body></html>");
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
});
const result = convertTickTick(
  normalized.tasks,
  snapshot.tables.ZTTCHECKLISTITEM,
  inventory,
  plan,
);
await mkdir(output, { recursive: true, mode: 0o700 });
for (const [name, data] of [
  ["state", result.state],
  ["attachments", result.attachments],
] as const) {
  await writeFile(
    join(output, name + ".json"),
    JSON.stringify(data, null, 2) + "\n",
    { mode: 0o600 },
  );
}
console.log(
  JSON.stringify({
    output,
    tasks: result.state.tasks.length,
    active: result.state.tasks.filter(
      (task) => !task.completedAt && !task.deletedAt,
    ).length,
    completed: result.state.tasks.filter(
      (task) => task.completedAt && !task.deletedAt,
    ).length,
    trash: result.state.tasks.filter((task) => task.deletedAt).length,
    attachments: result.attachments.length,
    tags: result.state.tags?.length,
  }),
);
