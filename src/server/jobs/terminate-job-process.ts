import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import type {ChildProcess} from 'node:child_process';
const exec = promisify(execFile);

export async function terminateJobProcess(child: ChildProcess | undefined, platform = process.platform,
  run: (command:string,args:string[])=>Promise<unknown> = (command,args)=>exec(command,args,{windowsHide:true})) {
  if (!child?.pid || !Number.isSafeInteger(child.pid) || child.pid <= 0) throw new Error('El job no tiene un proceso cancelable');
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (platform === 'win32') {
    await run('taskkill.exe',['/PID',String(child.pid),'/T','/F']);
  } else if (!child.kill('SIGKILL')) {
    throw new Error('No se pudo terminar el proceso del job');
  }
}
