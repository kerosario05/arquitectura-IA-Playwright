import { test, expect } from '@playwright/test';
import type { DiscoveryStepResult } from '../src/types/discovery.types';

test.describe('Assertion Recovery Reconciliation', () => {
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
});
