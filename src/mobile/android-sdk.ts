import * as path from "node:path";
import * as fs from "node:fs";
import { config } from "../config/env";

export type AndroidSdkPaths = {
  sdkHome: string;
  adbPath: string;
  emulatorPath: string;
};

export function resolveAndroidSdk(): AndroidSdkPaths {
  const sdkHome = config.integrations.android?.sdkHome;
  if (!sdkHome) {
    throw new Error(
      "Missing ANDROID_HOME or ANDROID_SDK_ROOT environment variable. Set it to your Android SDK path (e.g. ~/Library/Android/sdk)."
    );
  }
  if (!fs.existsSync(sdkHome)) {
    throw new Error(`ANDROID_HOME/ANDROID_SDK_ROOT points to a path that does not exist: ${sdkHome}`);
  }

  const platform = process.platform === "win32" ? "win32" : "posix";
  const adbPath = platform === "win32"
    ? path.join(sdkHome, "platform-tools", "adb.exe")
    : path.join(sdkHome, "platform-tools", "adb");
  const emulatorPath = platform === "win32"
    ? path.join(sdkHome, "emulator", "emulator.exe")
    : path.join(sdkHome, "emulator", "emulator");

  if (!fs.existsSync(adbPath)) {
    throw new Error(`adb binary not found at expected path: ${adbPath}`);
  }
  if (!fs.existsSync(emulatorPath)) {
    throw new Error(`emulator binary not found at expected path: ${emulatorPath}`);
  }

  return { sdkHome, adbPath, emulatorPath };
}
