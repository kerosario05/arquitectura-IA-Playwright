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
  /** Structured execution-contract binding for aggregate auth coverage. */
  contractBinding?: {
    bindingId: string;
    coveredScenarioStepIndices: number[];
  };
};

export type AuthFlowStage =
  | "not_started"
  | "identification"
  | "identification_type_selection"
  | "identification_input"
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
  diagnostics?: {
    initialStage?: AuthFlowStage;
    stageTransitions?: string[];
    finalStage?: AuthFlowStage;
    currentUrl?: string;
    stuckReason?: string;
    visibleErrors?: string[];
  };
};
