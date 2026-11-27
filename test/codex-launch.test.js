import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import launcher from '../desktop/electron/codex-launch.cjs';
const { launchCodex }=launcher;

function fakeLauncher(...outcomes) {
  const calls=[];
  const spawnImpl=(name,args,options)=>{
    const child=new EventEmitter();
    calls.push({name,args,options});
    const outcome=outcomes.shift();
    queueMicrotask(()=>outcome instanceof Error?child.emit('error',outcome):child.emit('close',outcome));
    return child;
  };
  return {calls,spawnImpl};
}

test('macOS falls back to official CLI if LaunchServices cannot open Codex',async()=>{
  const fixture=fakeLauncher(1,0);
  await launchCodex({platform:'darwin',env:{},codexBinary:()=>'/bin/codex',...fixture});
  assert.deepEqual(fixture.calls.map(x=>[x.name,x.args]),[['/usr/bin/open',['-a','Codex']],['/bin/codex',['app']]]);
});

test('successful native app launch does not start a second launcher',async()=>{
  const fixture=fakeLauncher(0);
  await launchCodex({platform:'darwin',env:{},codexBinary:()=>{throw Error('Unexpected CLI call');},...fixture});
  assert.equal(fixture.calls.length,1);
});

test('custom Codex home follows the CLI launch instead of default LaunchServices',async()=>{
  const fixture=fakeLauncher(0);
  const env={CODEX_HOME:'/path/to/custom codex'};
  await launchCodex({platform:'darwin',env,codexBinary:()=>'/bin/codex',...fixture});
  assert.equal(fixture.calls[0].name,'/bin/codex');
  assert.equal(fixture.calls[0].options.env.CODEX_HOME,env.CODEX_HOME);
});

test('missing CLI becomes a recoverable Setup error, not launch success',async()=>{
  const fixture=fakeLauncher(1,new Error('ENOENT private path'));
  await assert.rejects(launchCodex({platform:'darwin',env:{},codexBinary:()=>'/bin/codex',...fixture}),e=>/Could not open Codex Desktop/.test(e.message)&&!e.message.includes('private path'));
});

test('Windows launch quotes npm shim and uses a fixed subcommand',async()=>{
  const fixture=fakeLauncher(0);
  const bin='C:\\Program Files\\nodejs\\codex.cmd';
  await launchCodex({platform:'win32',env:{},projectDir:'C:\\A project',codexBinary:()=>bin,...fixture});
  assert.deepEqual(fixture.calls[0].args,['app']);
  assert.equal(fixture.calls[0].name,`"${bin}"`);
  assert.equal(fixture.calls[0].options.cwd,'C:\\A project');
});
