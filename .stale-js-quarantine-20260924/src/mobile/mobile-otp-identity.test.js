"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const mobile_step_executor_1 = require("./mobile-step-executor");
function test(label, fn) {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    }
    catch (err) {
        console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
}
function describe(name, fn) {
    console.log(`\n${name}`);
    fn();
}
const OTP_STEP = {
    action: "fill",
    description: "Validar el código OTP recibido.",
    target: { strategy: "androidUiAutomator", value: 'new UiSelector().className("android.widget.EditText")' },
    otp: { required: true },
};
function field(over) {
    return {
        key: "campo",
        label: "Campo",
        kind: "text",
        exampleValue: "",
        sensitive: false,
        ...over,
    };
}
// The exact shape captured in .artifacts/mobile-launch-runs/4471e1f8.../mobile-execution-manifest.json,
// the run that failed with otp_identity_unresolved at step 11.
const REAL_RUN_CTX = {
    appSlug: "app-conversacional",
    requiredData: [
        field({
            key: "completar_el_numero_de_documento_del_cliente",
            label: "Completar el número de documento del cliente",
            stepIndex: 3,
            exampleValue: "40229993734",
            sensitive: true,
        }),
    ],
    dataOverrides: { 3: "40229993734" },
};
const NO_ENV = {};
describe("resolveOtpIdentity", () => {
    test("resolves the real failing run's identity without any identityField hint", () => {
        const got = (0, mobile_step_executor_1.resolveOtpIdentity)(OTP_STEP, REAL_RUN_CTX, 10, NO_ENV);
        node_assert_1.default.deepStrictEqual(got, { identity: "40229993734", source: "inferred_label" });
    });
    test("an explicit identityField hint still wins", () => {
        const step = {
            ...OTP_STEP,
            otp: { required: true, identityField: "completar_el_numero_de_documento_del_cliente" },
        };
        const got = (0, mobile_step_executor_1.resolveOtpIdentity)(step, REAL_RUN_CTX, 10, NO_ENV);
        node_assert_1.default.deepStrictEqual(got, { identity: "40229993734", source: "field" });
    });
    test("prefers the dataOverride over the step's exampleValue", () => {
        const ctx = {
            ...REAL_RUN_CTX,
            dataOverrides: { 3: "40200000001" },
        };
        node_assert_1.default.strictEqual((0, mobile_step_executor_1.resolveOtpIdentity)(OTP_STEP, ctx, 10, NO_ENV)?.identity, "40200000001");
    });
    test("falls back to exampleValue when no override was supplied", () => {
        const ctx = { ...REAL_RUN_CTX, dataOverrides: {} };
        node_assert_1.default.strictEqual((0, mobile_step_executor_1.resolveOtpIdentity)(OTP_STEP, ctx, 10, NO_ENV)?.identity, "40229993734");
    });
    test("uses a lone sensitive digit field when no name looks like a document", () => {
        const ctx = {
            appSlug: "a",
            requiredData: [field({ key: "numero_cliente", label: "Número de cliente", stepIndex: 2, exampleValue: "778899", sensitive: true })],
            dataOverrides: { 2: "778899" },
        };
        node_assert_1.default.deepStrictEqual((0, mobile_step_executor_1.resolveOtpIdentity)(OTP_STEP, ctx, 10, NO_ENV), {
            identity: "778899",
            source: "inferred_sensitive",
        });
    });
    test("never picks a secret field as the identity", () => {
        const ctx = {
            appSlug: "a",
            requiredData: [field({ key: "codigo_otp", label: "Código OTP", stepIndex: 2, exampleValue: "123456", sensitive: true })],
            dataOverrides: { 2: "123456" },
        };
        node_assert_1.default.strictEqual((0, mobile_step_executor_1.resolveOtpIdentity)(OTP_STEP, ctx, 10, NO_ENV), null);
    });
    test("refuses to guess when two document-like fields are equally plausible", () => {
        const ctx = {
            appSlug: "a",
            requiredData: [
                field({ key: "documento_titular", label: "Documento del titular", stepIndex: 1, exampleValue: "40200000001", sensitive: true }),
                field({ key: "documento_beneficiario", label: "Documento del beneficiario", stepIndex: 2, exampleValue: "40200000002", sensitive: true }),
            ],
            dataOverrides: { 1: "40200000001", 2: "40200000002" },
        };
        node_assert_1.default.strictEqual((0, mobile_step_executor_1.resolveOtpIdentity)(OTP_STEP, ctx, 10, NO_ENV), null);
    });
    test("ignores non-numeric values — the Oracle procedure only accepts digits", () => {
        const ctx = {
            appSlug: "a",
            requiredData: [field({ key: "documento", label: "Documento", stepIndex: 2, exampleValue: "402-0000000-1", sensitive: true })],
            dataOverrides: { 2: "402-0000000-1" },
        };
        node_assert_1.default.strictEqual((0, mobile_step_executor_1.resolveOtpIdentity)(OTP_STEP, ctx, 10, NO_ENV), null);
    });
    test("excludes the OTP step's own field from the candidates", () => {
        const ctx = {
            appSlug: "a",
            requiredData: [field({ key: "documento", label: "Documento", stepIndex: 10, exampleValue: "40229993734", sensitive: true })],
            dataOverrides: { 10: "40229993734" },
        };
        node_assert_1.default.strictEqual((0, mobile_step_executor_1.resolveOtpIdentity)(OTP_STEP, ctx, 10, NO_ENV), null);
    });
    test("falls back to Identity_Provider only when nothing else resolves", () => {
        const ctx = { appSlug: "a", requiredData: [], dataOverrides: {} };
        node_assert_1.default.deepStrictEqual((0, mobile_step_executor_1.resolveOtpIdentity)(OTP_STEP, ctx, 10, { Identity_Provider: "40229993734" }), {
            identity: "40229993734",
            source: "env_identity_provider",
        });
    });
    test("Identity_Provider never overrides a field that did resolve", () => {
        const got = (0, mobile_step_executor_1.resolveOtpIdentity)(OTP_STEP, REAL_RUN_CTX, 10, { Identity_Provider: "99999999999" });
        node_assert_1.default.strictEqual(got?.identity, "40229993734");
    });
    test("returns null when there is nothing to resolve from", () => {
        const ctx = { appSlug: "a", requiredData: [], dataOverrides: {} };
        node_assert_1.default.strictEqual((0, mobile_step_executor_1.resolveOtpIdentity)(OTP_STEP, ctx, 10, NO_ENV), null);
    });
});
describe("value-shape tier (labels the generator rewrites between runs)", () => {
    // The same document field as emitted by generation 37e27563: not sensitive, and its label
    // carries a sample number instead of the word "documento".
    const RELABELLED = {
        appSlug: "app-conversacional",
        requiredData: [
            field({
                key: "completar_402_12345678_9",
                label: 'Completar "402-12345678-9"',
                stepIndex: 3,
                exampleValue: "40229993734",
                sensitive: false,
            }),
        ],
        dataOverrides: { 3: "40229993734" },
    };
    test("resolves the identity the app actually receives, not the env fallback", () => {
        const got = (0, mobile_step_executor_1.resolveOtpIdentity)(OTP_STEP, RELABELLED, 9, { Identity_Provider: "00116848235" });
        node_assert_1.default.deepStrictEqual(got, { identity: "40229993734", source: "inferred_value_shape" });
    });
    test("ignores values too short to be an identification number", () => {
        const ctx = {
            appSlug: "a",
            requiredData: [field({ key: "monto", label: "Monto", stepIndex: 2, exampleValue: "500", sensitive: false })],
            dataOverrides: { 2: "500" },
        };
        node_assert_1.default.strictEqual((0, mobile_step_executor_1.resolveOtpIdentity)(OTP_STEP, ctx, 9, NO_ENV), null);
    });
    test("refuses to guess between two identification-shaped values", () => {
        const ctx = {
            appSlug: "a",
            requiredData: [
                field({ key: "a", label: "Campo A", stepIndex: 1, exampleValue: "40229993734", sensitive: false }),
                field({ key: "b", label: "Campo B", stepIndex: 2, exampleValue: "00116848235", sensitive: false }),
            ],
            dataOverrides: { 1: "40229993734", 2: "00116848235" },
        };
        node_assert_1.default.strictEqual((0, mobile_step_executor_1.resolveOtpIdentity)(OTP_STEP, ctx, 9, NO_ENV), null);
    });
    test("a secret-named field is never taken by shape either", () => {
        const ctx = {
            appSlug: "a",
            requiredData: [field({ key: "codigo_token", label: "Código token", stepIndex: 2, exampleValue: "40229993734", sensitive: false })],
            dataOverrides: { 2: "40229993734" },
        };
        node_assert_1.default.strictEqual((0, mobile_step_executor_1.resolveOtpIdentity)(OTP_STEP, ctx, 9, NO_ENV), null);
    });
});
