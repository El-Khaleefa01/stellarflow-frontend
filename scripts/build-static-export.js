const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const appDirectory = path.resolve(__dirname, "../src/app");
const apiDirectory = path.join(appDirectory, "api");
const privateApiDirectory = path.join(appDirectory, "_api");

if (!fs.existsSync(apiDirectory)) {
  throw new Error(`Expected Next.js API routes at ${apiDirectory}`);
}
if (fs.existsSync(privateApiDirectory)) {
  throw new Error(`Cannot stage static export while ${privateApiDirectory} exists`);
}

// Static S3 exports cannot include Next.js route handlers, so move them out of
// the route tree while generating the export and put them back in a finally block.
fs.renameSync(apiDirectory, privateApiDirectory);

try {
  const npmExec = process.platform === "win32" ? "npx.cmd" : "npx";
  const result = spawnSync(npmExec, ["next", "build", "--webpack"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, NEXT_OUTPUT_MODE: "export" },
    stdio: "inherit",
  });

  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  fs.renameSync(privateApiDirectory, apiDirectory);
}
