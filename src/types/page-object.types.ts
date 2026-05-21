export type SpecGenerationMode = "page-object" | "inline-debug";

export type PromotionPolicy = {
  specMode: SpecGenerationMode;
  requirePageObjects: boolean;
  allowInlineFallback: boolean;
  allowInlineDebugMode: boolean;
  allowCandidateGeneration: boolean;
  blockPromotionWhenPageObjectMissing: boolean;
};

export type PageObjectCandidateStatus = "candidate" | "approved" | "active";

export type PageMethodCandidateStatus = "candidate" | "approved" | "active";

export type PageObjectCandidate = {
  id: string;
  name: string;
  className: string;
  filePath: string;
  screenSignature: string;
  methods: PageMethodCandidate[];
  locators: string[];
  confidence: number;
  sourcePlanIds: string[];
  status: PageObjectCandidateStatus;
  createdAt: string;
  updatedAt: string;
};

export type PageMethodCandidate = {
  name: string;
  intent: string;
  parameters: string[];
  actions: string[];
  assertions: string[];
  sensitive: boolean;
  confidence: number;
  sourceActionIds: string[];
  status: PageMethodCandidateStatus;
  createdAt: string;
  updatedAt: string;
};

export type PageObjectMethod = {
  name: string;
  intent: string;
  parameters: string[];
  available: boolean;
  source: string;
  sensitive: boolean;
  confidence: number;
  status: PageMethodCandidateStatus;
};

export type PageObjectEntry = {
  id: string;
  className: string;
  filePath: string;
  screenSignature: string;
  methods: PageObjectMethod[];
  confidence: number;
  status: PageObjectCandidateStatus;
  sourcePlanIds: string[];
  caseIds: number[];
  createdAt: string;
  updatedAt: string;
};

export type ComponentObjectCandidate = {
  id: string;
  name: string;
  className: string;
  filePath: string;
  componentSignature: string;
  methods: PageMethodCandidate[];
  confidence: number;
  status: PageObjectCandidateStatus;
  createdAt: string;
  updatedAt: string;
};

export type FlowCandidateStatus = "candidate" | "approved" | "active";

export type FlowStep = {
  action: string;
  target: string;
  pageObjectId?: string;
  methodName?: string;
  parameters?: Record<string, string>;
};

export type FlowCandidate = {
  id: string;
  name: string;
  filePath: string;
  steps: FlowStep[];
  requiredDataKeys: string[];
  sensitiveActions: string[];
  reusableAcrossCases: boolean;
  confidence: number;
  status: FlowCandidateStatus;
  createdAt: string;
  updatedAt: string;
};

export type PageObjectRegistry = {
  version: string;
  appSlug: string;
  pageObjects: PageObjectEntry[];
  componentCandidates: ComponentObjectCandidate[];
  updatedAt: string;
};

export type FlowRegistry = {
  version: string;
  appSlug: string;
  flows: FlowCandidate[];
  updatedAt: string;
};
