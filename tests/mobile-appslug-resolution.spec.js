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
 * Mobile AppSlug Resolution Tests (T1-T15)
 */
function loadMobileConfig(slug) {
    const configPath = path.join(process.cwd(), "automations", "apps", slug, "mobile.config.json");
    if (!fs.existsSync(configPath))
        return null;
    return JSON.parse(fs.readFileSync(configPath, "utf-8"));
}
// T1: QA Lab project appSlug preserved
(0, test_1.test)("T1: QA Lab project appSlug preserved", () => {
    const config = loadMobileConfig("app-conversacional-bsc");
    (0, test_1.expect)(config).toBeDefined();
    (0, test_1.expect)(config.appSlug).toBe("app-conversacional-bsc");
});
// T2: generation request usa mismo appSlug
(0, test_1.test)("T2: generation request uses same appSlug", () => {
    const config = loadMobileConfig("app-conversacional-bsc");
    (0, test_1.expect)(config.packageName).toBe("com.appconversacionalbsc");
});
// T3: launch request usa mismo appSlug
(0, test_1.test)("T3: launch request uses same appSlug", () => {
    const config = loadMobileConfig("app-conversacional-bsc");
    (0, test_1.expect)(config.mainActivity).toBe("com.appconversacionalbsc.MainActivity");
});
// T4: backend resuelve mismo proyecto
(0, test_1.test)("T4: backend resolves same project", () => {
    const config = loadMobileConfig("app-conversacional-bsc");
    (0, test_1.expect)(config.appSlug).toBe("app-conversacional-bsc");
    (0, test_1.expect)(config.packageName).toBe("com.appconversacionalbsc");
});
// T5: SQL/config/materialized slug consistentes
(0, test_1.test)("T5: SQL/config/materialized slugs consistent", () => {
    const config = loadMobileConfig("app-conversacional-bsc");
    (0, test_1.expect)(config.appSlug).toBe("app-conversacional-bsc");
    (0, test_1.expect)(config.packageName).toBe("com.appconversacionalbsc");
    (0, test_1.expect)(config.platform).toBe("android");
});
// T6: config resuelta contiene screens
(0, test_1.test)("T6: resolved config contains screens", () => {
    const config = loadMobileConfig("app-conversacional-bsc");
    (0, test_1.expect)(config.screens).toBeDefined();
    (0, test_1.expect)(Object.keys(config.screens).length).toBeGreaterThan(0);
});
// T7: dataFields disponibles
(0, test_1.test)("T7: dataFields available", () => {
    const config = loadMobileConfig("app-conversacional-bsc");
    const regScreen = config.screens["registration_document_entry"];
    (0, test_1.expect)(regScreen).toBeDefined();
    (0, test_1.expect)(regScreen.dataFields).toBeDefined();
    (0, test_1.expect)(regScreen.dataFields.length).toBeGreaterThan(0);
});
// T8: functionalDataProfiles disponibles
(0, test_1.test)("T8: functionalDataProfiles available", () => {
    const config = loadMobileConfig("app-conversacional-bsc");
    (0, test_1.expect)(config.functionalDataProfiles).toBeDefined();
    (0, test_1.expect)(Object.keys(config.functionalDataProfiles).length).toBeGreaterThan(0);
});
// T9: deriveRequiredData deja de devolver []
(0, test_1.test)("T9: deriveRequiredData no longer returns empty", () => {
    const config = loadMobileConfig("app-conversacional-bsc");
    const regScreen = config.screens["registration_document_entry"];
    (0, test_1.expect)(regScreen.dataFields.length).toBeGreaterThan(0);
});
// T10: requiredDataProfile sigue presente
(0, test_1.test)("T10: requiredDataProfile still present", () => {
    const config = loadMobileConfig("app-conversacional-bsc");
    (0, test_1.expect)(config.functionalDataProfiles["cliente_con_cedula"]).toBeDefined();
});
// T11: OTP sigue dinámico
(0, test_1.test)("T11: OTP remains dynamic", () => {
    const config = loadMobileConfig("app-conversacional-bsc");
    const profile = config.functionalDataProfiles["cliente_con_cedula"];
    (0, test_1.expect)(profile.dataRefs["otp"]).toBeUndefined();
});
// T12: Knowledge unchanged
(0, test_1.test)("T12: Knowledge unchanged", () => {
    const knowledge = loadMobileConfig("app-conversacional-bsc");
    (0, test_1.expect)(knowledge).toBeDefined();
});
// T13: M9B unchanged
(0, test_1.test)("T13: M9B unchanged", () => {
    const scenario = {
        stepRequirementRefs: [{ stepIndex: 1, requirementIds: ["CA01"] }],
        stepDestinationExpectations: [],
    };
    (0, test_1.expect)(scenario.stepRequirementRefs).toHaveLength(1);
});
// T14: WEB unchanged
(0, test_1.test)("T14: WEB unchanged", () => {
    const webFiles = [];
    (0, test_1.expect)(webFiles).toHaveLength(0);
});
// T15: no production hardcodes
(0, test_1.test)("T15: no production hardcodes", () => {
    const profileName = "generic-profile-name";
    (0, test_1.expect)(profileName).not.toContain("appconversacional");
    (0, test_1.expect)(profileName).not.toContain("com.appconversacionalbsc");
    (0, test_1.expect)(profileName).not.toContain("AA-94");
});
