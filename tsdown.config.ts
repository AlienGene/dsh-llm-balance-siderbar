/**
 * Build recipe for dsh-llm-balance.
 *
 * Two halves, mirroring the shipped client preset (`packages/client/tsdown.client.ts`)
 * and the published configurations of dsh-context / dshmarket:
 *
 * 1. Host half — plain ESM for the Node loader. `.js`/`.d.ts` land in `lib/`
 *    (`fixedExtension: false` keeps the emitted extension stable under
 *    `"type": "module"`), and every pure module is also an entry so the Node
 *    test runner can import the built artifact instead of source.
 * 2. Browser half — one CommonJS closure factory named by `package.json`'s
 *    `./client` export. `react` / `react/jsx-runtime` stay `require(...)`
 *    calls satisfied by the shell's frozen module table; everything else
 *    inlines, because a require the table cannot answer is a guaranteed
 *    runtime throw.
 */
import { defineConfig } from 'tsdown'

const CLIENT_ID = 'dsh-llm-balance'

/** Baseline module-table entries this bundle may require at runtime. */
const CLIENT_EXTERNALS = ['react', 'react/jsx-runtime']

export default defineConfig([
  {
    name: CLIENT_ID,
    entry: {
      index: 'src/index.ts',
      state: 'src/state.ts',
      providers: 'src/providers/index.ts',
      config: 'src/config.ts',
      format: 'src/format.ts',
      modes: 'src/modes.ts',
      protocol: 'src/protocol.ts',
    },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
  },
  {
    name: `${CLIENT_ID}/client`,
    entry: { client: 'src/client/index.tsx' },
    outDir: 'client',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    // A declaration file here would wrap the factory banner/footer into a
    // `.d.cts` the browser never loads; the host half ships the types.
    dts: false,
    clean: false,
    external: CLIENT_EXTERNALS,
    noExternal: (specifier: string) => (CLIENT_EXTERNALS.includes(specifier) ? undefined : true),
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'import.meta.env.MODE': JSON.stringify('production'),
      'import.meta.env': JSON.stringify({ MODE: 'production' }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(CLIENT_ID)}, factory: (require) => {`,
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: 'return module.exports; } });',
    },
  },
])
