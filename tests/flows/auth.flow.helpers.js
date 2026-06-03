"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePromotedSpecAuthDataFromEnv = resolvePromotedSpecAuthDataFromEnv;
exports.initAuthFlowForPromotedSpec = initAuthFlowForPromotedSpec;
const auth_flow_1 = require("./auth.flow");
function resolveAlias(aliases, alias) {
    const aliasValue = aliases[alias];
    if (typeof aliasValue === "string") {
        return aliasValue;
    }
    if (Array.isArray(aliasValue) && aliasValue.length > 0) {
        return String(aliasValue[0]);
    }
    return alias;
}
function resolveFromTestData(testData, aliases, alias, key) {
    const resolvedAlias = resolveAlias(aliases, alias);
    const clients = testData.clients;
    if (clients && typeof clients === "object") {
        const client = clients[resolvedAlias];
        if (client && typeof client === "object" && client[key]) {
            return String(client[key]);
        }
    }
    const auth = testData.auth;
    if (auth && typeof auth === "object") {
        const authEntry = auth[resolvedAlias];
        if (authEntry && typeof authEntry === "object" && authEntry[key]) {
            return String(authEntry[key]);
        }
    }
    const defaults = testData.defaults;
    if (defaults && typeof defaults === "object") {
        const defaultAlias = defaults.client || resolvedAlias;
        const defaultClient = testData.clients?.[defaultAlias];
        if (defaultClient && typeof defaultClient === "object" && defaultClient[key]) {
            return String(defaultClient[key]);
        }
    }
    return undefined;
}
function resolvePromotedSpecAuthDataFromEnv(options) {
    const alias = options?.alias || 'defaultClient';
    let testData = {};
    try {
        const raw = process.env.APP_TEST_DATA_JSON;
        if (raw) {
            testData = JSON.parse(raw);
        }
    }
    catch {
        // APP_TEST_DATA_JSON not parseable, use empty object
    }
    let testDataAliases = {};
    try {
        const raw = process.env.APP_TEST_DATA_ALIASES_JSON;
        if (raw) {
            testDataAliases = JSON.parse(raw);
        }
    }
    catch {
        // APP_TEST_DATA_ALIASES_JSON not parseable, use empty object
    }
    const resolvedAlias = resolveAlias(testDataAliases, alias);
    const result = { ...testData };
    const clients = result.clients;
    if (clients && typeof clients === "object" && clients[resolvedAlias]) {
        const client = { ...clients[resolvedAlias] };
        if (!client.identificationNumber && typeof process.env.Identity_Provider === "string" && process.env.Identity_Provider) {
            client.identificationNumber = process.env.Identity_Provider;
        }
        if (!client.otp && typeof process.env.OTP_SECRET === "string" && process.env.OTP_SECRET) {
            client.otp = process.env.OTP_SECRET;
        }
        if (!client.identificationType) {
            client.identificationType = "cedula";
        }
        clients[resolvedAlias] = client;
    }
    else {
        if (!clients || typeof clients !== "object") {
            result.clients = {};
        }
        const fallbackClient = {
            identificationType: "cedula"
        };
        if (typeof process.env.Identity_Provider === "string" && process.env.Identity_Provider) {
            fallbackClient.identificationNumber = process.env.Identity_Provider;
        }
        if (typeof process.env.OTP_SECRET === "string" && process.env.OTP_SECRET) {
            fallbackClient.otp = process.env.OTP_SECRET;
        }
        if (typeof process.env.APP_USERNAME === "string" && process.env.APP_USERNAME) {
            fallbackClient.username = process.env.APP_USERNAME;
        }
        if (typeof process.env.APP_PASSWORD === "string" && process.env.APP_PASSWORD) {
            fallbackClient.password = process.env.APP_PASSWORD;
        }
        result.clients[resolvedAlias] = fallbackClient;
    }
    const auth = result.auth;
    if (auth && typeof auth === "object" && auth[resolvedAlias]) {
        const authEntry = { ...auth[resolvedAlias] };
        if (!authEntry.username && typeof process.env.APP_USERNAME === "string" && process.env.APP_USERNAME) {
            authEntry.username = process.env.APP_USERNAME;
        }
        if (!authEntry.password && typeof process.env.APP_PASSWORD === "string" && process.env.APP_PASSWORD) {
            authEntry.password = process.env.APP_PASSWORD;
        }
        auth[resolvedAlias] = authEntry;
    }
    if (typeof process.env.APP_EXTRA_LOGIN_FIELDS_JSON === "string" && process.env.APP_EXTRA_LOGIN_FIELDS_JSON) {
        try {
            result.extraLoginFields = JSON.parse(process.env.APP_EXTRA_LOGIN_FIELDS_JSON);
        }
        catch {
            // ignore
        }
    }
    return result;
}
function initAuthFlowForPromotedSpec(options) {
    const testData = resolvePromotedSpecAuthDataFromEnv({ alias: options?.alias });
    (0, auth_flow_1.setAuthFlowTestData)(testData);
}
