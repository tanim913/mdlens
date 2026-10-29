"use strict";
// Without an Apple certificate electron-builder leaves the app unsigned, and Apple Silicon Macs refuse to run
// unsigned code. An ad-hoc signature ("-") is enough for them to start it once the user allows it.
const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async ({ electronPlatformName, appOutDir, packager }) => {
  if (electronPlatformName !== "darwin") return;
  const app = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", app], { stdio: "inherit" });
};
