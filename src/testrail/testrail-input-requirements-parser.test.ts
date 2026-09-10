import { describe, expect, it } from 'vitest';
import { parseTestRailInputRequirements } from './testrail-input-requirements-parser';

describe('TestRail input requirements parser', () => {
  it('parses multiple generic declarations into structured requirements', () => {
    const result = parseTestRailInputRequirements(
      '- Company identifier (business.id, text)\n- Access token (session.token, secret)',
    );

    expect(result.requirements).toEqual([
      { key: 'business.id', label: 'Company identifier', controlType: 'text', required: true, sensitive: false, allowedValues: [] },
      { key: 'session.token', label: 'Access token', controlType: 'secret', required: true, sensitive: true, allowedValues: [] },
    ]);
    expect(result.unresolvedPlaceholders).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it('validates declared and undeclared placeholders without creating implicit requirements', () => {
    const result = parseTestRailInputRequirements(
      'Identifier (account.id, text)\nUse [account.id] and [account.missing]',
    );

    expect(result.requirements).toHaveLength(1);
    expect(result.unresolvedPlaceholders).toEqual(['account.missing']);
    expect(result.conflicts).toEqual([]);
  });

  it('deduplicates identical declarations and reports conflicting metadata', () => {
    const result = parseTestRailInputRequirements(
      'User (account.value, text)\nUser (account.value, text)\nSecret user (account.value, secret)',
    );

    expect(result.requirements).toHaveLength(1);
    expect(result.requirements[0].label).toBe('User');
    expect(result.conflicts).toEqual([
      {
        key: 'account.value',
        existing: { key: 'account.value', label: 'User', controlType: 'text', required: true, sensitive: false, allowedValues: [] },
        incoming: { key: 'account.value', label: 'Secret user', controlType: 'secret', required: true, sensitive: true, allowedValues: [] },
      },
    ]);
  });

  it('preserves declared labels and secret metadata when declarations arrive as TestRail HTML', async () => {
    const { extractTestRailInputRequirements } = await import('./testrail-input-requirements-adapter');
    const result = extractTestRailInputRequirements({
      id: 44759,
      title: 'fixture',
      custom_preconds: '<ol><li>- Cédula empleado 1 (employee_1.document, text)</li><li>- Contraseña (auth.password, secret) [SECRETO]</li></ol>',
    });

    expect(result.requirements).toEqual([
      { key: 'employee_1.document', label: 'Cédula empleado 1', controlType: 'text', required: true, sensitive: false, allowedValues: [] },
      { key: 'auth.password', label: 'Contraseña', controlType: 'secret', required: true, sensitive: true, allowedValues: [] },
    ]);
  });

  it('accepts declarative markers after the control type without losing sensitivity', () => {
    const result = parseTestRailInputRequirements('Contraseña (auth.password, secret) [SECRETO]');
    expect(result.requirements[0]).toMatchObject({
      key: 'auth.password',
      label: 'Contraseña',
      controlType: 'secret',
      sensitive: true,
    });
  });
});
