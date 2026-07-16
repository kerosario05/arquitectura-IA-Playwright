/**
 * Scenario Path Resolver
 *
 * Resolves complete executable paths for navigation targets, including required intermediates.
 * This is app-agnostic and works with any appSlug/routeProfile.
 *
 * DO NOT hardcode project-specific logic, targets, or paths.
 */

import type {
  McpRouteProfile,
  ExecutablePathResolution,
  EntryStepConfig,
  ScenarioRouteResolution,
} from "./scenario-types";
import type { DerivedExecutionContext } from "./route-profile-derived-context";
import { normalizeTarget, targetsMatch } from "./target-normalization";

/**
 * Resolve executable path for a target, including all required intermediate steps
 *
 * @param target - The final target to reach
 * @param currentContext - Current navigation context (steps already taken)
 * @param routeProfile - Route profile with intermediates and paths
 * @param derivedContext - Derived execution context with allowed clicks
 * @param routeResolution - Optional route resolution with executable steps
 * @returns ExecutablePathResolution with complete path or error diagnostics
 */
export function resolveExecutablePath(
  target: string,
  currentContext: string[],
  routeProfile: McpRouteProfile | null,
  derivedContext: DerivedExecutionContext,
  routeResolution?: ScenarioRouteResolution
): ExecutablePathResolution {
  const diagnostics: ExecutablePathResolution["diagnostics"] = [];
  const pathSteps: EntryStepConfig[] = [];
  const insertedSteps: EntryStepConfig[] = [];

  // No route profile -> cannot resolve
  if (!routeProfile) {
    return {
      canResolve: false,
      pathSteps: [],
      insertedSteps: [],
      confidence: "none",
      reasonCode: "no_route_profile",
      diagnostics: [
        {
          level: "error",
          message: `Cannot resolve path to "${target}" - no route profile available`,
        },
      ],
    };
  }

  // Check if target is in allowed executable clicks
  const isAllowedClick = derivedContext.allowedExecutableClicks.some((click) =>
    targetsMatch(target, click)
  );

  if (!isAllowedClick) {
    return {
      canResolve: false,
      pathSteps: [],
      insertedSteps: [],
      confidence: "none",
      reasonCode: "unbacked_target",
      diagnostics: [
        {
          level: "error",
          message: `Target "${target}" is not in allowedExecutableClicks`,
          context: { target, allowedClicks: derivedContext.allowedExecutableClicks.slice(0, 5) },
        },
      ],
    };
  }

  // Strategy 1: Check if target has explicit path definition
  if (routeProfile.targetPaths && routeProfile.targetPaths[target]) {
    const pathDef = routeProfile.targetPaths[target];
    const confidence = pathDef.confidence || "high";

    // Build complete path: entry + intermediates + target
    for (const intermediate of pathDef.requiredIntermediates) {
      if (!currentContext.some((ctx) => targetsMatch(ctx, intermediate))) {
        pathSteps.push({
          action: "click",
          target: intermediate,
          description: `Navigate to ${intermediate}`,
        });
        insertedSteps.push({
          action: "click",
          target: intermediate,
          description: `Inserted intermediate: ${intermediate}`,
        });
      }
    }

    pathSteps.push({
      action: "click",
      target: target,
      description: `Navigate to ${target}`,
    });

    diagnostics.push({
      level: "info",
      message: `Resolved path to "${target}" from explicit targetPaths`,
      context: {
        source: pathDef.source || "explicit",
        intermediatesCount: pathDef.requiredIntermediates.length,
        insertedCount: insertedSteps.length,
      },
    });

    return {
      canResolve: true,
      pathSteps,
      insertedSteps,
      confidence,
      reasonCode: "explicit_path",
      diagnostics,
    };
  }

  // Strategy 2: Check if route resolution has executable steps with this target
  if (routeResolution?.executableRouteSteps) {
    const stepsWithTarget = routeResolution.executableRouteSteps.filter((step) =>
      step.includes(target)
    );

    if (stepsWithTarget.length > 0) {
      // Extract all click targets from executable route steps leading to target
      for (const step of routeResolution.executableRouteSteps) {
        const clickMatch = step.match(/Clic en "([^"]+)"/i);
        if (clickMatch) {
          const clickTarget = clickMatch[1];
          if (!currentContext.some((ctx) => targetsMatch(ctx, clickTarget))) {
            pathSteps.push({
              action: "click",
              target: clickTarget,
              description: `Navigate to ${clickTarget}`,
            });
            if (!targetsMatch(clickTarget, target)) {
              insertedSteps.push({
                action: "click",
                target: clickTarget,
                description: `Inserted intermediate: ${clickTarget}`,
              });
            }
          }
        }
        // Stop if we reached the target
        if (step.includes(target)) {
          break;
        }
      }

      diagnostics.push({
        level: "info",
        message: `Resolved path to "${target}" from executableRouteSteps`,
        context: {
          source: "route_resolution",
          stepsCount: pathSteps.length,
          insertedCount: insertedSteps.length,
        },
      });

      return {
        canResolve: true,
        pathSteps,
        insertedSteps,
        confidence: routeResolution.routeConfidence,
        reasonCode: "route_resolution_path",
        diagnostics,
      };
    }
  }

  // Strategy 3: Infer from intermediates map
  // Look for intermediate groups that contain the target
  if (routeProfile.intermediates) {
    for (const [groupKey, intermediateList] of Object.entries(routeProfile.intermediates)) {
      const targetIndex = intermediateList.findIndex((item) => targetsMatch(item, target));
      if (targetIndex !== -1) {
        // Found target in an intermediate group
        // Add all intermediates before the target that are not in current context
        for (let i = 0; i <= targetIndex; i++) {
          const intermediate = intermediateList[i];
          if (!currentContext.some((ctx) => targetsMatch(ctx, intermediate))) {
            pathSteps.push({
              action: "click",
              target: intermediate,
              description: `Navigate to ${intermediate}`,
            });
            if (i < targetIndex) {
              insertedSteps.push({
                action: "click",
                target: intermediate,
                description: `Inserted intermediate: ${intermediate}`,
              });
            }
          }
        }

        diagnostics.push({
          level: "info",
          message: `Resolved path to "${target}" from intermediates group "${groupKey}"`,
          context: {
            source: "intermediates",
            groupKey,
            stepsCount: pathSteps.length,
            insertedCount: insertedSteps.length,
          },
        });

        return {
          canResolve: true,
          pathSteps,
          insertedSteps,
          confidence: "medium",
          reasonCode: "inferred_from_intermediates",
          diagnostics,
        };
      }
    }
  }

  // Strategy 4: Check if target is an entry point (no intermediates needed)
  if (routeProfile.entry) {
    const isEntry = routeProfile.entry.some(
      (entry) =>
        targetsMatch(entry.visibleLabel, target) || targetsMatch(entry.businessLabel, target)
    );

    if (isEntry) {
      pathSteps.push({
        action: "click",
        target: target,
        description: `Navigate to ${target}`,
      });

      diagnostics.push({
        level: "info",
        message: `Target "${target}" is an entry point - no intermediates needed`,
        context: { source: "entry" },
      });

      return {
        canResolve: true,
        pathSteps,
        insertedSteps: [],
        confidence: "high",
        reasonCode: "entry_point",
        diagnostics,
      };
    }
  }

  // Could not resolve path with confidence
  diagnostics.push({
    level: "warning",
    message: `Cannot resolve path to "${target}" - no explicit path, route steps, or intermediates found`,
    context: {
      target,
      currentContext,
      availableStrategies: ["targetPaths", "routeResolution", "intermediates", "entry"],
    },
  });

  return {
    canResolve: false,
    pathSteps: [],
    insertedSteps: [],
    confidence: "none",
    reasonCode: "unresolvable_path",
    diagnostics,
  };
}

