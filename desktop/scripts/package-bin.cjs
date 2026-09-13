const fs = require('node:fs');
const path = require('node:path');

function resolvePackageBin(packageName, binName = packageName) {
  const entry = require.resolve(packageName);
  let directory = path.dirname(entry);

  while (true) {
    const packageJsonPath = path.join(directory, 'package.json');
    if (fs.existsSync(packageJsonPath)) {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      if (pkg.name === packageName) {
        const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[binName];
        if (!bin) throw new Error(`Package ${packageName} does not expose a ${binName} executable.`);
        const executable = path.resolve(directory, bin);
        if (!fs.existsSync(executable)) throw new Error(`Executable for ${packageName} was not found at ${executable}.`);
        return executable;
      }
    }

    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  throw new Error(`Could not locate package.json for ${packageName} from ${entry}.`);
}

module.exports = { resolvePackageBin };
