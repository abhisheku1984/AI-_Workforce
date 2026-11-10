// Temporary loader so the smoke test can import .jsx from src/ under plain node.
import { createRequire } from 'node:module';
const require = createRequire('/home/user/AI-_Workforce/package.json');
const { transformSync } = require('esbuild');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = '/home/user/AI-_Workforce';
const SHIMS = {
  react: 'react-shim.mjs',
  'react/jsx-runtime': 'jsx-runtime-shim.mjs',
  'react-dom/client': 'reactdom-shim.mjs',
  'react-dom': 'reactdom-shim.mjs',
  'react-router-dom': 'rrd-shim.mjs',
  recharts: 'recharts-shim.mjs',
};

export async function resolve(specifier, context, next) {
  if (SHIMS[specifier]) return { url: pathToFileURL(path.join(REPO, 'tests', 'support', SHIMS[specifier])).href, shortCircuit: true };
  if (!specifier.startsWith('.') && !specifier.startsWith('node:') && !specifier.startsWith('/') && !specifier.startsWith('file:')) {
    // Resolve with require.resolve, never import.meta.resolve: the latter re-enters this hook
    // for the same specifier and hangs the process. Only take over .js/.jsx targets; everything
    // else (node builtins, npm packages) falls through to node's own resolver.
    try {
      const resolved = require.resolve(specifier);
      if (/\.jsx?$/.test(resolved)) return { url: pathToFileURL(resolved).href, shortCircuit: true };
    } catch { /* not resolvable from here — let node try */ }
  }
  if (specifier.startsWith('.') && context.parentURL) {
    const abs = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
    for (const ext of ['', '.jsx', '.js', '/index.jsx', '/index.js']) {
      if (fs.existsSync(abs + ext) && fs.statSync(abs + ext).isFile()) return { url: pathToFileURL(abs + ext).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  // Match on the pathname: render.js imports main.jsx with a ?route= cache-buster.
  const pathname = url.startsWith('file:') ? new URL(url).pathname : '';
  if (pathname.endsWith('.css')) return { format: 'module', source: 'export default {};', shortCircuit: true };
  if (/\.jsx?$/.test(pathname)) {
    const file = fileURLToPath(url);
    // Only transform application sources. Transforming node_modules with esbuild per file
    // takes megabytes of work and appears to hang the process.
    if (!file.startsWith(REPO) || file.includes('node_modules')) return next(url, context);
    const out = transformSync(fs.readFileSync(file, 'utf8'), { loader: 'jsx', format: 'esm', jsx: 'automatic', target: 'node20', sourcefile: file });
    return { format: 'module', source: out.code, shortCircuit: true };
  }
  return next(url, context);
}
