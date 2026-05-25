# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: promote-plan.spec.ts >> login modal promotion registers HomePage and LoginPage candidates with dedicated methods
- Location: tests\promote-plan.spec.ts:507:5

# Error details

```
Error: Invalid execution plan: STEP_EXPECTED_REQUIRED: assertText requires expected value.
```

# Test source

```ts
  530 | 
  531 |       if (regResult.created) {
  532 |         candidatesRegistered += 1;
  533 |       }
  534 | 
  535 |       existingPO = registry.pageObjects.find((po) => po.className === ownerClassName);
  536 |     }
  537 | 
  538 |     if (existingPO) {
  539 |       for (const m of uniqueMethods.values()) {
  540 |         registerMethodCandidate(registry, existingPO.id, {
  541 |           name: m.name,
  542 |           intent: m.intent,
  543 |           parameters: m.parameters,
  544 |           sensitive: m.sensitive,
  545 |           confidence: m.confidence,
  546 |           sourceActionId: m.sourceActionId
  547 |         });
  548 |       }
  549 |     }
  550 |   }
  551 | 
  552 |   const flowSteps = plan.steps.map((s) => {
  553 |     const screenType = deriveSemanticScreenType(s, plan.steps);
  554 |     const intent = classifyMethodIntent(s, screenType, plan.steps);
  555 |     const methodName = deriveMethodNameFromIntent(intent);
  556 |     const className = derivePageObjectClassNameFromScreenType(screenType);
  557 | 
  558 |     return {
  559 |       action: s.action,
  560 |       target: s.target && typeof s.target === "object" ? (s.target.value ?? "") : "",
  561 |       pageObjectId: className,
  562 |       methodName
  563 |     };
  564 |   });
  565 | 
  566 |   const flowName = plan.scenario.title.substring(0, 50);
  567 |   await registerFlowCandidate(flowReg, {
  568 |     name: flowName,
  569 |     steps: flowSteps,
  570 |     requiredDataKeys: plan.requiredData.filter((d) => d.required).map((d) => d.key),
  571 |     confidence: 0.5
  572 |   });
  573 | 
  574 |   if (pomStatus === "needs_page_method" && specResultMissingMethods.length > 0) {
  575 |     const skipIntents: string[] = [];
  576 |     
  577 |     for (const missingMethod of specResultMissingMethods) {
  578 |       const derivedIntentMatch = missingMethod.match(/derivedIntent="([^"]+)"/);
  579 |       const intent = derivedIntentMatch ? derivedIntentMatch[1] : missingMethod.trim();
  580 |       
  581 |       // Skip login-related intents
  582 |       if (skipIntents.includes(intent)) continue;
  583 | 
  584 |       const expectedOwnerMatch = missingMethod.match(/expectedOwner="([^"]+)"/);
  585 |       const ownerClassName = expectedOwnerMatch ? expectedOwnerMatch[1] : (INTENT_PREFERRED_OWNER[intent] ?? "GenericPage");
  586 | 
  587 |       let ownerPO = registry.pageObjects.find((po) => po.className === ownerClassName);
  588 | 
  589 |       if (!ownerPO) {
  590 |         ownerPO = registry.pageObjects.find((po) => po.className === "ProductListPage" && po.status === "active");
  591 |       }
  592 | 
  593 |       if (!ownerPO && registry.pageObjects.length > 0) {
  594 |         ownerPO = registry.pageObjects.find((po) => po.status === "candidate") ?? registry.pageObjects[0];
  595 |       }
  596 | 
  597 |       if (ownerPO) {
  598 |         const methodName = deriveMethodNameFromIntent(intent as SemanticMethodIntent);
  599 |         registerMethodCandidate(registry, ownerPO.id, {
  600 |           name: methodName,
  601 |           intent,
  602 |           parameters: deriveMethodParameters(intent as SemanticMethodIntent),
  603 |           confidence: 0.5,
  604 |           sourceActionId: `${sourcePlanId}-missing-${intent}`
  605 |         });
  606 |       }
  607 |     }
  608 |   }
  609 | 
  610 |   await savePageObjectRegistry(registry, appProfile, outputRoot);
  611 |   await saveFlowRegistry(flowReg, appProfile, outputRoot);
  612 | 
  613 |   return { pomCandidatesRegistered: candidatesRegistered };
  614 | }
  615 | 
  616 | export async function promoteExecutionPlan(
  617 |   input: PromoteInput,
  618 |   allowDraft = false,
  619 |   metadata?: PromotedAutomationIndexEntry["metadata"]
  620 | ): Promise<PromotedAutomationIndexEntry> {
  621 |   const plan = input.plan;
  622 | 
  623 |   const validation = validateExecutionPlan(plan);
  624 | 
  625 |   if (!validation.valid) {
  626 |     const errors = validation.issues
  627 |       .filter((issue) => issue.level === "error")
  628 |       .map((issue) => `${issue.code}: ${issue.message}`)
  629 |       .join("; ");
> 630 |     throw new Error(`Invalid execution plan: ${errors || "unknown validation errors"}`);
      |           ^ Error: Invalid execution plan: STEP_EXPECTED_REQUIRED: assertText requires expected value.
  631 |   }
  632 | 
  633 |   const status = plan.status;
  634 | 
  635 |   if (status !== "validated") {
  636 |     assertPromotable(status, allowDraft);
  637 |   }
  638 | 
  639 |   const automationId = buildAutomationId({
  640 |     externalId: plan.scenario.externalId,
  641 |     caseId: plan.scenario.caseId,
  642 |     title: plan.scenario.title
  643 |   });
  644 | 
  645 |   const runtimeConfig = input.fullConfig;
  646 | 
  647 |   let appProfile: AppProfile;
  648 |   if (input.appProfileObject) {
  649 |     appProfile = input.appProfileObject;
  650 |   } else {
  651 |     appProfile = deriveAppProfile({
  652 |       appProfile: input.appProfile ?? runtimeConfig?.app.appProfile,
  653 |       appName: input.appName ?? runtimeConfig?.app.name,
  654 |       baseUrl: input.baseUrl ?? runtimeConfig?.app.baseUrl
  655 |     });
  656 |   }
  657 | 
  658 |   const appPaths = buildAppAutomationPaths(appProfile, automationId, input.outputRoot);
  659 | 
  660 |   const planHasAuthConsumedSteps = plan.steps.some(s => {
  661 |     const desc = (s.description ?? "").toLowerCase();
  662 |     return desc.startsWith("authflow handled") || desc.includes("step consumed by authflow");
  663 |   });
  664 | 
  665 |   await ensureAppStructure(appPaths.appDir);
  666 |   if (!appPaths.planPath || !appPaths.specPath) {
  667 |     throw new Error("Unable to resolve promoted automation paths.");
  668 |   }
  669 | 
  670 |   if (planHasAuthConsumedSteps) {
  671 |     const authValidation = validateAuthFlowDependencies(appPaths.appDir);
  672 |     if (!authValidation.valid) {
  673 |       throw new Error(
  674 |         `AuthFlow is required but dependencies are missing: ${authValidation.missing.join(", ")}. ` +
  675 |         `Run ensureAppStructure or copy framework files from default app.`
  676 |       );
  677 |     }
  678 |   }
  679 | 
  680 |   try {
  681 |     await fs.access(appPaths.planPath);
  682 |     if (!input.overwrite) {
  683 |       throw new Error(
  684 |         `Automation '${automationId}' already exists at '${appPaths.planPath}'. Use --overwrite to replace.`
  685 |       );
  686 |     }
  687 |   } catch (err) {
  688 |     if (!(err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT")) {
  689 |       throw err;
  690 |     }
  691 |   }
  692 | 
  693 |   let wasOverwritten = false;
  694 |   let previousAutomationPath: string | undefined;
  695 |   let previousStatus: string | undefined;
  696 | 
  697 |   if (input.overwrite) {
  698 |     try {
  699 |       await fs.access(appPaths.planPath);
  700 |       wasOverwritten = true;
  701 |       previousAutomationPath = appPaths.planPath;
  702 | 
  703 |       const appDirPathsForLoad = buildAppAutomationPaths(appProfile, undefined, input.outputRoot);
  704 |       try {
  705 |         const existingAppIndex = await loadAutomationIndex(appDirPathsForLoad.indexPath);
  706 |         const existingEntry = existingAppIndex.automations.find((a) => a.id === automationId);
  707 |         if (existingEntry) {
  708 |           previousStatus = existingEntry.status;
  709 |         }
  710 |       } catch {
  711 |         // Index may not exist or be unreadable, continue without previous status
  712 |       }
  713 |     } catch {
  714 |       // Automation does not exist, nothing to overwrite
  715 |     }
  716 |   }
  717 | 
  718 |   await ensureDirectories(appPaths);
  719 | 
  720 |   const planContent = JSON.stringify(plan, null, 2);
  721 |   await fs.writeFile(appPaths.planPath, planContent, "utf-8");
  722 |   if (appPaths.caseConfigPath) {
  723 |     await fs.writeFile(
  724 |       appPaths.caseConfigPath,
  725 |       JSON.stringify({
  726 |         id: automationId,
  727 |         externalId: plan.scenario.externalId,
  728 |         caseId: plan.scenario.caseId,
  729 |         title: plan.scenario.title,
  730 |         source: input.source ?? "manual",
```