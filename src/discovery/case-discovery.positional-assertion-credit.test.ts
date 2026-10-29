import assert from "node:assert/strict";
import test from "node:test";
import { creditPositionallySatisfiedAssertions } from "./case-discovery";

/**
 * FIRST_LOSS (job fe5f2bbc, "cuenta 2"): step 7 "El sistema muestra X" was satisfied right
 * after step 6, but X only exists on that screen; the final evaluation (after step 19, on the
 * next route) left it pending and the spec contract refused step 7 as unresolved.
 */
const assertion = { index: 7, target: 'El sistema muestra "Selecciona la cuenta de tu preferencia"' };

function evaluation(satisfiedNow: boolean) {
  return {
    satisfied: satisfiedNow,
    satisfiedAssertions: satisfiedNow ? [assertion.target] : [],
    pendingAssertions: satisfiedNow ? [] : [assertion.target],
    deferredAssertions: [] as string[],
    blockingAssertions: satisfiedNow ? [] : [assertion.target],
  };
}

test("an assertion seen at its own position stays satisfied after its screen is gone", () => {
  const memory = new Set<string>();
  creditPositionallySatisfiedAssertions(evaluation(true), [assertion], 6, 8, memory);
  const final = creditPositionallySatisfiedAssertions(evaluation(false), [assertion], 19, undefined, memory);
  assert.equal(final.satisfied, true);
  assert.deepEqual(final.pendingAssertions, []);
  assert.deepEqual(final.blockingAssertions, []);
  assert.ok(final.satisfiedAssertions.includes(assertion.target));
});

test("seeing the text before reaching the assertion's position earns no credit", () => {
  const memory = new Set<string>();
  // After step 3 the next action is 4: step 7 is not yet the next thing in the scenario.
  creditPositionallySatisfiedAssertions(evaluation(true), [assertion], 3, 4, memory);
  const final = creditPositionallySatisfiedAssertions(evaluation(false), [assertion], 19, undefined, memory);
  assert.equal(final.satisfied, false);
  assert.deepEqual(final.pendingAssertions, [assertion.target]);
});

test("an assertion never observed at its position stays pending", () => {
  const memory = new Set<string>();
  creditPositionallySatisfiedAssertions(evaluation(false), [assertion], 6, 8, memory);
  const final = creditPositionallySatisfiedAssertions(evaluation(false), [assertion], 19, undefined, memory);
  assert.equal(final.satisfied, false);
});
