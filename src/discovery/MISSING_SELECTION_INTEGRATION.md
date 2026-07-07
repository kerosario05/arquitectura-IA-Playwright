/**
 * INTEGRATION GUIDE: Missing Selection Detector
 *
 * This file documents where and how to integrate missing-selection-detector.ts
 * into the case-discovery.ts runtime flow.
 *
 * Location: After executing an action target, before evaluating pending assertions.
 */

// ============================================================================
// STEP 1: Import in case-discovery.ts
// ============================================================================
// Add to imports:
// import {
//   inferMissingSelection,
//   buildInsertedStepMetadata,
//   type MissingSelectionContext,
// } from "./missing-selection-detector";

// ============================================================================
// STEP 2: Integration Point in runCaseDiscovery()
// ============================================================================
// Location: After step execution, before assertion evaluation
// 
// Pseudo-code flow:
//
// for (const orderedItem of orderedItems) {
//   if (orderedItem.type === "action") {
//     // Execute action target
//     await executeActionStep(...);
//     
//     // ✓ NEW: Check for missing intermediate selection HERE
//     if (hasMoreSteps && hasDetailAssertionsAhead) {
//       const remainingSteps = parsed.assertionTargets
//         .filter(a => a.index > orderedItem.actionTarget.index)
//         .map(a => a.target)
//         .slice(0, 5);
//       
//       const selectionProposal = inferMissingSelection({
//         currentTarget: orderedItem.actionTarget.target,
//         pendingAssertions: remainingSteps,
//         currentSnapshot: currentSnapshot,
//         remainingSteps
//       });
//       
//       if (selectionProposal.shouldInsert) {
//         console.log(
//           `[mcp-execution] scenarioStepAuthority action=runtime_inserted_step ` +
//           `reason=missing_intermediate_selection confidence=${selectionProposal.confidence}`
//         );
//         
//         // Insert ordinal selection step
//         orderedItems.splice(
//           orderedItems.indexOf(orderedItem) + 1,
//           0,
//           {
//             type: "action",
//             index: orderedItem.index + 0.5, // Sub-index for ordering
//             actionTarget: {
//               index: orderedItem.actionTarget.index + 0.5,
//               action: "click",
//               target: selectionProposal.proposedStep,
//               isAutoInserted: true,
//               metadata: buildInsertedStepMetadata(selectionProposal)
//             }
//           }
//         );
//       }
//     }
//     
//     // Continue with assertions
//   } else if (orderedItem.type === "assertion") {
//     await evaluateAssertion(...);
//   }
// }

// ============================================================================
// STEP 3: Execute Ordinal Selection (Task 4)
// ============================================================================
// When executing the auto-inserted ordinal selection step:
//
// const firstSelectableCandidate = currentSnapshot.elements.find(
//   el => el.visible !== false && (el.role === "button" || el.tagName === "a")
// );
//
// if (firstSelectableCandidate) {
//   await page.click(generateLocator(firstSelectableCandidate));
//   
//   // Capture screenshot before transition
//   await evidenceRecorder?.captureStep(
//     page,
//     stepIndex,
//     selectionProposal.proposedStep,
//     { status: "passed" }
//   );
//   
//   // Wait for transition signals
//   const transitionDetected = await verifyDetailTransition(
//     page,
//     currentSnapshot,
//     pendingAssertions.slice(0, 3) // Check first 3 assertions
//   );
//   
//   console.log(
//     `[detail-transition] opened=${transitionDetected} reason="${
//       transitionDetected
//         ? "assertions_visible|dom_changed|url_changed"
//         : "no_transition"
//     }"`
//   );
// }

// ============================================================================
// STEP 4: Log Auto-Inserted Evidence (Task 6)
// ============================================================================
// After successful ordinal selection:
//
// steps.push({
//   index: orderedItem.actionTarget.index + 0.5,
//   action: "click",
//   status: "found",
//   targetText: selectionProposal.proposedStep,
//   autoInserted: true,
//   insertionReason: "missing_intermediate_selection",
//   insertionConfidence: selectionProposal.confidence,
//   metadata: {
//     type: "ordinal_selection",
//     source: "missing_intermediate_selection_detector",
//     diagnostics: selectionProposal.diagnostics
//   }
// });
//
// console.log(
//   `[evidence] autoInsertedStep text="${selectionProposal.proposedStep}" ` +
//   `source=missing_intermediate_selection`
// );

