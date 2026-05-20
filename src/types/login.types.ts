import type { Page } from "@playwright/test";
import type { FullConfig } from "./env.types";

export type LoginStrategy = {
  name: string;
  execute(page: Page, config: FullConfig): Promise<void>;
};
