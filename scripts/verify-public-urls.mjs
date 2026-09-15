#!/usr/bin/env node
for (const key of ["VITE_PUBLIC_PRIVACY_URL", "VITE_PUBLIC_SUPPORT_URL"]) {
  const value = process.env[key] ?? "";
  let valid = false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    valid =
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      hostname.includes(".") &&
      !/__|<|>|\s/.test(value) &&
      !/(?:^|\.)(?:localhost|local|test|invalid|example)$/.test(hostname) &&
      !/(?:^|\.)example\.(?:com|org|net)$/.test(hostname) &&
      !/^(?:0|10|127|169\.254|192\.168|172\.(?:1[6-9]|2[0-9]|3[01]))\./.test(
        hostname,
      );
  } catch {
    // A release must carry real publisher URLs, not development placeholders.
  }
  if (!valid) {
    console.error(
      `Set ${key} to the published, publicly accessible HTTPS page. Placeholder and local URLs are not valid for a store release.`,
    );
    process.exit(1);
  }
}
console.log(
  "Public privacy and support URL formats are valid; verify both published pages before submission.",
);
