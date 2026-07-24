import { remote } from "webdriverio";

export type AppiumSessionOptions = {
  appiumPort: number;
  apkPath?: string;
  appPackage?: string;
  appActivity?: string;
};

export async function createSession(opts: AppiumSessionOptions): Promise<WebdriverIO.Browser> {
  const capabilities: Record<string, unknown> = {
    platformName: "Android",
    "appium:automationName": "UiAutomator2",
    "appium:noReset": true
  };

  if (opts.apkPath) {
    capabilities["appium:app"] = opts.apkPath;
  } else if (opts.appPackage) {
    capabilities["appium:appPackage"] = opts.appPackage;
    if (opts.appActivity) capabilities["appium:appActivity"] = opts.appActivity;
  } else {
    throw new Error("Either apkPath or appPackage must be provided to start an Appium session.");
  }

  return remote({
    hostname: "localhost",
    port: opts.appiumPort,
    path: "/",
    capabilities: capabilities as WebdriverIO.Capabilities
  });
}

export async function closeSession(browser: WebdriverIO.Browser): Promise<void> {
  try {
    await browser.deleteSession();
  } catch {
    // Best effort — session may already be gone.
  }
}
