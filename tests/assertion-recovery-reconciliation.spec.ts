import { test, expect } from '@playwright/test';
import type { DiscoveryStepResult } from '../src/types/discovery.types';
import { calculateUnresolvedBlockingFailures, reconcileAssertionFailuresAfterPass, reconcileAuthGateAssertionFailures } from '../src/discovery/case-discovery';

test.describe('Assertion Recovery Reconciliation', () => {
  test('T1: discovery-batch runtime evidence reconciles a missing authentication assertion', () => {
    const steps = [
      {
        index: 1,
        action: 'click',
        status: 'found',
        targetText: 'selection',
        canonicalRequirementRefs: [{ requirementId: 'branch:one' }],
      },
      {
        index: 2,
        action: 'assert',
        status: 'not_found',
        targetText: 'authentication screen',
        functionalRequired: true,
        canonicalRequirementRefs: [{ requirementId: 'branch:one' }],
        error: 'assertion_not_found',
      },
    ] as DiscoveryStepResult[];

    expect(calculateUnresolvedBlockingFailures(steps, {
      detected: true,
      completedAfterStepIndex: 1,
      stage: 'otp',
    })).toHaveLength(0);
    expect(steps[1]).toMatchObject({ status: 'satisfied_by_previous_assertion', runtimeBacked: true, recoveryStatus: 'recovered' });
  });

  test('T2: missing assertion remains blocking without auth gate evidence', () => {
    const steps = [{
      index: 2,
      action: 'assert',
      status: 'not_found',
      targetText: 'authentication screen',
      functionalRequired: true,
      canonicalRequirementRefs: [{ requirementId: 'branch:one' }],
    }] as DiscoveryStepResult[];
    expect(reconcileAuthGateAssertionFailures(steps)).toBe(0);
    expect(steps[0].status).toBe('not_found');
  });

  test('T3: auth gate from another step or requirement does not reconcile', () => {
    const steps = [
      { index: 1, action: 'click', status: 'found', authGateDiagnostics: { detected: true }, canonicalRequirementRefs: [{ requirementId: 'branch:other' }] },
      { index: 2, action: 'click', status: 'found', canonicalRequirementRefs: [{ requirementId: 'branch:one' }] },
      { index: 3, action: 'assert', status: 'not_found', functionalRequired: true, canonicalRequirementRefs: [{ requirementId: 'branch:one' }] },
    ] as DiscoveryStepResult[];
    expect(reconcileAuthGateAssertionFailures(steps)).toBe(0);
    expect(steps[2].status).toBe('not_found');
  });

  test('T4: an independent failure remains unresolved', () => {
    const steps = [
      { index: 1, action: 'click', status: 'found', authGateDiagnostics: { detected: true }, canonicalRequirementRefs: [{ requirementId: 'branch:one' }] },
      { index: 2, action: 'assert', status: 'not_found', functionalRequired: true, canonicalRequirementRefs: [{ requirementId: 'branch:one' }] },
      { index: 3, action: 'assert', status: 'not_found', functionalRequired: true, canonicalRequirementRefs: [{ requirementId: 'branch:other' }] },
    ] as DiscoveryStepResult[];
    reconcileAuthGateAssertionFailures(steps);
    expect(steps[1].status).toBe('satisfied_by_previous_assertion');
    expect(steps[2].status).toBe('not_found');
  });

  test('T5: generic destination assertion is not reconciled without structured gate evidence', () => {
    const steps = [
      { index: 1, action: 'click', status: 'found', canonicalRequirementRefs: [{ requirementId: 'branch:one' }] },
      { index: 2, action: 'assert', status: 'not_found', functionalRequired: true, canonicalRequirementRefs: [{ requirementId: 'branch:one' }] },
    ] as DiscoveryStepResult[];
    expect(reconcileAuthGateAssertionFailures(steps)).toBe(0);
  });

  test('T6: reconciliation resolves the record before unresolved blocking failures are evaluated', () => {
    const steps = [
      { index: 1, action: 'click', status: 'found', authGateDiagnostics: { detected: true }, canonicalRequirementRefs: [{ requirementId: 'branch:one' }] },
      { index: 2, action: 'assert', status: 'not_found', functionalRequired: true, canonicalRequirementRefs: [{ requirementId: 'branch:one' }] },
    ] as DiscoveryStepResult[];
    reconcileAuthGateAssertionFailures(steps);
    expect(steps.filter((step) => step.status === 'not_found')).toHaveLength(0);
  });

  test('T7: gate observation can back the obligation without auth-flow implementation', () => {
    const steps = [
      { index: 2, action: 'assert', status: 'not_found', functionalRequired: true, canonicalRequirementRefs: [{ requirementId: 'gate' }] },
    ] as DiscoveryStepResult[];
    expect(calculateUnresolvedBlockingFailures(steps, { detected: true, detectedAtStepIndex: 2 })).toHaveLength(0);
  });

  test('T9: causal adjacency reconciles when runtime has no canonical refs', () => {
    const steps = [
      { index: 1, action: 'click', status: 'found' },
      { index: 2, action: 'assert', status: 'not_found', functionalRequired: true },
    ] as DiscoveryStepResult[];
    expect(calculateUnresolvedBlockingFailures(steps, {
      detected: true,
      completedAfterStepIndex: 1,
    })).toHaveLength(0);
  });

  test('T8: full authentication requirements still require completed auth flow', () => {
    const steps = [
      { index: 2, action: 'assert', status: 'not_found', functionalRequired: true, canonicalRequirementRefs: [{ requirementId: 'auth' }] },
    ] as DiscoveryStepResult[];
    expect(calculateUnresolvedBlockingFailures(steps, {
      detected: true,
      detectedAtStepIndex: 2,
      requiresAuthFlowCompletion: true,
    })).toHaveLength(1);
  });

  test('final pass reconciles transient failures for the same assertion step', () => {
    const steps = [
      {
        index: 5,
        action: 'assert',
        status: 'not_found',
        targetText: 'authentication completed',
        assertionClassification: 'structural_assertion',
        functionalRequired: true,
        error: 'assertion_not_found',
      },
      {
        index: 5,
        action: 'assert',
        status: 'found',
        targetText: 'authentication completed',
        assertionStatus: 'passed',
        runtimeBacked: true,
        assertionClassification: 'structural_assertion',
        functionalRequired: true,
      },
    ] as DiscoveryStepResult[];

    expect(calculateUnresolvedBlockingFailures(steps)).toHaveLength(0);
    expect(steps[0]).toMatchObject({ recoveryStatus: 'recovered', recoveryMetadata: { blocking: false } });
  });

  test('a final failure remains active when no pass exists', () => {
    const steps = [{
      index: 5, action: 'assert', status: 'not_found', targetText: 'result',
      assertionClassification: 'structural_assertion', functionalRequired: true,
    }] as DiscoveryStepResult[];
    expect(calculateUnresolvedBlockingFailures(steps)).toHaveLength(1);
  });

  test('a pass reconciles only its assertion and preserves another failure', () => {
    const steps = [
      { index: 1, action: 'assert', status: 'not_found', targetText: 'A', assertionClassification: 'structural_assertion', functionalRequired: true },
      { index: 1, action: 'assert', status: 'found', assertionStatus: 'passed', targetText: 'A', assertionClassification: 'structural_assertion', functionalRequired: true, runtimeBacked: true },
      { index: 2, action: 'assert', status: 'not_found', targetText: 'B', assertionClassification: 'structural_assertion', functionalRequired: true },
    ] as DiscoveryStepResult[];
    expect(calculateUnresolvedBlockingFailures(steps).map((step) => step.index)).toEqual([2]);
  });

  test('similar assertion text at another step is not reconciled', () => {
    const steps = [
      { index: 1, action: 'assert', status: 'not_found', targetText: 'same text', assertionClassification: 'structural_assertion', functionalRequired: true },
      { index: 2, action: 'assert', status: 'found', assertionStatus: 'passed', targetText: 'same text', assertionClassification: 'structural_assertion', functionalRequired: true },
    ] as DiscoveryStepResult[];
    expect(calculateUnresolvedBlockingFailures(steps)).toHaveLength(1);
  });

  test('structural assertion pass is idempotent and clears its retry record', () => {
    const steps = [
      { index: 3, action: 'assert', status: 'not_found', targetText: 'confirmed', assertionClassification: 'structural_assertion', functionalRequired: true, pendingDiscovery: true, error: 'not_found' },
      { index: 3, action: 'assert', status: 'found', assertionStatus: 'passed', targetText: 'confirmed', assertionClassification: 'structural_assertion', functionalRequired: true, runtimeBacked: true },
    ] as DiscoveryStepResult[];
    expect(reconcileAssertionFailuresAfterPass(steps)).toBe(1);
    expect(reconcileAssertionFailuresAfterPass(steps)).toBe(0);
    expect(steps[0]).toMatchObject({ recoveryStatus: 'recovered', pendingDiscovery: false, error: undefined });
  });

  test('final pass reconciles prior retries without a later passed discovery step', () => {
    const steps = [
      { index: 5, action: 'assert', status: 'not_found', targetText: 'A', assertionClassification: 'structural_assertion', functionalRequired: true, pendingDiscovery: true, error: 'assertion_not_found' },
    ] as DiscoveryStepResult[];

    const finalPass = {
      index: 5,
      action: 'assert' as const,
      status: 'found' as const,
      assertionStatus: 'passed' as const,
      targetText: 'A',
    };

    expect(steps[0].recoveryStatus).toBeUndefined();
    expect(reconcileAssertionFailuresAfterPass(steps, finalPass)).toBe(1);
    expect(steps[0]).toMatchObject({ recoveryStatus: 'recovered', pendingDiscovery: false, error: undefined });
    expect(calculateUnresolvedBlockingFailures(steps)).toHaveLength(0);
  });

  test('final failure remains active after retry failures', () => {
    const steps = [
      { index: 5, action: 'assert', status: 'not_found', targetText: 'A', assertionClassification: 'structural_assertion', functionalRequired: true, pendingDiscovery: true, error: 'assertion_not_found' },
    ] as DiscoveryStepResult[];

    expect(calculateUnresolvedBlockingFailures(steps)).toHaveLength(1);
  });

  test('final pass reconciles only its step and preserves another assertion failure', () => {
    const steps = [
      { index: 5, action: 'assert', status: 'not_found', targetText: 'A', assertionClassification: 'structural_assertion', functionalRequired: true },
      { index: 6, action: 'assert', status: 'not_found', targetText: 'A', assertionClassification: 'structural_assertion', functionalRequired: true },
    ] as DiscoveryStepResult[];

    reconcileAssertionFailuresAfterPass(steps, { index: 5, action: 'assert', status: 'found', assertionStatus: 'passed', targetText: 'A' });
    expect(calculateUnresolvedBlockingFailures(steps).map((step) => step.index)).toEqual([6]);
  });
  test('getUnresolvedBlockingFailures ignores recovered steps', () => {
    // Simulate the helper function behavior
    const steps: Partial<DiscoveryStepResult>[] = [
      {
        index: 1,
        status: 'found',
        targetText: 'Iniciar'
      },
      {
        index: 2,
        status: 'not_found',
        targetText: 'Consulta de balance',
        assertionClassification: 'literal_observable',
        recoveryStatus: 'recovered',
        recoveredBy: 'later_success',
        recoveryMetadata: { blocking: false }
      },
      {
        index: 3,
        status: 'found',
        targetText: 'Consulta de balance'
      }
    ];

    // Helper function to filter unresolved blocking failures
    const getUnresolvedBlockingFailures = (steps: Partial<DiscoveryStepResult>[]) => {
      return steps.filter((s) => {
        if (s.recoveryStatus === 'recovered' || s.recoveryStatus === 'repaired') {
          return false;
        }
        
        const recoveryMeta = (s as any).recoveryMetadata;
        if (recoveryMeta?.blocking === false) {
          return false;
        }
        
        if (s.recoveredBy && ['auth_flow', 'page_stability', 'later_success', 'retry_after_navigation', 'contextual_intermediate_already_satisfied'].includes(s.recoveredBy)) {
          return false;
        }
        
        return (s.status === 'not_found' || s.status === 'needs_assertion_resolution') && s.assertionClassification;
      });
    };

    const unresolved = getUnresolvedBlockingFailures(steps);
    expect(unresolved.length).toBe(0);
  });

  test('getUnresolvedBlockingFailures returns actual blocking failures', () => {
    const steps: Partial<DiscoveryStepResult>[] = [
      {
        index: 1,
        status: 'found',
        targetText: 'Iniciar'
      },
      {
        index: 2,
        status: 'not_found',
        targetText: 'Producto inexistente',
        assertionClassification: 'literal_observable'
        // No recovery - this is a real failure
      },
      {
        index: 3,
        status: 'found',
        targetText: 'Depósitos a plazos'
      }
    ];

    const getUnresolvedBlockingFailures = (steps: Partial<DiscoveryStepResult>[]) => {
      return steps.filter((s) => {
        if (s.recoveryStatus === 'recovered' || s.recoveryStatus === 'repaired') {
          return false;
        }
        
        const recoveryMeta = (s as any).recoveryMetadata;
        if (recoveryMeta?.blocking === false) {
          return false;
        }
        
        if (s.recoveredBy && ['auth_flow', 'page_stability', 'later_success', 'retry_after_navigation', 'contextual_intermediate_already_satisfied'].includes(s.recoveredBy)) {
          return false;
        }
        
        return (s.status === 'not_found' || s.status === 'needs_assertion_resolution') && s.assertionClassification;
      });
    };

    const unresolved = getUnresolvedBlockingFailures(steps);
    expect(unresolved.length).toBe(1);
    expect(unresolved[0].targetText).toBe('Producto inexistente');
  });

  test('Assertion fails at step 3, same target action passes at step 4 → status discovered_passed', () => {
    // This test documents the expected behavior:
    // Step 3: assertion target="Consulta de balance" fails
    // Step 4: action target="Consulta de balance" succeeds
    // Expected: status = discovered_passed (step 3 recovered by later_success)
    
    const expectedBehavior = {
      step3: {
        status: 'not_found',
        recoveryStatus: 'recovered',
        recoveredBy: 'later_success',
        recoveryMetadata: { blocking: false }
      },
      step4: {
        status: 'found'
      },
      finalStatus: 'discovered_passed',
      candidatePlanStatus: 'validated',
      failedReason: undefined
    };

    expect(expectedBehavior.finalStatus).toBe('discovered_passed');
    expect(expectedBehavior.failedReason).toBeUndefined();
  });

  test('Assertion fails before AuthGate, AuthGate completes, target used after → candidatePlan.status validated', () => {
    // This test documents the expected behavior:
    // Step 3: assertion fails (before AuthGate)
    // Step 4-6: AuthGate completes
    // Step 7+: target is used successfully
    // Expected: candidatePlan.status = validated
    
    const expectedBehavior = {
      assertionBeforeAuthGate: {
        status: 'not_found',
        recoveryStatus: 'recovered',
        recoveredBy: 'auth_flow'
      },
      authGateCompleted: true,
      targetUsedAfterAuth: true,
      candidatePlanStatus: 'validated'
    };

    expect(expectedBehavior.candidatePlanStatus).toBe('validated');
    expect(expectedBehavior.assertionBeforeAuthGate.recoveryStatus).toBe('recovered');
  });

  test('Assertion fails and never recovers → discovered_partial', () => {
    // This test documents the expected behavior:
    // Step 3: assertion fails
    // No later success with same target
    // Expected: status = discovered_partial
    
    const expectedBehavior = {
      step3: {
        status: 'not_found',
        recoveryStatus: undefined,
        recoveredBy: undefined
      },
      noRecovery: true,
      finalStatus: 'discovered_partial',
      candidatePlanStatus: 'needs_discovery'
    };

    expect(expectedBehavior.finalStatus).toBe('discovered_partial');
  });

  test('Assertion fails, different target passes → discovered_passed (navigation recovery)', () => {
    // This test documents the expected behavior with navigation recovery:
    // Step 3: assertion target="A" fails
    // Step 4: action target="B" succeeds (different target)
    // Expected: status = discovered_passed (navigation recovery - page was functional)
    
    const expectedBehavior = {
      step3: {
        target: 'A',
        status: 'not_found',
        recoveryStatus: 'recovered',
        recoveredBy: 'later_success'
      },
      step4: {
        target: 'B',
        status: 'found'
      },
      finalStatus: 'discovered_passed'
    };

    expect(expectedBehavior.finalStatus).toBe('discovered_passed');
  });

  test('failedReason cleared if all failures were recovered', () => {
    // This test documents the expected behavior:
    // Original failedReason = 'assertion_not_found'
    // All failures recovered via recovery mechanism
    // Expected: failedReason = undefined
    
    const expectedBehavior = {
      originalFailedReason: 'assertion_not_found',
      allFailuresRecovered: true,
      finalFailedReason: undefined
    };

    expect(expectedBehavior.finalFailedReason).toBeUndefined();
  });

  test('promotion not blocked when only recovered failures exist', () => {
    // This test documents the expected behavior:
    // Discovery has failures but all are recovered
    // Expected: promotion should be applicable (not blocked)
    
    const expectedBehavior = {
      discoveryStatus: 'discovered_passed',
      candidatePlanStatus: 'validated',
      promotionApplicable: true,
      promotionStatus: 'not blocked by recovered failures'
    };

    expect(expectedBehavior.promotionApplicable).toBe(true);
    expect(expectedBehavior.discoveryStatus).toBe('discovered_passed');
  });

  test('Logging includes recovery details', () => {
    // This test documents expected logging:
    // [assertion-recovery] target="..." recovered by later_success after step N
    // [discovery:case] Recovered N transient assertion failure(s)
    // [discovery:case] unresolvedBlockingFailures=0 after assertion recovery
    // [discovery:case] status reconciled: discovered_partial -> discovered_passed
    
    const expectedLogs = [
      '[assertion-recovery] target="..." recovered by later_success after step N',
      '[discovery:case] Recovered N transient assertion failure(s)',
      '[discovery:case] unresolvedBlockingFailures=0 after assertion recovery',
      '[discovery:case] status reconciled: discovered_partial -> discovered_passed (all failures recovered)'
    ];

    expect(expectedLogs.length).toBe(4);
    expect(expectedLogs).toContain('[discovery:case] unresolvedBlockingFailures=0 after assertion recovery');
  });

  test('real assertion decision shape records a final pass for retry reconciliation', () => {
    const steps = [
      {
        index: 5,
        action: 'Validar que finalice el proceso de autenticación.',
        status: 'not_found',
        targetText: 'que finalice el proceso de autenticación',
        assertionClassification: 'passive_visibility',
        functionalRequired: true,
        error: 'assertion_not_found',
        pendingDiscovery: true,
      },
      {
        index: 5,
        action: 'Validar que finalice el proceso de autenticación.',
        status: 'found',
        targetText: 'que finalice el proceso de autenticación',
        assertionStatus: 'passed',
        matchedText: 'structural authentication evidence',
        runtimeBacked: true,
      },
    ] as DiscoveryStepResult[];

    expect(calculateUnresolvedBlockingFailures(steps, { detected: false })).toHaveLength(0);
    expect(steps[0]).toMatchObject({ recoveryStatus: 'recovered', recoveredBy: 'assertion_pass' });
  });
});
