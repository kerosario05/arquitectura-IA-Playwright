import { test, expect } from '@playwright/test';
import path from 'node:path';

test.describe('AuthFlow Import Path Calculation', () => {
  test('buildPortablePathFromSpec calculates correct AuthFlow import for section cases', () => {
    // Spec path: automations/apps/<appSlug>/sections/<sectionSlug>/cases/<caseFolder>/case.spec.ts
    const specPath = path.join(
      process.cwd(),
      'automations/apps/test-app/sections/test-section/cases/c12345-test/case.spec.ts'
    );
    
    // AuthFlow path: automations/apps/<appSlug>/flows/auth.flow.ts
    const authFlowPath = path.join(
      process.cwd(),
      'automations/apps/test-app/flows/auth.flow.ts'
    );
    
    // Calculate relative path
    const relativePath = path.relative(path.dirname(specPath), authFlowPath).replace(/\\/g, '/');
    
    // Expected: ../../../../flows/auth.flow.ts
    // spec is at: automations/apps/test-app/sections/test-section/cases/c12345-test/case.spec.ts
    // auth.flow is at: automations/apps/test-app/flows/auth.flow.ts
    // Need to go up 4 levels: cases -> section -> apps -> flows
    expect(relativePath).toBe('../../../../flows/auth.flow.ts');
  });

  test('buildPortablePathFromSpec calculates correct AuthFlow import for legacy app cases', () => {
    // Spec path: automations/apps/<appSlug>/cases/<caseFolder>/case.spec.ts
    const specPath = path.join(
      process.cwd(),
      'automations/apps/test-app/cases/c12345-test/case.spec.ts'
    );
    
    // AuthFlow path: automations/apps/<appSlug>/flows/auth.flow.ts
    const authFlowPath = path.join(
      process.cwd(),
      'automations/apps/test-app/flows/auth.flow.ts'
    );
    
    // Calculate relative path
    const relativePath = path.relative(path.dirname(specPath), authFlowPath).replace(/\\/g, '/');
    
    // Expected: ../../flows/auth.flow.ts
    // spec is at: automations/apps/test-app/cases/c12345-test/case.spec.ts
    // auth.flow is at: automations/apps/test-app/flows/auth.flow.ts
    // Need to go up 2 levels: cases/c12345-test -> cases -> apps -> flows
    expect(relativePath).toBe('../../flows/auth.flow.ts');
  });

  test('AuthFlow and auth.flow.helpers use same import depth for section cases', () => {
    const specPath = path.join(
      process.cwd(),
      'automations/apps/test-app/sections/test-section/cases/c12345-test/case.spec.ts'
    );
    
    const authFlowPath = path.join(
      process.cwd(),
      'automations/apps/test-app/flows/auth.flow.ts'
    );
    
    const authHelpersPath = path.join(
      process.cwd(),
      'automations/apps/test-app/flows/auth.flow.helpers.ts'
    );
    
    const authFlowRelative = path.relative(path.dirname(specPath), authFlowPath).replace(/\\/g, '/');
    const authHelpersRelative = path.relative(path.dirname(specPath), authHelpersPath).replace(/\\/g, '/');
    
    // Both should have same depth
    const authFlowDepth = authFlowRelative.split('../').length - 1;
    const authHelpersDepth = authHelpersRelative.split('../').length - 1;
    
    expect(authFlowDepth).toBe(authHelpersDepth);
    expect(authFlowDepth).toBe(4); // ../../../../
  });

  test('AuthFlow and auth.flow.helpers use same import depth for legacy cases', () => {
    const specPath = path.join(
      process.cwd(),
      'automations/apps/test-app/cases/c12345-test/case.spec.ts'
    );
    
    const authFlowPath = path.join(
      process.cwd(),
      'automations/apps/test-app/flows/auth.flow.ts'
    );
    
    const authHelpersPath = path.join(
      process.cwd(),
      'automations/apps/test-app/flows/auth.flow.helpers.ts'
    );
    
    const authFlowRelative = path.relative(path.dirname(specPath), authFlowPath).replace(/\\/g, '/');
    const authHelpersRelative = path.relative(path.dirname(specPath), authHelpersPath).replace(/\\/g, '/');
    
    // Both should have same depth
    const authFlowDepth = authFlowRelative.split('../').length - 1;
    const authHelpersDepth = authHelpersRelative.split('../').length - 1;
    
    expect(authFlowDepth).toBe(authHelpersDepth);
    expect(authFlowDepth).toBe(2); // ../../
  });

  test('Generated spec import statement is correct for section cases', () => {
    const specPath = path.join(
      process.cwd(),
      'automations/apps/test-app/sections/test-section/cases/c12345-test/case.spec.ts'
    );
    
    const authFlowPath = path.join(
      process.cwd(),
      'automations/apps/test-app/flows/auth.flow.ts'
    );
    
    const relativePath = path.relative(path.dirname(specPath), authFlowPath).replace(/\\/g, '/').replace(/\.ts$/, '');
    const importStatement = `import { AuthFlow, setAuthFlowTestData } from '${relativePath}';`;
    
    // ../../../../flows/auth.flow (4 levels up from cases/c12345-test to flows)
    expect(importStatement).toBe("import { AuthFlow, setAuthFlowTestData } from '../../../../flows/auth.flow';");
    // Should NOT be only 2 levels up (which would be wrong for section cases)
    expect(importStatement).not.toBe("import { AuthFlow, setAuthFlowTestData } from '../../flows/auth.flow';");
  });

  test('Generated spec import statement is correct for legacy cases', () => {
    const specPath = path.join(
      process.cwd(),
      'automations/apps/test-app/cases/c12345-test/case.spec.ts'
    );
    
    const authFlowPath = path.join(
      process.cwd(),
      'automations/apps/test-app/flows/auth.flow.ts'
    );
    
    const relativePath = path.relative(path.dirname(specPath), authFlowPath).replace(/\\/g, '/').replace(/\.ts$/, '');
    const importStatement = `import { AuthFlow, setAuthFlowTestData } from '${relativePath}';`;
    
    // ../../flows/auth.flow (2 levels up from cases/c12345-test to flows)
    expect(importStatement).toBe("import { AuthFlow, setAuthFlowTestData } from '../../flows/auth.flow';");
  });
});
