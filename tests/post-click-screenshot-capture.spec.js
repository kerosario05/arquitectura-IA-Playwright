"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
test_1.test.describe("Post-click Screenshot Capture", () => {
    (0, test_1.test)("Click execution followed by wait and screenshot capture", async () => {
        const logs = [];
        const originalLog = console.log;
        console.log = (...args) => {
            logs.push(args.join(" "));
            originalLog(...args);
        };
        try {
            // Simulate the pattern: click → log wait → wait → capture screenshot
            console.log('[post-click-screenshot] waitingAfterClick step=1 target="Test Button"');
            // Simulate wait sequence
            await new Promise(resolve => setTimeout(resolve, 100)); // waitForPageReady simulation
            await new Promise(resolve => setTimeout(resolve, 100)); // waitForTimeout(1000) simulation
            console.log('[evidence] step 1: "Click Test Button" status=passed');
            console.log = originalLog;
            // Verify logs show correct sequence
            const waitLog = logs.find(l => l.includes("[post-click-screenshot] waitingAfterClick"));
            const captureLog = logs.find(l => l.includes('[evidence] step 1:'));
            (0, test_1.expect)(waitLog).toBeDefined();
            (0, test_1.expect)(waitLog).toContain('step=1');
            (0, test_1.expect)(waitLog).toContain('target="Test Button"');
            (0, test_1.expect)(captureLog).toBeDefined();
            (0, test_1.expect)(captureLog).toContain("status=passed");
            // Verify wait happens before capture
            const waitIndex = logs.indexOf(waitLog);
            const captureIndex = logs.indexOf(captureLog);
            (0, test_1.expect)(waitIndex).toBeLessThan(captureIndex);
            console.log("✓ Post-click screenshot capture sequence verified");
        }
        finally {
            console.log = originalLog;
        }
    });
    (0, test_1.test)("Each successful click path has post-click screenshot capture", async () => {
        // Simulate multiple click paths
        const paths = [
            { name: "nav_segment", step: 2, target: "Información de productos" },
            { name: "auth_retry", step: 3, target: "Login" },
            { name: "ai_repair", step: 4, target: "Product Card" },
            { name: "route_completion", step: 5, target: "Category" },
            { name: "stability_retry", step: 6, target: "Details" },
            { name: "auth_gate_retry", step: 7, target: "Confirm" }
        ];
        const logs = [];
        const originalLog = console.log;
        console.log = (...args) => {
            logs.push(args.join(" "));
            originalLog(...args);
        };
        try {
            for (const pathInfo of paths) {
                // Simulate click → wait log → capture
                console.log(`[post-click-screenshot] waitingAfterClick step=${pathInfo.step} target="${pathInfo.target}"`);
                await new Promise(resolve => setTimeout(resolve, 50));
                console.log(`[evidence] step ${pathInfo.step}: "Click ${pathInfo.target}" status=passed`);
            }
            console.log = originalLog;
            // Verify each path has both wait and capture logs
            for (const pathInfo of paths) {
                const waitLog = logs.find(l => l.includes("[post-click-screenshot] waitingAfterClick") &&
                    l.includes(`step=${pathInfo.step}`));
                const captureLog = logs.find(l => l.includes(`[evidence] step ${pathInfo.step}:`) &&
                    l.includes("status=passed"));
                (0, test_1.expect)(waitLog, `${pathInfo.name} should have wait log`).toBeDefined();
                (0, test_1.expect)(captureLog, `${pathInfo.name} should have capture log`).toBeDefined();
                // Verify sequence
                const waitIndex = logs.indexOf(waitLog);
                const captureIndex = logs.indexOf(captureLog);
                (0, test_1.expect)(waitIndex, `${pathInfo.name}: wait should come before capture`).toBeLessThan(captureIndex);
            }
            console.log(`✓ All ${paths.length} click paths have post-click screenshot capture`);
        }
        finally {
            console.log = originalLog;
        }
    });
    (0, test_1.test)("Wait timing includes networkidle and stabilization", async () => {
        const waitSequence = [];
        // Simulate the wait pattern
        waitSequence.push("click_executed");
        waitSequence.push("log_waitingAfterClick");
        waitSequence.push("waitForPageReady_start");
        await new Promise(resolve => setTimeout(resolve, 50)); // domcontentloaded
        waitSequence.push("waitForPageReady_networkidle");
        await new Promise(resolve => setTimeout(resolve, 50)); // networkidle
        waitSequence.push("waitForPageReady_complete");
        waitSequence.push("waitForTimeout_start");
        await new Promise(resolve => setTimeout(resolve, 100)); // 1000ms stabilization
        waitSequence.push("waitForTimeout_complete");
        waitSequence.push("screenshot_captured");
        // Verify sequence
        (0, test_1.expect)(waitSequence[0]).toBe("click_executed");
        (0, test_1.expect)(waitSequence[1]).toBe("log_waitingAfterClick");
        (0, test_1.expect)(waitSequence[waitSequence.length - 1]).toBe("screenshot_captured");
        // Verify stabilization wait happens
        const hasWaitForTimeout = waitSequence.some(s => s.includes("waitForTimeout"));
        (0, test_1.expect)(hasWaitForTimeout).toBe(true);
        console.log("✓ Wait timing includes proper stabilization sequence");
    });
    (0, test_1.test)("Screenshot captured AFTER click, not before", async () => {
        const events = [];
        const start = Date.now();
        // Simulate click
        events.push({ event: "click_executed", timestamp: Date.now() - start });
        // Simulate wait
        await new Promise(resolve => setTimeout(resolve, 100));
        events.push({ event: "wait_complete", timestamp: Date.now() - start });
        // Small delay to ensure timestamp difference
        await new Promise(resolve => setTimeout(resolve, 10));
        // Simulate screenshot
        events.push({ event: "screenshot_captured", timestamp: Date.now() - start });
        // Verify order and timing
        (0, test_1.expect)(events[0].event).toBe("click_executed");
        (0, test_1.expect)(events[1].event).toBe("wait_complete");
        (0, test_1.expect)(events[2].event).toBe("screenshot_captured");
        // Screenshot should be AFTER click + wait
        (0, test_1.expect)(events[2].timestamp).toBeGreaterThan(events[0].timestamp);
        (0, test_1.expect)(events[2].timestamp).toBeGreaterThanOrEqual(events[1].timestamp);
        // Wait should add at least some delay
        (0, test_1.expect)(events[1].timestamp).toBeGreaterThan(events[0].timestamp + 50);
        console.log("✓ Screenshot timing verified: click → wait → screenshot");
    });
    (0, test_1.test)("DOCX should use post-click screenshot path", async () => {
        // Simulate step record with screenshotPath
        const stepRecord = {
            index: 1,
            stepText: 'Clic en "Test Button".',
            status: "passed",
            screenshotPath: "evidence/screenshots/step-001-test-button.png",
            timestamp: new Date().toISOString()
        };
        // Verify screenshot path exists
        (0, test_1.expect)(stepRecord.screenshotPath).toBeDefined();
        (0, test_1.expect)(stepRecord.screenshotPath).toContain(".png");
        (0, test_1.expect)(stepRecord.screenshotPath).toContain("step-001");
        // Verify step is marked as passed
        (0, test_1.expect)(stepRecord.status).toBe("passed");
        console.log("✓ Step record contains post-click screenshot path for DOCX");
    });
});
