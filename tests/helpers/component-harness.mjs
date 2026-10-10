import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import assert from 'node:assert/strict';

// Regression harness: evaluates component callbacks using controlled hooks,
// synthetic data and fake HTTP responses. It never connects to an app database.
const workspace = dirname(fileURLToPath(import.meta.url));
const sourceRoot = process.cwd();
const requireSource = createRequire(resolve(sourceRoot, 'package.json'));
const ts = requireSource('typescript');
process.env.TZ = 'Asia/Tokyo';

function harness(extraModules = {}) {
  const cells = [], effects = [];
  let cursor = 0;
  const hook = {
    useState(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = typeof initial === 'function' ? initial() : initial;
      return [cells[index], value => { cells[index] = typeof value === 'function' ? value(cells[index]) : value; }];
    },
    useRef(initial) {
      const index = cursor++;
      if (!(index in cells)) cells[index] = { current: initial };
      return cells[index];
    },
    useMemo: fn => fn(),
    useCallback: fn => fn,
    useEffect: fn => { effects.push(fn); },
  };
  const context = {
    Date, Intl, Number, Map, Set, Promise, URLSearchParams, AbortController,
    crypto: globalThis.crypto,
    fetch: (...args) => context.fetchImpl(...args),
    fetchImpl: () => Promise.reject(new Error('offline')),
    window: { addEventListener() {}, removeEventListener() {}, location: { assign() {} } },
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    navigator: { onLine: true },
    console,
  };
  const mocks = {
    react: hook,
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'Fragment' },
    'next/link': { default: 'Link', __esModule: true },
    '@/components/meal-log': { MealLog: 'MealLog' },
    '@/lib/offline/outbox-idb': { listOutboxMutations: async () => [], deleteOutboxMutation: async () => true },
    '@/lib/offline/outbox-events': { OUTBOX_STATE_EVENT: 'outbox', requestOutboxDrain() {} },
    '@/lib/offline/outbox-contract': {},
    ...extraModules,
  };
  const cache = new Map();
  function load(relative) {
    const path = resolve(sourceRoot, relative);
    if (cache.has(path)) return cache.get(path);
    const loadedModule = { exports: {} };
    cache.set(path, loadedModule.exports);
    const code = ts.transpileModule(readFileSync(path, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;
    const localRequire = name => {
      if (name in mocks) return mocks[name];
      if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
      return requireSource(name);
    };
    const invoke = vm.runInNewContext(`(function(require,module,exports){${code}\n})`, context, { filename: path });
    invoke(localRequire, loadedModule, loadedModule.exports);
    cache.set(path, loadedModule.exports);
    return loadedModule.exports;
  }
  return { load, cells, effects, context, render(fn, props) { cursor = 0; effects.length = 0; return fn(props); } };
}
function nodes(tree) {
  if (tree == null || typeof tree === 'boolean') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (typeof tree !== 'object') return [tree];
  return [tree, ...nodes(tree.props?.children)];
}
const nodeOf = (tree, type) => nodes(tree).find(node => node?.type === type);
const textOf = tree => nodes(tree).filter(node => typeof node === 'string' || typeof node === 'number').join(' ');
async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }

export { harness, nodes, nodeOf, textOf, settle };


