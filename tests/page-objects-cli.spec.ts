import { test, expect } from "@playwright/test";

type CliArgs = {
  app: string;
  dryRun: boolean;
  only?: string;
  overwriteCandidates: boolean;
};

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    app: "default",
    dryRun: false,
    only: undefined,
    overwriteCandidates: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    const nextValue = argv[i + 1];

    if (token === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    if (token === "--overwrite-candidates") {
      args.overwriteCandidates = true;
      continue;
    }
    if (token === "--app") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --app");
      }
      args.app = nextValue;
      i += 1;
      continue;
    }
    if (token === "--only") {
      if (!nextValue || nextValue.startsWith("--")) {
        throw new Error("Missing value for --only");
      }
      args.only = nextValue;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  return args;
}

test("CLI parsea --app", () => {
  const args = parseArgs(["--app", "myapp"]);
  expect(args.app).toBe("myapp");
});

test("CLI parsea --dry-run", () => {
  const args = parseArgs(["--dry-run"]);
  expect(args.dryRun).toBe(true);
});

test("CLI parsea --only", () => {
  const args = parseArgs(["--only", "CategoryPage"]);
  expect(args.only).toBe("CategoryPage");
});

test("CLI parsea --overwrite-candidates", () => {
  const args = parseArgs(["--overwrite-candidates"]);
  expect(args.overwriteCandidates).toBe(true);
});

test("CLI default app es default", () => {
  const args = parseArgs([]);
  expect(args.app).toBe("default");
  expect(args.dryRun).toBe(false);
  expect(args.only).toBeUndefined();
  expect(args.overwriteCandidates).toBe(false);
});

test("CLI parsea flags combinados", () => {
  const args = parseArgs(["--app", "production", "--dry-run", "--only", "HomePage", "--overwrite-candidates"]);
  expect(args.app).toBe("production");
  expect(args.dryRun).toBe(true);
  expect(args.only).toBe("HomePage");
  expect(args.overwriteCandidates).toBe(true);
});

test("CLI rechaza unknown argument", () => {
  expect(() => parseArgs(["--unknown"])).toThrow("Unknown argument");
});

test("CLI --app missing value throws", () => {
  expect(() => parseArgs(["--app"])).toThrow("Missing value");
});

test("CLI --only missing value throws", () => {
  expect(() => parseArgs(["--only"])).toThrow("Missing value");
});