/**
 * Build complete executable path from entry to target
 * Includes entry steps + intermediates + target
 */
export function buildCompleteExecutablePath(
  target: string,
  routeProfile: McpRouteProfile | null,
  derivedContext: DerivedExecutionContext,
  routeResolution?: ScenarioRouteResolution,
  entrySteps?: EntryStepConfig[]
): ExecutablePathResolution {
  const currentContext: string[] = [];

  // Add entry steps to context if provided
  if (entrySteps) {
    for (const step of entrySteps) {
      currentContext.push(step.target);
    }
  } else if (routeProfile?.entry) {
    for (const entry of routeProfile.entry) {
      currentContext.push(entry.visibleLabel);
    }
  }

  // Resolve path from current context
  const resolution = resolveExecutablePath(
    target,
    currentContext,
    routeProfile,
    derivedContext,
    routeResolution
  );

  // Prepend entry steps if not already in path
  if (entrySteps && resolution.canResolve) {
    const allSteps = [...entrySteps, ...resolution.pathSteps];
    return {
      ...resolution,
      pathSteps: allSteps,
    };
  }

  return resolution;
}

/**
 * Log path resolution result
 */
export function logPathResolution(
  target: string,
  resolution: ExecutablePathResolution,
  appSlug: string
): void {
  if (resolution.canResolve) {
    console.log(
      `[path-resolver] appSlug=${appSlug} target="${target}" ` +
        `resolved=true confidence=${resolution.confidence} ` +
        `pathSteps=${resolution.pathSteps.length} ` +
        `insertedSteps=${resolution.insertedSteps.length} ` +
        `reasonCode=${resolution.reasonCode}`
    );

    if (resolution.insertedSteps.length > 0) {
      const insertedTargets = resolution.insertedSteps.map((s) => s.target).join(", ");
      console.log(`[path-resolver] inserted intermediates: ${insertedTargets}`);
    }
  } else {
    console.log(
      `[path-resolver] appSlug=${appSlug} target="${target}" ` +
        `resolved=false reasonCode=${resolution.reasonCode}`
    );
    for (const diag of resolution.diagnostics) {
      if (diag.level === "error" || diag.level === "warning") {
        console.log(`[path-resolver] ${diag.level}: ${diag.message}`);
      }
    }
  }
}
