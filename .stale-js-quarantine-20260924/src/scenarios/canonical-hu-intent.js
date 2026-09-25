"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCanonicalHuIntent = resolveCanonicalHuIntent;
function resolveCanonicalHuIntent(primary, derivedModelIntent, branches = []) {
    const catalog = primary.intent === "catalog_listing_flow" || derivedModelIntent === "catalog_listing";
    const detail = primary.intent === "product_detail_flow" || derivedModelIntent === "product_detail";
    const transactional = primary.intent === "transactional_document_flow" ||
        ["transactional_document_flow", "document_generation", "statement_generation", "payment_transfer", "product_request"].includes(derivedModelIntent);
    const privateNavigation = primary.intent === "private_navigation_flow" || branches.some((branch) => branch.accessIntent === "authenticated" || /auth|private|transaction/i.test(branch.actionIntent ?? ""));
    const branchIntents = {};
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
