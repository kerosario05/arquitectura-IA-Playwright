import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Promoted Spec Timeout Configuration', () => {
  test('promotedSpecTimeoutMs default is 120000 in env config', () => {
    // Verify the default value is set in env.ts
    const envPath = path.join(__dirname, '../src/config/env.ts');
    const content = fs.readFileSync(envPath, 'utf-8');
    
    expect(content).toContain('promotedSpecTimeoutMs');
    expect(content).toContain('120000');
  });

  test('promotedSpecTimeoutMs is in execution config type', () => {
    const typesPath = path.join(__dirname, '../src/types/env.types.ts');
    const content = fs.readFileSync(typesPath, 'utf-8');
    
    expect(content).toContain('promotedSpecTimeoutMs');
  });
});

test.describe('Generated Spec Timeout Insertion', () => {
  test('generated spec includes test.setTimeout call', () => {
    const specGeneratorPath = path.join(__dirname, '../src/automations/spec-generator-pom.ts');
    const content = fs.readFileSync(specGeneratorPath, 'utf-8');
    
    const expectedPattern = 'test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 120000))';
    expect(content).toContain(expectedPattern);
  });

  test('timeout default is 120000 in spec-generator', () => {
    const specGeneratorPath = path.join(__dirname, '../src/automations/spec-generator-pom.ts');
    const content = fs.readFileSync(specGeneratorPath, 'utf-8');
    
    expect(content).toContain('120000');
  });
});

test.describe('test:promoted CLI Wrapper', () => {
  test('CLI wrapper file exists', () => {
    const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
    expect(fs.existsSync(cliPath)).toBe(true);
  });

  test('CLI wrapper includes --app flag parsing', () => {
    const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
    const content = fs.readFileSync(cliPath, 'utf-8');
    
    expect(content).toContain('--app');
  });

  test('CLI wrapper includes --section flag parsing', () => {
    const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
    const content = fs.readFileSync(cliPath, 'utf-8');
    
    expect(content).toContain('--section');
  });

  test('CLI wrapper includes --case-id flag parsing', () => {
    const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
    const content = fs.readFileSync(cliPath, 'utf-8');
    
    expect(content).toContain('--case-id');
  });

  test('CLI wrapper includes --headed flag', () => {
    const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
    const content = fs.readFileSync(cliPath, 'utf-8');
    
    expect(content).toContain('--headed');
  });

  test('CLI wrapper includes --parallel flag', () => {
    const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
    const content = fs.readFileSync(cliPath, 'utf-8');
    
    expect(content).toContain('--parallel');
  });

  test('CLI wrapper default timeout is 120000', () => {
    const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
    const content = fs.readFileSync(cliPath, 'utf-8');
    
    expect(content).toContain('timeout: 120000');
  });

  test('CLI wrapper default workers is 1 (serial)', () => {
    const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
    const content = fs.readFileSync(cliPath, 'utf-8');
    
    expect(content).toContain('workers: 1');
  });

  test('CLI wrapper respects PROMOTED_SPEC_TIMEOUT_MS env var', () => {
    const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
    const content = fs.readFileSync(cliPath, 'utf-8');
    
    expect(content).toContain('PROMOTED_SPEC_TIMEOUT_MS');
  });

  test('CLI wrapper includes help documentation', () => {
    const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
    const content = fs.readFileSync(cliPath, 'utf-8');
    
    expect(content).toContain('Usage:');
    expect(content).toContain('--help');
  });

  test('CLI wrapper uses shell:false to prevent pipe interpretation', () => {
    const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
    const content = fs.readFileSync(cliPath, 'utf-8');
    
    expect(content).toContain('shell: false');
    expect(content).toContain('process.execPath');
  });

  test('CLI wrapper spawns node directly with cli.js to avoid shell', () => {
    const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
    const content = fs.readFileSync(cliPath, 'utf-8');
    
    expect(content).toContain('cli.js');
    expect(content).toContain('spawnArgs');
  });

  test('CLI wrapper propagates canonical evidence identity env vars to Playwright child', () => {
    const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
    const content = fs.readFileSync(cliPath, 'utf-8');

    expect(content).toContain('EVIDENCE_APP_SLUG');
    expect(content).toContain('EVIDENCE_SECTION_SLUG');
    expect(content).toContain('env: playwrightEnv');
  });
});

test.describe('CLI Exact Spec Handling', () => {
  test('grep pattern with pipes is preserved as single argument', () => {
    const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
    const content = fs.readFileSync(cliPath, 'utf-8');
    
    // Verify grep is pushed as single argument with --grep= prefix
    expect(content).toMatch(/playwrightArgs\.push\(`--grep=/);
  });

  test('--case-id resolves the persisted promoted spec instead of using grep', () => {
    const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
    const content = fs.readFileSync(cliPath, 'utf-8');
    
    expect(content).toContain('resolvePromotedSpecPath(options)');
    expect(content).not.toMatch(/--grep=C\$\{options\.caseId\}/);
  });
});

test.describe('package.json test:promoted script', () => {
  test('test:promoted script uses CLI wrapper', () => {
    const packageJsonPath = path.join(__dirname, '../package.json');
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);
    
    expect(packageJson.scripts['test:promoted']).toBe('tsx src/cli/test-promoted.ts');
  });
});
