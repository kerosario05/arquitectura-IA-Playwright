export type CatalogOptions = {
  useDiscoveredCatalog?: boolean;
  catalogMode?: "existing" | "refresh";
  coverageMode?: "representative" | "exhaustive";
  maxProductsPerCategory?: number;
};

/**
 * Automatability classification for scenarios
 *
 * - automatable_ui: MCP UI-automatable scenario (allowed in preview)
 * - non_automatable_backend: Requires backend manipulation (DB, API mocks, service corruption)
 * - non_automatable_infra: Requires infrastructure manipulation (network, physical restart)
 * - non_automatable_manual: Requires manual intervention or out-of-scope validation
 * - blocked_by_missing_test_hook: Requires test hooks that don't exist
 */
export type AutomatabilityClassification =
  | "automatable_ui"
  | "non_automatable_backend"
  | "non_automatable_infra"
  | "non_automatable_manual"
  | "blocked_by_missing_test_hook";

/**
 * Excluded requirement/scenario
 *
 * Scenarios that cannot be automated via MCP UI framework
 */
export type ExcludedRequirement = {
  sourceRequirement: string; // HU acceptance criteria or scenario title
  sourceIssueKey: string; // Jira issue key
  reason: string; // Human-readable reason for exclusion
  classification: AutomatabilityClassification; // Why it's not automatable
  suggestedHandling: string; // What to do instead (e.g., "manual_test", "backend_unit_test", "skip")
  detectedPatterns?: string[]; // Patterns that triggered exclusion
};

export type CatalogDiagnostics = {
  catalogUsed: boolean;
  discoveryRefreshed: boolean;
  discoveredProductCount: number;
  representativeProductCount: number;
  discoveryTimestamp?: string;
  warnings: string[];
  fallbackReason?: string;
  // HU scope filtering diagnostics
  issueAlignedTargetCount?: number; // Number of products aligned with HU scope
  issueAlignedCategories?: string[]; // Categories aligned with HU scope
  explicitlyMentionedCategories?: string[]; // Categories explicitly mentioned in HU
  // Scenario budget diagnostics
  scenarioBudgetResolved?: number; // Dynamic scenario limit calculated for this HU
  scenarioBudgetSource?: "env_override" | "dynamic_broad_hu" | "dynamic_failure_scenarios" | "default"; // How limit was determined
  // Seed context diagnostics
  seedContextCount?: number; // Number of deterministic seeds generated as context
  seedContextByCategory?: Record<string, number>; // Seeds per category
  seedGeneratedCount?: number; // Total seeds generated
  seedValidCount?: number; // Valid seeds (passed validation)
  seedInvalidCount?: number; // Invalid seeds (failed validation)
  seedInvalidReasons?: Array<{ title: string; errors: string[] }>; // Why seeds failed
  // Coverage diagnostics
  categoryCoverage?: Record<string, { total: number; covered: number; seeded: number }>; // Coverage per category
  // Failure scenario diagnostics
  failureScenarioCountDetected?: number; // Number of failure scenarios detected in HU
  failureScenarioCountGenerated?: number; // Number of failure scenarios actually generated
  // Automatability filtering diagnostics
  excludedRequirements?: ExcludedRequirement[]; // Non-automatable scenarios excluded from preview
  nonAutomatableRequirementCount?: number; // Count of excluded requirements
  uiAutomatableRequirementCount?: number; // Count of UI-automatable scenarios that passed filter
};

export type ScenarioPreviewRequest = {
  projectKey?: string;
  sprintId?: number;
  activeSprint?: boolean;
  status?: string;
  selectedIssueKeys?: string[];
  sectionName?: string;
  sectionSlug?: string;
  sectionId?: string | number;
  testrailProjectId?: number;
  testrailSuiteId?: number;
  testrailSectionId?: number;
  testrailSectionName?: string;
  appSlug?: string;
  targetAppSlug?: string;
  targetAppName?: string;
  generationMode?: string;
  aiProvider?: string;
  sourceMode?: string;
  maxResults?: number;
  publishToTestRail?: boolean;
  createTestRun?: boolean;
  reportResults?: boolean;
  catalogOptions?: CatalogOptions;
};

