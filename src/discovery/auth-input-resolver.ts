import type { MissingInputBehavior } from "../types/env.types";

export type AuthInputData = {
  username?: string;
  password?: string;
  identificationType?: string;
  identificationNumber?: string;
  otp?: string;
  pin?: string;
  token?: string;
  expectedPhoneLast4?: string;
  extraFields?: Record<string, string>;
};

export type AuthInputResolution = {
  success: boolean;
  data: AuthInputData;
  sources: Record<string, string>;
  errors: string[];
};

export type AuthInputResolverConfig = {
  env: Record<string, unknown>;
  missingInputBehavior: MissingInputBehavior;
  alias?: string;
};

export function maskValue(value: string | undefined, visibleChars = 4): string {
  if (!value) return "";
  if (value.length <= visibleChars) return "****";
  return "*".repeat(value.length - visibleChars) + value.slice(-visibleChars);
}

function resolveFromTestData(
  testData: Record<string, unknown>,
  aliases: Record<string, unknown>,
  alias: string,
  key: string
): string | undefined {
  const resolvedAlias = resolveAlias(aliases, alias);

  const clients = (testData as any).clients;
  if (clients && typeof clients === "object") {
    const client = clients[resolvedAlias];
    if (client && typeof client === "object" && client[key]) {
      return String(client[key]);
    }
  }

  const auth = (testData as any).auth;
  if (auth && typeof auth === "object") {
    const authEntry = auth[resolvedAlias];
    if (authEntry && typeof authEntry === "object" && authEntry[key]) {
      return String(authEntry[key]);
    }
  }

  const defaults = (testData as any).defaults;
  if (defaults && typeof defaults === "object") {
    const defaultAlias = defaults.client || resolvedAlias;
    const defaultClient = (testData as any).clients?.[defaultAlias];
    if (defaultClient && typeof defaultClient === "object" && defaultClient[key]) {
      return String(defaultClient[key]);
    }
  }

  return undefined;
}

function resolveAlias(aliases: Record<string, unknown>, alias: string): string {
  const aliasValue = aliases[alias];
  if (typeof aliasValue === "string") {
    return aliasValue;
  }
  if (Array.isArray(aliasValue) && aliasValue.length > 0) {
    return String(aliasValue[0]);
  }
  return alias;
}

export function resolveAuthInputs(config: AuthInputResolverConfig): AuthInputResolution {
  const { env, missingInputBehavior, alias = "defaultClient" } = config;
  const result: AuthInputResolution = {
    success: true,
    data: {},
    sources: {},
    errors: []
  };

  const testData = (env.APP_TEST_DATA_JSON && typeof env.APP_TEST_DATA_JSON === "object")
    ? env.APP_TEST_DATA_JSON as Record<string, unknown>
    : {};

  const testDataAliases = (env.APP_TEST_DATA_ALIASES_JSON && typeof env.APP_TEST_DATA_ALIASES_JSON === "object")
    ? env.APP_TEST_DATA_ALIASES_JSON as Record<string, unknown>
    : {};

  const resolvedAlias = resolveAlias(testDataAliases, alias);

  // identificationNumber
  const idFromTestData = resolveFromTestData(testData, testDataAliases, alias, "identificationNumber");
  if (idFromTestData) {
    result.data.identificationNumber = idFromTestData;
    result.sources.identificationNumber = `APP_TEST_DATA_JSON.clients[${resolvedAlias}]`;
  } else if (typeof env.Identity_Provider === "string" && env.Identity_Provider) {
    result.data.identificationNumber = env.Identity_Provider;
    result.sources.identificationNumber = "Identity_Provider";
  }

  // identificationType
  const typeFromTestData = resolveFromTestData(testData, testDataAliases, alias, "identificationType");
  if (typeFromTestData) {
    result.data.identificationType = typeFromTestData;
    result.sources.identificationType = `APP_TEST_DATA_JSON.clients[${resolvedAlias}]`;
  } else {
    result.data.identificationType = "cedula";
    result.sources.identificationType = "default";
  }

  // otp
  const otpFromTestData = resolveFromTestData(testData, testDataAliases, alias, "otp");
  if (otpFromTestData) {
    result.data.otp = otpFromTestData;
    result.sources.otp = `APP_TEST_DATA_JSON.clients[${resolvedAlias}]`;
  } else if (typeof env.OTP_SECRET === "string" && env.OTP_SECRET) {
    result.data.otp = env.OTP_SECRET;
    result.sources.otp = "OTP_SECRET";
  }

  // username
  const userFromTestData = resolveFromTestData(testData, testDataAliases, alias, "username");
  if (userFromTestData) {
    result.data.username = userFromTestData;
    result.sources.username = `APP_TEST_DATA_JSON.auth[${resolvedAlias}]`;
  } else if (typeof env.APP_USERNAME === "string" && env.APP_USERNAME) {
    result.data.username = env.APP_USERNAME;
    result.sources.username = "APP_USERNAME";
  }

  // password
  const passFromTestData = resolveFromTestData(testData, testDataAliases, alias, "password");
  if (passFromTestData) {
    result.data.password = passFromTestData;
    result.sources.password = `APP_TEST_DATA_JSON.auth[${resolvedAlias}]`;
  } else if (typeof env.APP_PASSWORD === "string" && env.APP_PASSWORD) {
    result.data.password = env.APP_PASSWORD;
    result.sources.password = "APP_PASSWORD";
  }

  // expectedPhoneLast4
  const phoneFromTestData = resolveFromTestData(testData, testDataAliases, alias, "expectedPhoneLast4");
  if (phoneFromTestData) {
    result.data.expectedPhoneLast4 = phoneFromTestData;
    result.sources.expectedPhoneLast4 = `APP_TEST_DATA_JSON.clients[${resolvedAlias}]`;
  }

  // extra fields
  if (env.APP_EXTRA_LOGIN_FIELDS_JSON && typeof env.APP_EXTRA_LOGIN_FIELDS_JSON === "object") {
    result.data.extraFields = env.APP_EXTRA_LOGIN_FIELDS_JSON as Record<string, string>;
    result.sources.extraFields = "APP_EXTRA_LOGIN_FIELDS_JSON";
  }

  // pin
  const pinFromTestData = resolveFromTestData(testData, testDataAliases, alias, "pin");
  if (pinFromTestData) {
    result.data.pin = pinFromTestData;
    result.sources.pin = `APP_TEST_DATA_JSON.clients[${resolvedAlias}]`;
  }

  // token
  const tokenFromTestData = resolveFromTestData(testData, testDataAliases, alias, "token");
  if (tokenFromTestData) {
    result.data.token = tokenFromTestData;
    result.sources.token = `APP_TEST_DATA_JSON.clients[${resolvedAlias}]`;
  }

  return result;
}

