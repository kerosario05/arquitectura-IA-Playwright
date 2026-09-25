"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const registry_1 = require("../registry");
const action_registry_1 = require("../registry/action-registry");
function parseRegistryPath(argv) {
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === "--registry") {
            const value = argv[i + 1];
            if (!value || value.startsWith("--")) {
                throw new Error("Missing value for --registry");
            }
            return value;
        }
    }
    return undefined;
}
function countBy(items, keySelector) {
    const result = {};
    for (const item of items) {
        const key = keySelector(item);
        result[key] = (result[key] ?? 0) + 1;
    }
    return result;
}
async function main() {
    const registryPath = parseRegistryPath(process.argv.slice(2));
    const registry = await (0, registry_1.loadObjectRegistry)(registryPath);
    const validation = (0, registry_1.validateObjectRegistry)(registry);
    const byType = countBy(registry.objects, (item) => item.type);
    const byStrategy = countBy(registry.objects, (item) => item.locator.strategy);
    const warnings = validation.issues.filter((issue) => issue.level === "warning");
    console.log("Registry inspection");
    console.log("-------------------");
    console.log(`Version: ${registry.version}`);
    console.log(`App name: ${registry.appName ?? "n/a"}`);
    console.log(`Objects: ${registry.objects.length}`);
    console.log("Objects by type:");
    for (const [type, count] of Object.entries(byType)) {
        console.log(`- ${type}: ${count}`);
    }
    if (Object.keys(byType).length === 0) {
        console.log("- none");
    }
    console.log("Locator strategies:");
    for (const [strategy, count] of Object.entries(byStrategy)) {
        console.log(`- ${strategy}: ${count}`);
    }
    if (Object.keys(byStrategy).length === 0) {
        console.log("- none");
    }
    console.log(`Warnings: ${warnings.length}`);
    for (const warning of warnings) {
        console.log(`- ${warning.code}: ${warning.message}${warning.objectKey ? ` (${warning.objectKey})` : ""}`);
    }
    console.log(`Supported actions (${action_registry_1.actionRegistry.version}):`);
    console.log(`- ${(0, action_registry_1.listSupportedActions)().join(", ")}`);
}
main()
    .then(() => {
    process.exitCode = 0;
})
    .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[registry:inspect] ${message}`);
    process.exitCode = 1;
});
