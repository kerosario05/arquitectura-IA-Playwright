import type { FunctionalBranchRef } from "./scenario-types";
import type { HuIntent, HuIntentDetection } from "./hu-intent-classifier";

export type CanonicalHuIntentResolution = {
  primaryClassifierIntent: HuIntent;
  derivedModelIntent: string;
  catalogRelevant: boolean;
  privateNavigationRelevant: boolean;
  productDetailRelevant: boolean;
  transactionalRelevant: boolean;
  branchIntents: Record<string, { catalogRelevant: boolean; privateNavigationRelevant: boolean; transactionalRelevant: boolean }>;
  dominantIntent?: string;
};

export function resolveCanonicalHuIntent(
  primary: HuIntentDetection,
  derivedModelIntent: string,
  branches: FunctionalBranchRef[] = [],
): CanonicalHuIntentResolution {
  const catalog = primary.intent === "catalog_listing_flow" || derivedModelIntent === "catalog_listing";
  const detail = primary.intent === "product_detail_flow" || derivedModelIntent === "product_detail";
  const transactional = primary.intent === "transactional_document_flow" ||
    ["transactional_document_flow", "document_generation", "statement_generation", "payment_transfer", "product_request"].includes(derivedModelIntent);
  const privateNavigation = primary.intent === "private_navigation_flow" || branches.some((branch) =>
    branch.accessIntent === "authenticated" || /auth|private|transaction/i.test(branch.actionIntent ?? ""));
  const branchIntents: CanonicalHuIntentResolution["branchIntents"] = {};
  for (const branch of branches) {
    branchIntents[branch.branchId] = {
      catalogRelevant: catalog || /catalog|product|inform/i.test(branch.actionIntent ?? ""),
      privateNavigationRelevant: branch.accessIntent === "authenticated" || /auth|private/i.test(branch.actionIntent ?? ""),
      transactionalRelevant: transactional || /transaction|manage|consult/i.test(branch.actionIntent ?? ""),
    };
  }
  return {
    primaryClassifierIntent: primary.intent,
    derivedModelIntent,
    catalogRelevant: catalog,
    privateNavigationRelevant: privateNavigation,
    productDetailRelevant: detail,
    transactionalRelevant: transactional,
    branchIntents,
    dominantIntent: catalog ? "catalog_listing" : derivedModelIntent !== "generic" ? derivedModelIntent : primary.intent,
  };
}