// ============================================================================
// STEP 5: Handle Failure Cases (Task 5)
// ============================================================================
// If no clear candidate or ambiguous listing:
//
// if (selectionProposal.confidence === "low") {
//   steps.push({
//     index: orderedItem.actionTarget.index,
//     action: orderedItem.actionTarget.action,
//     status: "blocked",
//     targetText: orderedItem.actionTarget.target,
//     error: `missing_intermediate_selection_unresolved: ${selectionProposal.reason}`,
//     diagnostics: selectionProposal.diagnostics
//   });
//   
//   failedAtStep = orderedItem.actionTarget.index;
//   failedReason = selectionProposal.reason;
//   
//   console.log(
//     `[route-completion] blocked reason=missing_intermediate_selection_unresolved ` +
//     `pendingAssertions="${selectionProposal.diagnostics.detailAssertions?.targets}"`
//   );
//   
//   break; // Stop execution
// }

// ============================================================================
// STEP 6: Verify Detail Transition Helper
// ============================================================================
// Helper function to check if detail screen appeared after click:
//
// async function verifyDetailTransition(
//   page: Page,
//   previousSnapshot: PageSnapshot,
//   nextAssertions: string[]
// ): Promise<boolean> {
//   // Generic signals (no hardcoding):
//   // 1. URL changed
//   const urlChanged = page.url() !== previousSnapshot.url;
//   
//   // 2. DOM changed significantly
//   const newSnapshot = await scanCurrentPage(page);
//   const domChanged = 
//     newSnapshot.elements.length !== previousSnapshot.elements.length ||
//     newSnapshot.title !== previousSnapshot.title;
//   
//   // 3. One or more pending assertions became visible
//   const assertionVisible = nextAssertions.some(assertion =>
//     newSnapshot.elements.some(el =>
//       (el.text ?? "").toLowerCase().includes(assertion.toLowerCase().substring(0, 30))
//     )
//   );
//   
//   // 4. Generic detail signals
//   const hasDetailSignals = newSnapshot.elements.some(
//     el =>
//       el.type === "heading" || // Heading for product/item name
//       (el.text ?? "").length > 50 || // Longer descriptive text
//       (el.label ?? "").toLowerCase().includes("volver") // Back button (typical in detail)
//   );
//   
//   return urlChanged || domChanged || assertionVisible || hasDetailSignals;
// }

// ============================================================================
// KEY PRINCIPLES FOR INTEGRATION
// ============================================================================
//
// 1. Generic Detection:
//    - No hardcoding of product names, field names, or business logic
//    - Use snapshot structure (elements, roles, tags) to detect patterns
//    - Infer domain terms only from current target or commonalities
//
// 2. Strong Evidence Required:
//    - Only insert if: listing detected + detail assertions pending + clear candidate
//    - Fail gracefully if evidence is ambiguous (missing_intermediate_selection_unresolved)
//
// 3. Multiproyecto Support:
//    - Same code works for any appSlug/project
//    - All configuration comes from: snapshot, routeProfile, scenario.steps, app.config
//    - Never depend on specific paths or business names
//
// 4. Evidence Trail:
//    - Auto-inserted steps must be marked with metadata
//    - Log reason and confidence for debugging
//    - Keep record in steps array with source attribution
//
// 5. Transition Verification:
//    - After ordinal click, verify detail opened via generic signals
//    - Don't assume specific UI behavior
//    - Check: URL, DOM changes, assertion visibility, structural signals
//
// ============================================================================
// EXPECTED LOG OUTPUT
// ============================================================================
//
// Scenario with missing selection:
//   [list-detection] detected=true itemCount=3 source="cards" currentTarget="Tarjetas"
//   [detail-assertions] pending count=5 targets="Beneficios, Tasas, ..." visibleNow=false
//   [route-completion] insertedStep type=missing_intermediate_selection text="Seleccionar el primer producto visible del listado." reason=detail_assertions_after_listing confidence=high
//   [ordinal-selection] selected index=1 target="Tarjeta Crédito Visa Clásica" source=list_detection
//   [detail-transition] opened=true reason="dom_changed|assertions_visible"
//   [mcp-execution] scenarioStepAuthority action=runtime_inserted_step reason=missing_intermediate_selection
//   [evidence] autoInsertedStep text="Seleccionar el primer producto visible del listado." source=missing_intermediate_selection
//
// Scenario with no evidence:
//   [list-detection] detected=false itemCount=0 source="none" currentTarget="Tarjetas"
//   [route-completion] blocked reason=missing_intermediate_selection_unresolved no_listing_detected
//
// Scenario with ambiguous selection:
//   [list-detection] detected=true itemCount=10 source="buttons" currentTarget="Productos"
//   [detail-assertions] pending count=2 targets="Precio, Descripción" visibleNow=false
//   [route-completion] blocked reason=missing_intermediate_selection_unresolved selectableItems=0
//   [route-completion] ambiguousListSelection groups=2 candidates=10

export const INTEGRATION_READY = true;
