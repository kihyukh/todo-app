#!/usr/bin/env node
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";

const directory = process.argv[2];
const native = process.argv[3] === "--native";
if (!directory || process.argv.length > 4 || (process.argv[3] && !native)) {
  console.error(
    "Usage: node scripts/verify-web-release.mjs <built-web-directory> [--native]",
  );
  process.exit(1);
}

// Native builds package a Vite output directory, never a workspace or repo.
// Keep this list explicit when introducing a new kind of bundled runtime asset.
const allowedAsset =
  /-[A-Za-z0-9_-]{8}\.(?:js|mjs|css|woff2?|ttf|otf|pfb|bcmap|wasm|png|jpe?g|webp|svg|gif|avif)$/;
const files = new Set();
let bytes = 0;
try {
  const root = await lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink())
    throw new Error("The web source must be a directory, not a symlink.");
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.name === "index.html" && entry.isFile()) {
      files.add("index.html");
      bytes += (await lstat(filename)).size;
    } else if (entry.name === "assets" && entry.isDirectory()) {
      for (const asset of await readdir(filename, { withFileTypes: true })) {
        if (!asset.isFile() || !allowedAsset.test(asset.name))
          throw new Error(`Unexpected bundled asset: assets/${asset.name}`);
        if (
          native &&
          (/^(?:pdf[.-]|Liberation|Foxit)/i.test(asset.name) ||
            /\.(?:bcmap|pfb|wasm)$/.test(asset.name))
        )
          throw new Error(
            "Native releases use system PDF viewers; rebuild with VITE_NATIVE_APP=1 to exclude browser PDF assets.",
          );
        files.add(`assets/${asset.name}`);
        bytes += (await lstat(path.join(filename, asset.name))).size;
      }
    } else throw new Error(`Unexpected item in the web bundle: ${entry.name}`);
  }
  if (!files.has("index.html"))
    throw new Error("The built index.html is missing.");
  const html = await readFile(path.join(directory, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)];
  if (!scripts.length || /\/@vite\/client|\/src\//.test(html))
    throw new Error("The entry page is not a production web build.");
  const references = [
    ...scripts.map((match) => match[1]),
    ...[...html.matchAll(/<link\b[^>]*\bhref=["']([^"']+)["']/gi)].map(
      (match) => match[1],
    ),
  ];
  for (const reference of references) {
    if (!reference.startsWith("./assets/") || !files.has(reference.slice(2)))
      throw new Error(
        `The entry page references an unbundled resource: ${reference}`,
      );
  }
  console.log(
    `Verified ${files.size} production web files (${(bytes / 1024 / 1024).toFixed(1)} MB); no workspace folders, source maps, or symlinks.`,
  );
} catch (error) {
  console.error(`Web release check failed: ${error.message}`);
  process.exit(1);
}
