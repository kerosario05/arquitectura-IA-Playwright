"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
function parseArgs(argv) {
    const args = {
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
(0, test_1.test)("CLI parsea --app", () => {
    const args = parseArgs(["--app", "myapp"]);
    (0, test_1.expect)(args.app).toBe("myapp");
});
(0, test_1.test)("CLI parsea --dry-run", () => {
    const args = parseArgs(["--dry-run"]);
    (0, test_1.expect)(args.dryRun).toBe(true);
});
(0, test_1.test)("CLI parsea --only", () => {
    const args = parseArgs(["--only", "CategoryPage"]);
    (0, test_1.expect)(args.only).toBe("CategoryPage");
});
(0, test_1.test)("CLI parsea --overwrite-candidates", () => {
    const args = parseArgs(["--overwrite-candidates"]);
    (0, test_1.expect)(args.overwriteCandidates).toBe(true);
});
(0, test_1.test)("CLI default app es default", () => {
    const args = parseArgs([]);
    (0, test_1.expect)(args.app).toBe("default");
    (0, test_1.expect)(args.dryRun).toBe(false);
    (0, test_1.expect)(args.only).toBeUndefined();
    (0, test_1.expect)(args.overwriteCandidates).toBe(false);
});
(0, test_1.test)("CLI parsea flags combinados", () => {
    const args = parseArgs(["--app", "production", "--dry-run", "--only", "HomePage", "--overwrite-candidates"]);
    (0, test_1.expect)(args.app).toBe("production");
    (0, test_1.expect)(args.dryRun).toBe(true);
    (0, test_1.expect)(args.only).toBe("HomePage");
    (0, test_1.expect)(args.overwriteCandidates).toBe(true);
});
(0, test_1.test)("CLI rechaza unknown argument", () => {
    (0, test_1.expect)(() => parseArgs(["--unknown"])).toThrow("Unknown argument");
});
(0, test_1.test)("CLI --app missing value throws", () => {
    (0, test_1.expect)(() => parseArgs(["--app"])).toThrow("Missing value");
});
(0, test_1.test)("CLI --only missing value throws", () => {
    (0, test_1.expect)(() => parseArgs(["--only"])).toThrow("Missing value");
});
