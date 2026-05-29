export type AuthClientProfile = {
  identificationType: string;
  identificationNumber: string;
  otp: string;
  expectedPhoneLast4?: string;
  capabilities?: string[];
};

export type AuthClientsMap = Record<string, AuthClientProfile>;

export type AuthDataDefaults = {
  client: string;
};

export type AuthDataConfig = {
  clients: AuthClientsMap;
  defaults: AuthDataDefaults;
};

export type AuthFlowOptions = {
  alias?: string;
  landing?: string;
  requiredCapabilities?: string[];
};

export type AuthFlowStage =
  | "not_started"
  | "identification"
  | "phone_confirmation"
  | "otp"
  | "authenticated"
  | "skipped"
  | "home"
  | "protected_entry";

export type AuthFlowResult = {
  success: boolean;
  stagesCompleted: AuthFlowStage[];
  clientAlias: string;
  landingDetected: string | undefined;
  error?: string;
};
