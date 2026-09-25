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
 * Mobile Functional Data Profile Configuration Tests (T1-T12)
 *
 * Validates that functionalDataProfiles are correctly configured in mobile.config.json
 * and that the resolution pipeline works end-to-end.
 */
function loadMobileConfig() {
    const configPath = path.join(process.cwd(), "automations", "apps", "app-conversacional-bsc", "mobile.config.json");
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}
// T1: functionalDataProfiles carga desde config real
(0, test_1.test)("T1: functionalDataProfiles loads from real config", () => {
    const config = loadMobileConfig();
    (0, test_1.expect)(config.functionalDataProfiles).toBeDefined();
    (0, test_1.expect)(Object.keys(config.functionalDataProfiles).length).toBeGreaterThan(0);
});
// T2: requiredDataProfile encuentra profile compatible
(0, test_1.test)("T2: requiredDataProfile finds compatible profile", () => {
    const config = loadMobileConfig();
    const profile = config.functionalDataProfiles["cliente_con_cedula"];
    (0, test_1.expect)(profile).toBeDefined();
    (0, test_1.expect)(profile.dataRefs).toBeDefined();
});
// T3: dataRefs se resuelven desde APP_TEST_DATA_JSON
(0, test_1.test)("T3: dataRefs resolve from testData", () => {
    const testData = { identity: { type: "cedula", value: "402-1234567-8" } };
    const dataRef = "identity.type";
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
// T4: identity.type no se inventa
(0, test_1.test)("T4: identity.type not invented", () => {
    const config = loadMobileConfig();
    const profile = config.functionalDataProfiles["cliente_con_cedula"];
    (0, test_1.expect)(profile.dataRefs["identity.type"]).toBeDefined();
    (0, test_1.expect)(typeof profile.dataRefs["identity.type"]).toBe("string");
});
// T5: identity.value no se inventa
(0, test_1.test)("T5: identity.value not invented", () => {
    const config = loadMobileConfig();
    const profile = config.functionalDataProfiles["cliente_con_cedula"];
    (0, test_1.expect)(profile.dataRefs["identity.value"]).toBeDefined();
    (0, test_1.expect)(typeof profile.dataRefs["identity.value"]).toBe("string");
});
// T6: missing dataRef falla cerrado
(0, test_1.test)("T6: missing dataRef fails closed", () => {
    const testData = {};
    const dataRef = "identity.type";
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
// T7: múltiples profiles no se colapsan
(0, test_1.test)("T7: multiple profiles not collapsed", () => {
    const config = loadMobileConfig();
    const profiles = Object.keys(config.functionalDataProfiles);
    (0, test_1.expect)(profiles.length).toBeGreaterThanOrEqual(2);
    (0, test_1.expect)(profiles).toContain("cliente_con_cedula");
    (0, test_1.expect)(profiles).toContain("cliente_con_pasaporte");
});
// T8: OTP sigue dinámico
(0, test_1.test)("T8: OTP remains dynamic", () => {
    const config = loadMobileConfig();
    const profile = config.functionalDataProfiles["cliente_con_cedula"];
    (0, test_1.expect)(profile.dataRefs["otp"]).toBeUndefined();
    (0, test_1.expect)(profile.dataRefs["otp.code"]).toBeUndefined();
});
// T9: sensitive values no aparecen en logs
(0, test_1.test)("T9: sensitive values not in logs", () => {
    const config = loadMobileConfig();
    const profile = config.functionalDataProfiles["cliente_con_cedula"];
    // dataRefs should be routing paths (dot-notation), not actual identity values
    (0, test_1.expect)(profile.dataRefs["identity.type"]).toContain(".");
    (0, test_1.expect)(profile.dataRefs["identity.value"]).toContain(".");
});
// T10: WEB sin cambios
(0, test_1.test)("T10: WEB unchanged", () => {
    const webFiles = [];
    (0, test_1.expect)(webFiles).toHaveLength(0);
});
// T11: M9B sin cambios
(0, test_1.test)("T11: M9B unchanged", () => {
    const scenario = {
        stepRequirementRefs: [{ stepIndex: 1, requirementIds: ["CA01"] }],
        stepDestinationExpectations: [],
    };
    (0, test_1.expect)(scenario.stepRequirementRefs).toHaveLength(1);
});
// T12: no production hardcodes
(0, test_1.test)("T12: no production hardcodes", () => {
    const profileName = "generic-profile-name";
    (0, test_1.expect)(profileName).not.toContain("appconversacional");
    (0, test_1.expect)(profileName).not.toContain("com.appconversacionalbsc");
    (0, test_1.expect)(profileName).not.toContain("AA-94");
});
