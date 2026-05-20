export { loadObjectRegistry, saveObjectRegistry } from "./object-registry-loader";
export { assertValidObjectRegistry, validateObjectRegistry } from "./object-registry-validator";
export { findRegistryObjectsByText, normalizeRegistryText, resolveRegistryObject } from "./object-resolver";
export { registryLocatorToPlanTarget } from "./registry-target-adapter";
export { actionRegistry, getActionCapability, listSupportedActions } from "./action-registry";
export { buildRegistryPromotionReport, applyRegistryPromotion } from "./registry-promoter";