export type AppInferenceMeta = {
  appName: string;
  appSlug: string;
  source: "explicit" | "request" | "testrail_section" | "testrail_project" | "jira" | "fallback";
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type JiraIssueSource = {
  key: string;
  summary: string;
  description: string;
  acceptanceCriteria: string | null;
  labels: string[];
  components: string[];
  status: string;
  issueType: string;
};

export type McpScenarioStep = string;

export type McpScenario = {
  sourceIssueKey: string;
  title: string;
  steps: McpScenarioStep[];
  preconditions: string[];
  expectedResult: string;
  caseOracle?: string;
  type: string;
  database: string;
  isConverted: number;
  automationType: string;
  setupStrategy: string;
  appSlug: string;
  targetAppSlug?: string;
  targetAppName?: string;
  routeProfile: string;
  dataRequirements: string;
  nonExecutableCriteria: string;
  mcpExecutable: boolean;
  caseId?: number;
  generationSource?: "ai" | "deterministic_seed"; // Track source for seeds vs AI
  validation?: {
    valid: boolean;
    errors: string[];
    warnings: string[];
  };
  // Route-first optional metadata
  scenarioMode?: ScenarioMode;
  routeConfidence?: RouteConfidence;
  diagnostics?: ScenarioDiagnostic[];
};

export type McpRouteProfile = {
  name: string;
  entry: Array<{ businessLabel: string; visibleLabel: string }>;
  aliases: Record<string, string | string[]>;
  intermediates: Record<string, string[]>;
  domainTerms: Record<string, string | string[]>;
  visibleControls: string[];
  representativeFixture: Record<string, string>;
  notes: string[];
  // Optional: steps to run before functional navigation
  entrySteps?: Array<{ action: string; target: string; when: string }>;
  // Optional: per-target path requirements
  targetPaths?: Record<string, TargetPathDefinition>;
};

export type TargetPathDefinition = {
  target: string; // The final target to reach
  requiredIntermediates: string[]; // Ordered list of intermediate steps before reaching target
  confidence?: "high" | "medium" | "low"; // Confidence in this path
  source?: string; // Where this path came from (discovered, manual, inferred, runtime_discovery)
  // Product metadata for catalog items discovered at runtime
  productMetadata?: {
    category?: string; // e.g. "Cuentas de Efectivo"
    subcategory?: string; // e.g. "Cuentas de Ahorro"
    variant?: string; // e.g. "Pesos" | "Dólares" | "Euros"
    productLabel: string; // e.g. "Cuenta de Ahorros Personal en Pesos"
    normalizedLabel: string; // Normalized version for matching
    isRepresentative?: boolean; // Selected as representative for this category
    groupKey?: string; // Grouping key for deduplication (e.g. "cuentas_efectivo_pesos")
    discoveredAt?: string; // ISO timestamp of discovery
    detailSections?: string[]; // Expected detail sections (e.g. ["Detalles", "Requisitos"])
    actionButtons?: string[]; // Expected action buttons (e.g. ["Solicitar", "Volver"])
    // Product presentation and validation
    presentationType?: "detail_page" | "product_card" | "product_list_item" | "product_table_row" | "product_panel" | "unknown";
    validationStatus?: "validated_detail" | "validated_card" | "validated_listing" | "unresolved_detail";
    expectedCardSignals?: {
      cardTextPreview?: string; // Preview of card text content
      bulletCount?: number; // Number of bullet points visible
      hasImageOrIcon?: boolean; // Has visual element
      visibleSignals?: string[]; // Other visible signals (e.g. ["price", "rating", "badge"])
      cardIndex?: number; // Index in grid if multiple cards
    };
    clickableToDetail?: boolean; // Whether card is clickable and opens detail page
  };
};

export type McpRejectedScenario = {
  sourceIssueKey: string;
  reason: string;
};

export type McpGenerationResponse = {
  appSlug: string;
  targetAppSlug?: string;
  targetAppName?: string;
  confidence: string;
  reason: string;
  functionalRoute: string;
  routeProfile: McpRouteProfile;
  scenarios: McpScenario[];
  warnings: string[];
  rejected: McpRejectedScenario[];
  routeResolutions?: Map<string, ScenarioRouteResolution>;
  generationDiagnostics?: ScenarioGenerationDiagnostics;
};

export type ScenarioValidationResult = {
  valid: boolean;
  errors: string[];
  warnings: string[];
};

export type ValidatedScenario = McpScenario & {
  validation: ScenarioValidationResult;
};

export type ScenarioPreviewResponse = {
  ok: boolean;
  source: {
    mode: string;
    projectKey: string;
    sprintId: number | null;
    status: string | null;
    issuesFound: number;
  };
  testrail: {
    projectId: number | null;
    suiteId: number | null;
    sectionId: number | null;
    sectionName: string | null;
  };
  appSlug: string;
  targetAppSlug?: string;
  targetAppName?: string;
  appInference?: AppInferenceMeta;
  appProfilePath?: string;
  summary: {
    generated: number;
    valid: number;
    invalid: number;
    rejected: number;
    blocked?: number;
  };
  routeProfile: McpRouteProfile | null;
  scenarios: ValidatedScenario[];
  rejected: McpRejectedScenario[];
  blockedScenarios?: BlockedScenario[];
  warnings: string[];
  catalogDiagnostics?: CatalogDiagnostics;
};

export type ScenarioPreviewError = {
  ok: false;
  error: string;
  message: string;
};

// Route-first scenario generation types

export type ScenarioMode =
  | "listing_validation"
  | "subcategory_navigation"
  | "detail_navigation"
  | "return_navigation"
  | "action_button_validation"
  | "unknown";

export type RouteConfidence = "high" | "medium" | "low";

export type DiagnosticLevel = "error" | "warning" | "info";

/**
 * Scenario generation mode
 *
 * Controls how scenarios are generated:
 * - ai_supported_by_deterministic: AI generates scenarios with deterministic seeds as context (DEFAULT)
 * - ai_only: AI generates scenarios without deterministic context (for comparison)
 * - deterministic_only: Skip AI, use only deterministic generation (DEBUG ONLY, requires explicit env)
 * - fallback_deterministic_on_ai_failure: Try AI first, fall back to deterministic if AI fails
 */
export type ScenarioGenerationMode =
  | "ai_supported_by_deterministic"
  | "ai_only"
  | "deterministic_only"
  | "fallback_deterministic_on_ai_failure";

/**
 * Deterministic seed scenario
 *
 * A base scenario generated deterministically to guide AI generation.
 * Not meant to be the final output, but a starting point/context.
 */
export type DeterministicSeedScenario = {
  sourceIssueKey: string;
  title: string;
  steps: string[];
  mode: ScenarioMode;
  confidence: RouteConfidence;
  notes?: string;
};

/**
 * Scenario generation diagnostics
 *
 * Tracks what happened during scenario generation
 */
export type ScenarioGenerationDiagnostics = {
  generationMode: ScenarioGenerationMode;
  deterministicSeedsGenerated: number;
  aiCalled: boolean;
  aiFailed?: boolean;
  aiGenerated: number;
  finalValid: number;
  finalRejected: number;
  finalBlocked: number;
  fallbackUsed: boolean;
  fallbackReason?: "ai_generation_error" | "ai_timeout" | "ai_parse_failed";
  fallbackScenarioCount?: number;
  skipAIReason?: string;
};

export type DiagnosticCode =
  // ERROR level (blocks generation)
  | "needs_route_profile"
  | "missing_parent_route"
  // WARNING level (allows with low confidence)
  | "missing_intermediate_step"
  | "missing_detail_selection_step"
  // INFO level (converts to validations)
  | "unsupported_route_target"
  | "ambiguous_route_target";

export type ScenarioDiagnostic = {
  level: DiagnosticLevel;
  code: DiagnosticCode;
  message: string;
  context?: Record<string, unknown>;
};

export type ScenarioRouteResolution = {
  scenarioMode: ScenarioMode;
  routeConfidence: RouteConfidence;
  executableRouteSteps: string[];
  diagnostics: ScenarioDiagnostic[];
  canGenerate: boolean;
  missingRouteReason?: string;
};

export type ScenarioModeClassification = {
  mode: ScenarioMode;
  confidence: RouteConfidence;
  requiredRouteDepth: number;
  hasBacking: boolean;
  missingSteps: string[];
};

export type BlockedScenario = {
  sourceIssueKey: string;
  title: string;
  status: "blocked";
  reasonCode: DiagnosticCode;
  reason: string;
  diagnostics: ScenarioDiagnostic[];
  appSlug: string;
  appProfilePath?: string;
  suggestedAction: string;
};

// Path resolution types

export type EntryStepConfig = {
  action: string;
  target: string;
  when?: string;
  description?: string;
};

export type ExecutablePathResolution = {
  canResolve: boolean;
  pathSteps: EntryStepConfig[];
  insertedSteps: EntryStepConfig[];
  confidence: "high" | "medium" | "low" | "none";
  reasonCode: string;
  diagnostics: Array<{
    level: "error" | "warning" | "info";
    message: string;
    context?: Record<string, unknown>;
  }>;
};

export type IntermediateRepairResult = {
  repaired: boolean;
  originalSteps: string[];
  repairedSteps: string[];
  insertedSteps: string[];
  insertedCount: number;
  reasonCode: string;
  diagnostics: Array<{
    level: "error" | "warning" | "info";
    target: string;
    missingParent?: string;
    insertedIntermediate?: string;
    pathSource?: string;
    confidence?: string;
    decision: string;
    message: string;
  }>;
};

// Product Catalog Discovery Types

export type DiscoveredProduct = {
  label: string; // Original product label as seen in the UI
  normalizedLabel: string; // Normalized version for matching
  category?: string; // Product category (e.g. "Cuentas de Efectivo")
  subcategory?: string; // Product subcategory (e.g. "Cuentas de Ahorro")
  variant?: string; // Product variant (e.g. "Pesos", "Dólares", "Euros")
  href?: string; // Link href if available
  locator?: string; // Locator strategy used to find this product
  confidence: "high" | "medium" | "low"; // Confidence in product detection
  isRepresentative?: boolean; // Whether this product is selected as representative
  groupKey: string; // Grouping key for deduplication (e.g. "cuentas_efectivo_pesos")
  // Multilevel discovery metadata
  discoveryPath?: string[]; // Full path to this product: ["Información de productos", "Cuentas", "Producto X"]
  detailSignals?: ProductDetailSignals; // Captured when product detail was validated
  // Product card metadata (when product is represented as card/list item)
  presentationType?: "detail_page" | "product_card" | "product_list_item" | "product_table_row" | "product_panel" | "unknown";
  validationStatus?: "validated_detail" | "validated_card" | "validated_listing" | "unresolved_detail";
  cardSignals?: {
    cardTextPreview?: string;
    bulletCount?: number;
    hasImageOrIcon?: boolean;
    visibleSignals?: string[];
    cardIndex?: number;
  };
  clickableToDetail?: boolean;
  // Detail probing metadata (for cards that were probed for detail)
  probeMetadata?: {
    detailProbeAttempted: boolean; // Whether detail probing was attempted
    detailProbeResult: "validated_detail" | "no_detail" | "click_failed"; // Result of detail probe
    clickableAncestorFound?: boolean; // Whether clickable ancestor was found for h3/h2 label
    clickableAncestorStrategy?: string; // Strategy for clicking ancestor (button, link, onclick, etc.)
    clickableAncestorTag?: string; // Tag of clickable ancestor
    labelElementTag?: string; // Tag of label element (h3, h2, etc.)
  };
};

export type ProductDetailSignals = {
  detailSections?: string[]; // Visible sections: ["Detalles", "Requisitos", "Beneficios"]
  actionButtons?: string[]; // Visible buttons: ["Solicitar", "Volver"]
  detailTexts?: string[]; // Other detail indicators
  hasDetailPage?: boolean; // Whether clicking opened a detail page
};

export type CatalogCandidate = {
  label: string;
  normalizedLabel: string;
  type: "category" | "subcategory" | "product" | "detail" | "unknown";
  locator: string; // Legacy string locator
  href?: string;
  confidence: "high" | "medium" | "low";
  // Locator strategy for accurate clicking
  locatorStrategy: {
    type: "role" | "text" | "css" | "testId" | "containerText";
    role?: string; // button, link, menuitem, tab
    text: string;
    selector?: string; // CSS selector if applicable
    nth?: number; // Index if multiple matches
  };
  // Evidence of interactivity
  clickableEvidence?: {
    hasRole?: boolean; // Has interactive role
    hasClickableTag?: boolean; // Is button/a tag
    hasOnClick?: boolean; // Has onclick handler
    hasInteractiveAria?: boolean; // Has aria-expanded, aria-controls, etc.
    hasCursorPointer?: boolean; // CSS cursor: pointer
    hasInternalClickable?: boolean; // Container with clickable child
  };
};

export type ProductCatalogDiscoveryResult = {
  appSlug: string; // App slug this catalog belongs to
  catalogUrl: string; // URL where catalog was discovered
  capturedAt: string; // ISO timestamp of discovery
  products: DiscoveredProduct[]; // All discovered products
  categories: string[]; // Unique categories found
  totalProducts: number; // Total number of products discovered
  representativeProducts: DiscoveredProduct[]; // Subset selected for representative mode
};

export type DetectedProductCard = {
  productLabel: string; // Product name/title from card
  normalizedLabel: string; // Normalized for matching
  cardTextPreview: string; // Preview of card text content
  bulletCount: number; // Number of bullet points/features visible
  hasImageOrIcon: boolean; // Has visual element (image/icon)
  visibleSignals: string[]; // Other visible signals
  cardIndex: number; // Index in grid
  isClickable: boolean; // Whether card or its children are clickable
  locatorStrategy?: CatalogCandidate["locatorStrategy"]; // How to locate this card if clickable
  confidence: "high" | "medium" | "low"; // Detection confidence
  // Clickable ancestor detection (for h3/h2 products that need ancestor click)
  clickableAncestorFound?: boolean; // Whether a clickable ancestor was found for this card
  clickableAncestorStrategy?: string; // Strategy to click ancestor (button, link, onclick, etc.)
  clickableAncestorTag?: string; // Tag of clickable ancestor
  labelElementTag?: string; // Tag of label element (h3, h2, etc.)
};
