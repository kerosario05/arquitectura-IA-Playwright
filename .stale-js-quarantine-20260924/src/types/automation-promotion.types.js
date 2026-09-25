"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_PROMOTION_POLICY = void 0;
exports.DEFAULT_PROMOTION_POLICY = {
    specMode: "page-object",
    requirePageObjects: true,
    allowInlineFallback: false,
    allowInlineDebugMode: true,
    allowCandidateGeneration: true,
    blockPromotionWhenPageObjectMissing: true,
    autoPom: false,
    autoGeneratePageObjectCandidates: true,
    autoApproveSafePageObjects: true,
    autoApproveConfidenceThreshold: 0.50,
    autoRunPomValidation: true,
    blockSensitiveAutoApproval: true,
    requirePomRuntime: false
};
