import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const lock = JSON.parse(
  await readFile(path.join(root, "package-lock.json"), "utf8"),
);
const entries = Object.entries(lock.packages)
  .filter(([location, item]) => location && !item.dev)
  .sort(([a], [b]) => a.localeCompare(b, "en"));
const sections = [
  "Open source notices",
  "This app is built with the following open source packages. Some listed packages support other included packages. Their license notices follow.",
];
for (const [location, item] of entries) {
  const directory = path.join(root, location);
  const metadata = JSON.parse(
    await readFile(path.join(directory, "package.json"), "utf8"),
  );
  const names = (await readdir(directory))
    .filter((name) => /^(licen[sc]e|copying|notice)([.-].*)?$/i.test(name))
    .sort();
  const notices = [];
  for (const name of names) {
    if ((await stat(path.join(directory, name))).isFile()) {
      notices.push((await readFile(path.join(directory, name), "utf8")).trim());
    }
  }
  if (!notices.length)
    throw new Error(`Missing license notice for ${metadata.name}`);
  sections.push(
    `${metadata.name} ${item.version}\n${"=".repeat(60)}\n\n${notices.join("\n\n")}`,
  );
}
await writeFile(
  path.join(root, "src/third-party-notices.txt"),
  sections.join("\n\n") + "\n",
);
console.log(`Prepared license notices for ${entries.length} runtime packages.`);
