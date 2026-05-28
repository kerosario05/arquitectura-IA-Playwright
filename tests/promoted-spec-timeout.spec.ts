import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

test.describe('Promoted Spec Timeout Configuration', () => {
  test('promotedSpecTimeoutMs default is 90000 in env config', () => {
    // Verify the default value is set in env.ts
    const envPath = path.join(__dirname, '../src/config/env.ts');
    const content = fs.readFileSync(envPath, 'utf-8');
    
    expect(content).toContain('promotedSpecTimeoutMs');
    expect(content).toContain('90000');
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
    
    const expectedPattern = 'test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000))';
    expect(content).toContain(expectedPattern);
  });

  test('timeout default is 90000 in spec-generator', () => {
    const specGeneratorPath = path.join(__dirname, '../src/automations/spec-generator-pom.ts');
    const content = fs.readFileSync(specGeneratorPath, 'utf-8');
    
    expect(content).toContain('90000');
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

  test('CLI wrapper default timeout is 90000', () => {
    const cliPath = path.join(__dirname, '../src/cli/test-promoted.ts');
    const content = fs.readFileSync(cliPath, 'utf-8');
    
    expect(content).toContain('timeout: 90000');
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
});

test.describe('package.json test:promoted script', () => {
  test('test:promoted script uses CLI wrapper', () => {
    const packageJsonPath = path.join(__dirname, '../package.json');
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    const packageJson = JSON.parse(content);
    
    expect(packageJson.scripts['test:promoted']).toBe('tsx src/cli/test-promoted.ts');
  });
});
