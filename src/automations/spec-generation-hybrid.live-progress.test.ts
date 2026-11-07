import test from 'node:test';
import assert from 'node:assert/strict';
import {runNodeCommand, extractChildRuntimeTelemetry} from './spec-generation-hybrid';

test('child output reaches the live consumer before exit, including split and final lines', async () => {
  const lines: string[] = [];
  let notify!: () => void;
  const received = new Promise<void>(resolve => { notify = resolve; });
  let settled = false;
  const result = runNodeCommand(process.execPath, ['-e',
    `process.stdout.write('[promoted-');setTimeout(()=>{process.stdout.write('step] stepIndex=1 phase=start\\n');},20);setTimeout(()=>{process.stderr.write('[promoted-step] stepIndex=1 phase=failed');process.exitCode=2;},400);`],
    undefined, line => { lines.push(line); notify(); }).then(value => {settled = true; return value;});
  await received;
  assert.equal(settled, false);
  const output = await result;
  assert.equal(output.ok, false);
  assert.equal(output.exitCode, 2);
  assert.deepEqual(lines, ['[promoted-step] stepIndex=1 phase=start','[promoted-step] stepIndex=1 phase=failed']);
  assert.equal(extractChildRuntimeTelemetry(lines.join('\n')).length, 2);
  assert.match(output.stdout, /phase=start/);
  assert.match(output.stderr, /phase=failed/);
});
