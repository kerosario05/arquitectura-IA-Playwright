# GenerationProfile Contract

`GenerationProfile` is optional metadata transported by
`RuntimeInputRequirement`. It is separate from `FieldCapability` and
`ScenarioDataPolicy`.

```ts
type GenerationProfile = {
  semanticType:
    | "money"
    | "phone"
    | "email"
    | "document_identifier"
    | "job_title"
    | "person_name"
    | "quantity"
    | "percentage"
    | "date"
    | "datetime"
    | "generic_text"
    | "unknown";
  generationMode:
    | "synthetic"
    | "configured_pool"
    | "configured_dictionary"
    | "manual";
  numeric?: {
    integerOnly?: boolean;
    decimalScale?: number;
    min?: number;
    max?: number;
    step?: number;
  };
  phone?: {
    allowedPrefixes?: string[];
    totalDigits?: number;
    maskPattern?: string;
  };
  poolRef?: string;
  dictionaryRef?: string;
  format?: { pattern?: string; mask?: string };
};
```

The backend validator is `validateGenerationProfile({ fieldCapability,
generationProfile })` in `src/testrail/generation-profile.ts`. A profile is
not runtime authority until that validator accepts it. Profile metadata must
contain references, not pool values or other secrets.
