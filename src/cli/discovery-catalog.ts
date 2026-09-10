import { chromium, firefox, webkit } from "@playwright/test";
import { config } from "../config/env";
import { getLoginStrategy } from "../auth/login-strategy.factory";
import { launchRuntimeBrowserSession } from "../browser/browser-session";
import { discoverProductCatalog } from "../discovery/product-catalog-discovery";
import { persistDiscoveredProducts, loadAppConfig, getRouteProfile } from "../discovery/product-catalog-persistence";
import type { ProductCatalogDiscoveryOptions } from "../discovery/product-catalog-discovery";

type CliArgs = {
  app?: string;
  mode: "representative" | "exhaustive";
  headless: boolean;
  maxProducts: number;
  output?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    mode: "representative",
    headless: true,
    maxProducts: 2,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const nextValue = argv[i + 1];

    if (token === "--app") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --app");
      }
      args.app = nextValue;
      i += 1;
      continue;
    }

    if (token === "--mode") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --mode");
      }
      if (nextValue !== "representative" && nextValue !== "exhaustive") {
        throw new Error("--mode must be 'representative' or 'exhaustive'");
      }
      args.mode = nextValue;
      i += 1;
      continue;
    }

    if (token === "--headed") {
      args.headless = false;
      continue;
    }

    if (token === "--max-products") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --max-products");
      }
      const parsed = parseInt(nextValue, 10);
      if (isNaN(parsed) || parsed < 1) {
        throw new Error("--max-products must be a positive integer");
      }
      args.maxProducts = parsed;
      i += 1;
      continue;
    }

    if (token === "--output") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --output");
      }
      args.output = nextValue;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Resolve app slug from args, env, or default
  const appSlug = args.app || process.env.APP_SLUG || process.env.APP_PROFILE || "default";

  console.log(`[discovery:catalog] app=${appSlug} mode=${args.mode} maxPerCategory=${args.maxProducts}`);

  // Load app config to get route profile
  const appConfig = await loadAppConfig(appSlug, process.cwd());
  const routeProfile = getRouteProfile(appConfig);

  if (!routeProfile) {
    console.log(`[discovery:catalog] warning: no route profile found for ${appSlug}`);
  }

  // Launch browser
  const browserType = { chromium, firefox, webkit }[config.execution.browser];
  const session = await launchRuntimeBrowserSession({
    browserType,
    headless: args.headless,
    targetUrl: appConfig.baseUrl,
    profilePath: config.execution.qaBrowserProfilePath,
    channel: config.execution.qaBrowserChannel,
  });

  try {
    const page = session.page;
    page.setDefaultTimeout(config.execution.defaultTimeoutMs);

    // Login if required
    const loginStrategy = getLoginStrategy(config.app.loginMode);
    await loginStrategy.execute(page, config);

    console.log(`[discovery:catalog] logged in successfully`);

    // Discover products
    const options: ProductCatalogDiscoveryOptions = {
      appSlug,
      routeProfile,
      catalogMode: args.mode,
      maxProductsPerCategory: args.maxProducts,
    };

    const result = await discoverProductCatalog(page, options);

    // Persist to app.config.json
    await persistDiscoveredProducts(appSlug, result, process.cwd());

    // Print summary
    console.log(`\n=== Product Catalog Discovery Summary ===`);
    console.log(`App: ${result.appSlug}`);
    console.log(`URL: ${result.catalogUrl}`);
    console.log(`Total products: ${result.totalProducts}`);
    console.log(`Categories: ${result.categories.length}`);
    console.log(`Representative products: ${result.representativeProducts.length}`);
    console.log(`\nCategories:`);
    for (const category of result.categories) {
      const count = result.products.filter((p) => p.category === category).length;
      const selected = result.representativeProducts.filter((p) => p.category === category).length;
      console.log(`  - ${category}: ${count} products (${selected} selected)`);
    }

    console.log(`\nRepresentative products:`);
    for (const product of result.representativeProducts) {
      console.log(`  - ${product.label}${product.variant ? ` (${product.variant})` : ""}`);
    }

    console.log(`\nPersisted to: automations/apps/${appSlug}/app.config.json`);
    console.log(`Field: routeProfile.targetPaths\n`);

    // Optionally write output JSON
    if (args.output) {
      const fs = await import("node:fs/promises");
      await fs.writeFile(args.output, JSON.stringify(result, null, 2), "utf-8");
      console.log(`Output written to: ${args.output}\n`);
    }
  } finally {
    await session.close();
  }
}

main().catch((err) => {
  console.error(`[discovery:catalog] fatal error: ${err.message}`);
  console.error(err);
  process.exit(1);
});
