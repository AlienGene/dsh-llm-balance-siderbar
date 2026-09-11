/**
 * Host-entry wiring: the facts the aggregator reads from other plugins must be
 * re-read per call, never captured while this plugin mounts.
 *
 * The regression this guards: `llm-pi-ai`'s settings section was read once at
 * mount. A section that was empty at that instant (the provider had not
 * published yet) or a provider added afterwards left every route without its
 * configured credential reference, and a probe then fell back to a catalog
 * default the user had never set — surfacing as "no usage API" for a provider
 * that was configured and working.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { piAiApiKeyEnv } from '../lib/index.js'

function contextWith(settings) {
  return { get: (name) => (name === 'settings' ? settings : undefined) }
}

test('the route credential reference is re-read on every call', () => {
  let section = { providers: {} }
  const read = piAiApiKeyEnv(contextWith({ get: () => section }))
  assert.equal(read('opencode-go'), undefined)

  // The provider is configured later (or the section finally publishes).
  section = { providers: { 'opencode-go': { apiKeyEnv: 'OPENCODE_GO_API_KEY' } } }
  assert.equal(read('opencode-go'), 'OPENCODE_GO_API_KEY')
})

test('an unreadable section reads as "no configured reference"', () => {
  assert.equal(piAiApiKeyEnv(contextWith(undefined))('opencode-go'), undefined)
  assert.equal(piAiApiKeyEnv(contextWith({ get: () => undefined }))('opencode-go'), undefined)
  assert.equal(piAiApiKeyEnv(contextWith({ get: () => ({ providers: null }) }))('opencode-go'), undefined)
  assert.equal(piAiApiKeyEnv(contextWith({ get: () => ({ providers: {} }) }))('opencode-go'), undefined)
  assert.equal(
    piAiApiKeyEnv(contextWith({ get: () => ({ providers: { 'opencode-go': { apiKeyEnv: '' } } }) }))('opencode-go'),
    undefined,
  )
})
