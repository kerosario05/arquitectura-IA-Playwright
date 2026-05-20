import { manualLoginStrategy } from "./manual-login.strategy";
import { noLoginStrategy } from "./no-login.strategy";
import { passwordLoginStrategy } from "./password-login.strategy";
import type { LoginMode } from "../types/env.types";
import type { LoginStrategy } from "../types/login.types";

export function getLoginStrategy(loginMode: LoginMode): LoginStrategy {
  switch (loginMode) {
    case "password":
      return passwordLoginStrategy;
    case "no_login":
      return noLoginStrategy;
    case "manual":
      return manualLoginStrategy;
    default:
      throw new Error(`Unsupported login mode: ${loginMode}`);
  }
}
