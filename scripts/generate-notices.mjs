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
let includedPackages = 0;
for (const [location, item] of entries) {
  // PDF.js's optional Node canvas binaries are not shipped in the web bundle
  // or either WKWebView app. Their platform packages also omit license files.
  if (item.optional && /^node_modules\/@napi-rs\/canvas(?:-|$)/.test(location))
    continue;
  const directory = path.join(root, location);
  let metadata;
  try {
    metadata = JSON.parse(
      await readFile(path.join(directory, "package.json"), "utf8"),
    );
  } catch (error) {
    // npm records optional binaries for every platform in the lockfile, but
    // only installs the current platform's package.
    if (item.optional && error.code === "ENOENT") continue;
    throw error;
  }
  const noticeDirectories =
    metadata.name === "pdfjs-dist"
      ? ["", "cmaps", "standard_fonts", "wasm"]
      : [""];
  const notices = [];
  for (const subdirectory of noticeDirectories) {
    const noticeDirectory = path.join(directory, subdirectory);
    const names = (await readdir(noticeDirectory))
      .filter((name) => /^(licen[sc]e|copying|notice)([._-].*)?$/i.test(name))
      .sort();
    for (const name of names) {
      if ((await stat(path.join(noticeDirectory, name))).isFile()) {
        const text = (await readFile(path.join(noticeDirectory, name), "utf8"))
          .trim()
          .replace(/[\t ]+$/gm, "");
        notices.push(
          subdirectory ? `${subdirectory}/${name}\n\n${text}` : text,
        );
      }
    }
  }
  if (!notices.length)
    throw new Error(`Missing license notice for ${metadata.name}`);
  sections.push(
    `${metadata.name} ${item.version}\n${"=".repeat(60)}\n\n${notices.join("\n\n")}`,
  );
  includedPackages += 1;
}
await writeFile(
  path.join(root, "src/third-party-notices.txt"),
  sections.join("\n\n") + "\n",
);
console.log(
  `Prepared license notices for ${includedPackages} runtime packages.`,
);
