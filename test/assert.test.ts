import {describe, expect, it} from 'vitest'
import {runTests, type ResponseFacts} from '../src/shared/assert'
import type {TestRow} from '../src/shared/model'

const res: ResponseFacts = {
  status: 201,
  headers: [['Content-Type', 'application/json; charset=utf-8']],
  body: JSON.stringify({
    token: 'abc',
    user: {id: 7, roles: ['admin', 'dev'], active: true},
    n: null
  }),
  durationMs: 123.4
}

const row = (patch: Partial<TestRow>): TestRow => ({
  target: 'status',
  path: '',
  op: 'equals',
  value: '',
  enabled: true,
  ...patch
})

const passes = (patch: Partial<TestRow>, facts = res) =>
  runTests([row(patch)], facts).results[0].pass

describe('runTests', () => {
  it('checks status, time and headers', () => {
    expect(passes({value: '201'})).toBe(true)
    expect(passes({value: '200'})).toBe(false)
    expect(passes({op: 'lt', value: '300'})).toBe(true)
    expect(passes({target: 'time', op: 'lt', value: '500'})).toBe(true)
    expect(passes({target: 'header', path: 'content-type', op: 'contains', value: 'json'})).toBe(
      true
    )
    expect(passes({target: 'header', path: 'X-Missing', op: 'notExists'})).toBe(true)
  })

  it('checks JSON values of every type', () => {
    expect(passes({target: 'json', path: '$.user.id', value: '7'})).toBe(true)
    expect(passes({target: 'json', path: '$.user.active', value: 'true'})).toBe(true)
    expect(passes({target: 'json', path: '$.n', value: 'null'})).toBe(true)
    expect(passes({target: 'json', path: '$.user.roles', value: '["admin","dev"]'})).toBe(true)
    expect(passes({target: 'json', path: '$.user.roles', op: 'contains', value: 'dev'})).toBe(true)
    expect(passes({target: 'json', path: '$.user', op: 'contains', value: 'roles'})).toBe(true)
    expect(passes({target: 'json', path: '$.user.roles.length', op: 'gt', value: '1'})).toBe(true)
    expect(passes({target: 'json', path: '$.nope', op: 'exists'})).toBe(false)
    expect(passes({target: 'json', path: '$.nope', op: 'notEquals', value: 'x'})).toBe(true)
  })

  it('does not treat an empty expected value as zero', () => {
    expect(passes({value: ''}, {...res, status: 0})).toBe(false)
  })

  it('reports non-JSON bodies and non-numeric comparisons', () => {
    const run = runTests([row({target: 'json', path: '$.a'})], {...res, body: '<html>'})
    expect(run.results[0]).toMatchObject({pass: false, message: 'Response body is not JSON'})
    const cmp = runTests([row({target: 'body', op: 'gt', value: '1'})], res)
    expect(cmp.results[0]).toMatchObject({pass: false, message: 'Both sides must be numbers'})
  })

  it('collects setEnv updates and resolves expected values', () => {
    const run = runTests(
      [
        row({target: 'json', path: '$.token', op: 'setEnv', value: 'token'}),
        row({target: 'json', path: '$.user', op: 'setEnv', value: 'user'}),
        row({target: 'json', path: '$.missing', op: 'setEnv', value: 'x'}),
        row({target: 'json', path: '$.user.id', value: '{{id}}'}),
        row({enabled: false, value: '999'})
      ],
      res,
      (t) => t.replace('{{id}}', '7')
    )
    expect(run.setEnv).toEqual([
      {key: 'token', value: 'abc'},
      {key: 'user', value: JSON.stringify({id: 7, roles: ['admin', 'dev'], active: true})}
    ])
    expect(run.results.map((r) => r.pass)).toEqual([true, true, false, true])
  })
})
