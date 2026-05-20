export type FieldRequirement = {
  fieldName?: string;
  label?: string;
  placeholder?: string;
  inputType?: string;
  ariaLabel?: string;
  nearbyText?: string;
  expectedPattern?: string;
  required?: boolean;
};

export type ResolvedTestData = {
  status: "resolved";
  key: string;
  value: string;
  sensitive: boolean;
  confidence: number;
  matchedBy:
    | "exact_key"
    | "alias"
    | "field_name"
    | "label"
    | "placeholder"
    | "semantic_hint"
    | "data_context";
};

export type MissingTestData = {
  status: "missing_input";
  field: FieldRequirement;
  suggestedVariableNames: string[];
  message: string;
};

export type SkippedTestData = {
  status: "skipped";
  field: FieldRequirement;
  reason: string;
};

export type TestDataResolutionResult = ResolvedTestData | MissingTestData | SkippedTestData;
