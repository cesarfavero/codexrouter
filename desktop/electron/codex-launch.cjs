const { spawn } = require('node:child_process');

function waitForLauncher(executable, argv, options, spawnImpl) {
  return new Promise((resolve, reject) => {
    try {
      const child = spawnImpl(executable, argv, { stdio: 'ignore', windowsHide: true, ...options });
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error('Launcher failed.')));
    } catch (error) { reject(error); }
  });
}

async function launchCodex({ platform = process.platform, env = process.env, projectDir, codexBinary, spawnImpl = spawn }) {
  // LaunchServices opens or focuses an app. It does not reload an existing
  // Codex process; Setup tells users to close Codex completely first.
  if (platform === 'darwin' && !projectDir && !env.CODEX_HOME) {
    try { await waitForLauncher('/usr/bin/open', ['-a', 'Codex'], { env }, spawnImpl); return; }
    catch { /* Try the official CLI launcher when the app is not registered. */ }
  }
  try {
    const bin = codexBinary();
    const opts = { env, ...(projectDir ? { cwd: projectDir } : {}) };
    // Node cannot start npm .cmd/.bat shims directly on Windows.
    if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(bin)) {
      if (/["%\r\n!]/.test(bin)) throw new Error('Unsupported Codex shim path.');
      await waitForLauncher(`"${bin}"`, ['app'], { ...opts, shell: true }, spawnImpl);
    } else {
      await waitForLauncher(bin, ['app', ...(projectDir ? [projectDir] : [])], opts, spawnImpl);
    }
  } catch {
    throw new Error('Could not open Codex Desktop. Verify the official Codex installation, then launch it again after closing any running Codex window.');
  }
}

module.exports = { launchCodex };
