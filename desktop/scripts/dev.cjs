const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..', '..');
const rendererUrl = process.env.CODEXROUTER_RENDERER_URL || 'http://127.0.0.1:5173';
const renderer = new URL(rendererUrl);
const viteBin = require.resolve('vite/bin/vite.js');
const electronBin = require('electron');

function waitForPort(host, port, timeout = 20_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      const socket = net.connect({ host, port });
      socket.once('connect', () => { socket.destroy(); resolve(); });
      socket.once('error', () => {
        socket.destroy();
        if (Date.now() - started > timeout) reject(new Error(`Timed out waiting for ${host}:${port}`));
        else setTimeout(probe, 120);
      });
    };
    probe();
  });
}

const vite = spawn(process.execPath, [viteBin, '--config', path.join(root, 'desktop', 'vite.config.ts'), '--host', renderer.hostname, '--port', renderer.port || '5173'], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

let electron = null;
let stopping = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  electron?.kill('SIGTERM');
  vite.kill('SIGTERM');
  setTimeout(() => process.exit(code), 80).unref();
}

vite.once('exit', code => { if (!stopping) void stop(code || 1); });

waitForPort(renderer.hostname, Number(renderer.port || 5173)).then(() => {
  electron = spawn(electronBin, [root], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CODEXROUTER_RENDERER_URL: rendererUrl },
  });
  electron.once('exit', code => { if (!stopping) void stop(code || 0); });
}).catch(error => {
  console.error(error);
  void stop(1);
});

process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));
