import fs from 'node:fs';
import path from 'node:path';

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

export function readJson(pathname, fallback = undefined) {
  try {
    return JSON.parse(fs.readFileSync(pathname, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw error;
  }
}

export function writeJsonAtomic(pathname, value, mode = 0o600) {
  ensureDir(path.dirname(pathname));
  const temp = `${pathname}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.renameSync(temp, pathname);
  try { fs.chmodSync(pathname, mode); } catch {}
}

export function writeTextAtomic(pathname, value, mode = 0o600) {
  ensureDir(path.dirname(pathname));
  const temp = `${pathname}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, value, { mode });
  fs.renameSync(temp, pathname);
  try { fs.chmodSync(pathname, mode); } catch {}
}
