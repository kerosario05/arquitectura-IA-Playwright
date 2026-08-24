export type PromotedBrowserMode = "config" | "headed" | "headless";

export type PromotedBrowserModeResolution = {
  mode: PromotedBrowserMode;
  source: string;
};

type ResolvePromotedBrowserModeInput = {
  headedFlag: boolean;
  headlessFlag: boolean;
  automationHeadless?: string;
  automationSource?: string;
};

type ApplyBrowserModeInput = {
  baseEnv: NodeJS.ProcessEnv;
  playwrightArgs: string[];
  browserMode: PromotedBrowserModeResolution;
};

function parseBoolean(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "true";
}

export function resolvePromotedBrowserMode(
  input: ResolvePromotedBrowserModeInput,
): PromotedBrowserModeResolution {
  if (input.headedFlag) {
    return { mode: "headed", source: "explicit_cli_flag" };
  }
  if (input.headlessFlag) {
    return { mode: "headless", source: "explicit_cli_flag" };
  }
  if (parseBoolean(input.automationHeadless)) {
    return {
      mode: "headless",
      source: input.automationSource?.trim() || "qa_lab_automatic",
    };
  }
  return { mode: "config", source: "default_config" };
}

export function applyPromotedBrowserMode(
  input: ApplyBrowserModeInput,
): {
  playwrightArgs: string[];
  playwrightEnv: NodeJS.ProcessEnv;
} {
  const playwrightArgs = [...input.playwrightArgs];
  const playwrightEnv: NodeJS.ProcessEnv = {
    ...(input.baseEnv as NodeJS.ProcessEnv),
  };

  if (input.browserMode.mode === "headed") {
    playwrightArgs.push("--headed");
    playwrightEnv.HEADLESS = "false";
    return { playwrightArgs, playwrightEnv };
  }

  if (input.browserMode.mode === "headless") {
    // Playwright Test CLI has --headed but no --headless; force through env/config contract.
    playwrightEnv.HEADLESS = "true";
    delete playwrightEnv.PWDEBUG;
  }

  return { playwrightArgs, playwrightEnv };
}