export function validateRequiredInputs(
  resolution: AuthInputResolution,
  requiredInputs: string[],
  missingInputBehavior: MissingInputBehavior
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const input of requiredInputs) {
    switch (input) {
      case "identificationNumber":
        if (!resolution.data.identificationNumber) {
          errors.push("Missing required input: identificationNumber. Set APP_TEST_DATA_JSON.clients[alias].identificationNumber or Identity_Provider.");
        }
        break;
      case "otp":
        if (!resolution.data.otp) {
          errors.push("Missing required input: otp. Set APP_TEST_DATA_JSON.clients[alias].otp or OTP_SECRET.");
        }
        break;
      case "username":
        if (!resolution.data.username) {
          errors.push("Missing required input: username. Set APP_TEST_DATA_JSON.auth[alias].username or APP_USERNAME.");
        }
        break;
      case "password":
        if (!resolution.data.password) {
          errors.push("Missing required input: password. Set APP_TEST_DATA_JSON.auth[alias].password or APP_PASSWORD.");
        }
        break;
      case "pin":
        if (!resolution.data.pin) {
          errors.push("Missing required input: pin. Set APP_TEST_DATA_JSON.clients[alias].pin.");
        }
        break;
      case "token":
        if (!resolution.data.token) {
          errors.push("Missing required input: token. Set APP_TEST_DATA_JSON.clients[alias].token.");
        }
        break;
    }
  }

  if (errors.length > 0 && missingInputBehavior === "fail") {
    return { valid: false, errors };
  }

  return { valid: errors.length === 0, errors };
}

export function maskResolution(resolution: AuthInputResolution): Record<string, string> {
  const masked: Record<string, string> = {};

  if (resolution.data.identificationNumber) {
    masked.identificationNumber = maskValue(resolution.data.identificationNumber);
  }
  if (resolution.data.otp) {
    masked.otp = "******";
  }
  if (resolution.data.password) {
    masked.password = "******";
  }
  if (resolution.data.username) {
    masked.username = maskValue(resolution.data.username, 2);
  }
  if (resolution.data.pin) {
    masked.pin = "****";
  }
  if (resolution.data.token) {
    masked.token = "******";
  }

  return masked;
}

export function logAuthResolution(resolution: AuthInputResolution): void {
  const masked = maskResolution(resolution);
  console.log(`[auth-input-resolver] Resolution sources:`);
  for (const [key, source] of Object.entries(resolution.sources)) {
    const value = masked[key] || "(not resolved)";
    console.log(`[auth-input-resolver]   ${key}: from ${source} = ${value}`);
  }
}
