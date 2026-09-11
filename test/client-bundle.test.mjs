/**
 * The compiled browser bundle, exercised without a browser.
 *
 * The loader contract is exact — `window.__ModuleLoader__.load({ id, factory })`
 * with the id equal to the package name — and a mismatch shows up only as a
 * silently missing card. Evaluating the real artifact against a stub loader
 * catches that, plus a broken `apply` (a wrong slot key, a missing dictionary),
 * before a page reload is ever needed.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = fileURLToPath(new URL('..', import.meta.url))

/** Load the bundle the way the shell does and return its module exports. */
async function loadBundle() {
  const code = await readFile(join(root, 'client', 'client.js'), 'utf8')
  let captured = null
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(specification) {
          captured = specification
        },
      },
      localStorage: { getItem: () => null, setItem: () => {} },
      setInterval: () => 0,
      clearInterval: () => {},
    },
    document: undefined,
    navigator: { language: 'zh-CN' },
    console,
  }
  vm.runInNewContext(code, sandbox, { filename: 'client/client.js' })
  assert.notEqual(captured, null, 'the bundle did not call window.__ModuleLoader__.load')
  const requireStub = (specifier) => {
    assert.ok(
      ['react', 'react/jsx-runtime'].includes(specifier),
      `the bundle required a non-baseline module: ${specifier}`,
    )
    return { createElement: () => null, jsx: () => null, jsxs: () => null, Fragment: null }
  }
  return { specification: captured, exports: captured.factory(requireStub) }
}

test('the bundle registers itself under the package name', async () => {
  const { specification, exports } = await loadBundle()
  assert.equal(specification.id, 'dsh-llm-balance')
  assert.equal(exports.name, 'dsh-llm-balance')
  // Spread first: values created inside the VM context are not reference-equal
  // to host-realm literals even when they look identical.
  assert.deepEqual([...exports.inject], ['slots', 'locale'])
  assert.equal(typeof exports.apply, 'function')
})

test('apply registers the dictionary and one shell.overlay occupant', async () => {
  const { exports } = await loadBundle()
  const registrations = []
  const effects = []
  let boundNamespace = null
  const ctx = {
    effect(callback, label) {
      effects.push(label)
      const dispose = callback()
      assert.equal(typeof dispose, 'function')
    },
    locale: {
      register(namespace, dictionaries) {
        registrations.push({ kind: 'locale', namespace, dictionaries })
        return () => {}
      },
      bind(namespace) {
        boundNamespace = namespace
        return (key) => key
      },
    },
    slots: {
      inject(key, callback) {
        registrations.push({ kind: 'inject', key })
        callback()
        return () => {}
      },
      register(registration, component) {
        registrations.push({ kind: 'register', registration, component })
        return () => {}
      },
    },
  }
  exports.apply(ctx)

  const locale = registrations.find((entry) => entry.kind === 'locale')
  assert.equal(locale.namespace, 'dsh-llm-balance')
  assert.ok(Object.keys(locale.dictionaries.zh).length > 20)
  assert.ok(Object.keys(locale.dictionaries.en).length > 20)
  assert.equal(locale.dictionaries.zh['error.TOKEN_EXPIRED'].length > 0, true)
  // Both languages must carry exactly the same keys, or one locale silently
  // falls back to a raw key in the UI.
  assert.deepEqual(
    Object.keys(locale.dictionaries.en).sort(),
    Object.keys(locale.dictionaries.zh).sort(),
  )
  assert.equal(boundNamespace, 'dsh-llm-balance')

  assert.deepEqual(
    registrations.filter((entry) => entry.kind === 'inject').map((entry) => entry.key),
    ['shell.overlay'],
  )
  const occupant = registrations.find((entry) => entry.kind === 'register')
  assert.equal(occupant.registration.name, 'shell.overlay')
  assert.equal(occupant.registration.id, 'llm-balance')
  assert.equal(typeof occupant.registration.label(), 'string')
  assert.equal(typeof occupant.component, 'function')
  assert.deepEqual(effects, ['dsh-llm-balance: dictionaries'])
})
