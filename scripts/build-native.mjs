import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const projectPath = path.join(rootDir, "native", "Nightowl.Native", "Nightowl.Native.csproj");
const outputDir = path.join(rootDir, "native", "bin");

function hasDotnet9Sdk(dotnetBin) {
  try {
    const out = execFileSync(dotnetBin, ["--list-sdks"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return /^9\./m.test(out);
  } catch {
    return false;
  }
}

function resolveDotnetBinary() {
  const candidates = [];
  if (process.env.DOTNET_BIN) {
    candidates.push(process.env.DOTNET_BIN);
  }
  candidates.push("dotnet");

  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    candidates.push(path.join(localAppData, "Microsoft", "dotnet", "dotnet.exe"));
  }
  const userProfile = process.env.USERPROFILE;
  if (userProfile) {
    candidates.push(path.join(userProfile, ".dotnet", "dotnet.exe"));
  }
  candidates.push("C:\\Program Files\\dotnet\\dotnet.exe");

  for (const bin of candidates) {
    if (bin !== "dotnet" && !fs.existsSync(bin)) continue;
    if (hasDotnet9Sdk(bin)) {
      return bin;
    }
  }

  throw new Error(
    "Could not locate a .NET 9 SDK (`dotnet --list-sdks` did not report 9.x). Install .NET 9 SDK or set DOTNET_BIN."
  );
}

const dotnetBin = resolveDotnetBinary();
const selfContained = process.argv.includes("--self-contained");

fs.rmSync(outputDir, { recursive: true, force: true });
fs.mkdirSync(outputDir, { recursive: true });

const args = selfContained
  ? [
      "publish",
      projectPath,
      "-c",
      "Release",
      "-r",
      "win-x64",
      "--self-contained",
      "true",
      "-p:PublishSingleFile=true",
      "-p:IncludeNativeLibrariesForSelfExtract=true",
      "-p:DebugType=None",
      "-p:DebugSymbols=false",
      "-o",
      outputDir,
    ]
  : ["build", projectPath, "-c", "Release", "-o", outputDir];

console.log(`[build-native] Using ${dotnetBin}`);
console.log(`[build-native] Mode: ${selfContained ? "self-contained single-file (win-x64)" : "local release build"}`);

const res = spawnSync(dotnetBin, args, { stdio: "inherit", cwd: rootDir });
if (res.status !== 0) {
  process.exit(res.status ?? 1);
}
