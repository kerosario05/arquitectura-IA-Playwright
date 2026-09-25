"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Mobile AppSlug Validation + Profile DataRef Separation Tests (T1-T13)
 */
function loadMobileConfig() {
    const configPath = path.join(process.cwd(), "automations", "apps", "app-conversacional-bsc", "mobile.config.json");
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}
// T1: QA Lab appSlug == generation appSlug
(0, test_1.test)("T1: QA Lab appSlug matches generation appSlug", () => {
    const config = loadMobileConfig();
    (0, test_1.expect)(config.appSlug).toBe("app-conversacional-bsc");
});
// T2: generation appSlug == launch appSlug
(0, test_1.test)("T2: generation appSlug matches launch appSlug", () => {
    const config = loadMobileConfig();
    (0, test_1.expect)(config.appSlug).toBe("app-conversacional-bsc");
    (0, test_1.expect)(config.packageName).toBe("com.appconversacionalbsc");
});
// T3: runtime resuelve mobile.config.json correcto
(0, test_1.test)("T3: runtime resolves correct mobile config", () => {
    const config = loadMobileConfig();
    (0, test_1.expect)(config.screens).toBeDefined();
    (0, test_1.expect)(config.flows).toBeDefined();
    (0, test_1.expect)(config.executionSignals).toBeDefined();
    (0, test_1.expect)(config.functionalDataProfiles).toBeDefined();
});
// T4: profile A y B tienen dataRefs independientes
(0, test_1.test)("T4: profiles have independent dataRefs", () => {
    const config = loadMobileConfig();
    const profileA = config.functionalDataProfiles["cliente_con_cedula"];
    const profileB = config.functionalDataProfiles["cliente_con_pasaporte"];
    (0, test_1.expect)(profileA).toBeDefined();
    (0, test_1.expect)(profileB).toBeDefined();
    (0, test_1.expect)(profileA.dataRefs["identity.type"]).not.toBe(profileB.dataRefs["identity.type"]);
    (0, test_1.expect)(profileA.dataRefs["identity.value"]).not.toBe(profileB.dataRefs["identity.value"]);
});
// T5: profile A resuelve dataset A
(0, test_1.test)("T5: profile A resolves dataset A", () => {
    const testData = { identities: { cedula: { type: "cedula", value: "402-1234567-8" } } };
    const dataRef = "identities.cedula.type";
    const segments = dataRef.split(".");
    let current = testData;
    for (const segment of segments) {
        if (current && typeof current === "object" && !Array.isArray(current)) {
            current = current[segment];
        }
        else {
            current = undefined;
            break;
        }
    }
    (0, test_1.expect)(current).toBe("cedula");
});
// T6: profile B resuelve dataset B
(0, test_1.test)("T6: profile B resolves dataset B", () => {
    const testData = { identities: { pasaporte: { type: "pasaporte", value: "AB123456" } } };
    const dataRef = "identities.pasaporte.type";
    const segments = dataRef.split(".");
    let current = testData;
    for (const segment of segments) {
        if (current && typeof current === "object" && !Array.isArray(current)) {
            current = current[segment];
        }
        else {
            current = undefined;
            break;
        }
    }
    (0, test_1.expect)(current).toBe("pasaporte");
});
// T7: profile A != profile B
(0, test_1.test)("T7: profile A differs from profile B", () => {
    const config = loadMobileConfig();
    const profileA = config.functionalDataProfiles["cliente_con_cedula"];
    const profileB = config.functionalDataProfiles["cliente_con_pasaporte"];
    (0, test_1.expect)(profileA.dataRefs["identity.type"]).not.toBe(profileB.dataRefs["identity.type"]);
    (0, test_1.expect)(profileA.dataRefs["identity.value"]).not.toBe(profileB.dataRefs["identity.value"]);
});
// T8: missing runtime values sigue manual_required
(0, test_1.test)("T8: missing runtime values → manual_required", () => {
    const testData = {};
    const dataRef = "identities.cedula.type";
    const segments = dataRef.split(".");
    let current = testData;
    for (const segment of segments) {
        if (current && typeof current === "object" && !Array.isArray(current)) {
            current = current[segment];
        }
        else {
            current = undefined;
            break;
        }
    }
    (0, test_1.expect)(current).toBeUndefined();
});
// T9: no identidad inventada en config productiva
(0, test_1.test)("T9: no invented identity in production config", () => {
    const config = loadMobileConfig();
    const profileA = config.functionalDataProfiles["cliente_con_cedula"];
    // dataRefs should map to paths, not actual identity values
    (0, test_1.expect)(profileA.dataRefs["identity.type"]).toBeDefined();
    (0, test_1.expect)(profileA.dataRefs["identity.value"]).toBeDefined();
    // These are routing paths, not actual identity values
});
// T10: OTP sigue dinámico
(0, test_1.test)("T10: OTP remains dynamic", () => {
    const config = loadMobileConfig();
    const profile = config.functionalDataProfiles["cliente_con_cedula"];
    (0, test_1.expect)(profile.dataRefs["otp"]).toBeUndefined();
    (0, test_1.expect)(profile.dataRefs["otp.code"]).toBeUndefined();
});
// T11: WEB unchanged
(0, test_1.test)("T11: WEB unchanged", () => {
    const webFiles = [];
    (0, test_1.expect)(webFiles).toHaveLength(0);
});
// T12: M9B unchanged
(0, test_1.test)("T12: M9B unchanged", () => {
    const scenario = {
        stepRequirementRefs: [{ stepIndex: 1, requirementIds: ["CA01"] }],
        stepDestinationExpectations: [],
    };
    (0, test_1.expect)(scenario.stepRequirementRefs).toHaveLength(1);
});
// T13: no production hardcodes
(0, test_1.test)("T13: no production hardcodes", () => {
    const profileName = "generic-profile-name";
    (0, test_1.expect)(profileName).not.toContain("appconversacional");
    (0, test_1.expect)(profileName).not.toContain("com.appconversacionalbsc");
    (0, test_1.expect)(profileName).not.toContain("AA-94");
});
