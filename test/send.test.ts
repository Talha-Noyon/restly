import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import * as http from 'node:http'
import * as zlib from 'node:zlib'
import type {AddressInfo} from 'node:net'
import {decompress, sendRequest, RequestError, type SendOptions} from '../src/extension/http/send'
import {encodeMultipart} from '../src/extension/http/multipart'
import {bodyKind, toResponseView, TEXT_LIMIT} from '../src/extension/http/view'
import type {PreparedRequest} from '../src/shared/prepare'

let server: http.Server
let base = ''

const options: SendOptions = {
  timeoutMs: 5000,
  followRedirects: true,
  maxRedirects: 5,
  strictSSL: true
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://local')
      const body = Buffer.concat(chunks).toString('utf8')
      switch (url.pathname) {
        case '/echo':
          res.setHeader('Content-Type', 'application/json')
          res.end(
            JSON.stringify({method: req.method, headers: req.headers, body, query: url.search})
          )
          return
        case '/gzip':
          res.setHeader('Content-Encoding', 'gzip')
          res.setHeader('Content-Type', 'text/plain')
          res.end(zlib.gzipSync('hello gzip'))
          return
        case '/redirect':
          res.statusCode = Number(url.searchParams.get('code') ?? 302)
          res.setHeader('Location', url.searchParams.get('to') ?? '/echo')
          res.end()
          return
        case '/loop':
          res.statusCode = 302
          res.setHeader('Location', '/loop')
          res.end()
          return
        case '/slow':
          setTimeout(() => res.end('late'), 2000)
          return
        default:
          res.statusCode = 404
          res.end('not found')
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => {
  server.closeAllConnections()
  server.close()
})

const req = (patch: Partial<PreparedRequest>): PreparedRequest => ({
  method: 'GET',
  url: `${base}/echo`,
  headers: [],
  body: {kind: 'none'},
  ...patch
})

const json = (body: Buffer) => JSON.parse(body.toString('utf8'))

describe('sendRequest', () => {
  it('sends method, headers and body and reports timing', async () => {
    const res = await sendRequest(
      req({
        method: 'POST',
        headers: [
          ['X-Test', 'a'],
          ['x-test', 'b'],
          ['Content-Type', 'application/json']
        ],
        body: {kind: 'text', text: '{"a":1}'}
      }),
      options
    )
    expect(res.status).toBe(200)
    const echo = json(res.body)
    expect(echo.method).toBe('POST')
    expect(echo.body).toBe('{"a":1}')
    expect(echo.headers['x-test']).toBe('a, b')
    expect(echo.headers['content-length']).toBe('7')
    expect(echo.headers['accept-encoding']).toBe('gzip, deflate, br')
    expect(res.durationMs).toBeGreaterThan(0)
    expect(res.headers.find(([k]) => k.toLowerCase() === 'content-type')?.[1]).toBe(
      'application/json'
    )
  })

  it('encodes form bodies', async () => {
    const res = await sendRequest(
      req({
        method: 'POST',
        body: {
          kind: 'form',
          fields: [
            ['a b', 'c&d'],
            ['e', 'é']
          ]
        }
      }),
      options
    )
    expect(json(res.body).body).toBe('a+b=c%26d&e=%C3%A9')
  })

  it('sends multipart bodies with files read through the injected reader', async () => {
    const res = await sendRequest(
      req({
        method: 'POST',
        headers: [['Content-Type', 'multipart/form-data']],
        body: {
          kind: 'multipart',
          fields: [
            {key: 'title', value: 'hi', file: false},
            {key: 'doc', value: 'C:\\files\\notes.txt', file: true}
          ]
        }
      }),
      {...options, readFile: async () => Buffer.from('file-content')}
    )
    const echo = json(res.body)
    expect(echo.headers['content-type']).toMatch(
      /^multipart\/form-data; boundary=----RestlyBoundary/
    )
    expect(echo.body).toContain('name="title"\r\n\r\nhi\r\n')
    expect(echo.body).toContain(
      'name="doc"; filename="notes.txt"\r\nContent-Type: text/plain\r\n\r\nfile-content'
    )
  })

  it('reports unreadable files', async () => {
    await expect(
      sendRequest(req({method: 'POST', body: {kind: 'file', path: '/nope/missing.bin'}}), options)
    ).rejects.toMatchObject({code: 'EFILE'})
  })

  it('decompresses gzip responses', async () => {
    const res = await sendRequest(req({url: `${base}/gzip`}), options)
    expect(res.body.toString()).toBe('hello gzip')
  })

  it('follows redirects, switching to GET on 303', async () => {
    const res = await sendRequest(
      req({
        method: 'POST',
        url: `${base}/redirect?code=303&to=/echo?x=1`,
        body: {kind: 'text', text: 'payload'}
      }),
      options
    )
    expect(res.redirects).toBe(1)
    const echo = json(res.body)
    expect(echo.method).toBe('GET')
    expect(echo.body).toBe('')
    expect(echo.query).toBe('?x=1')
  })

  it('keeps method and body on 307', async () => {
    const res = await sendRequest(
      req({method: 'PUT', url: `${base}/redirect?code=307`, body: {kind: 'text', text: 'keep'}}),
      options
    )
    expect(json(res.body)).toMatchObject({method: 'PUT', body: 'keep'})
  })

  it('drops credentials when a redirect changes origin', async () => {
    const other = base.replace('127.0.0.1', 'localhost')
    const res = await sendRequest(
      req({
        url: `${base}/redirect?to=${encodeURIComponent(`${other}/echo`)}`,
        headers: [
          ['Authorization', 'Bearer secret'],
          ['X-Keep', '1']
        ]
      }),
      options
    )
    const echo = json(res.body)
    expect(echo.headers.authorization).toBeUndefined()
    expect(echo.headers['x-keep']).toBe('1')
  })

  it('stops on redirect loops and can skip redirects', async () => {
    await expect(sendRequest(req({url: `${base}/loop`}), options)).rejects.toMatchObject({
      code: 'EREDIRECTS'
    })
    const res = await sendRequest(req({url: `${base}/loop`}), {...options, followRedirects: false})
    expect(res.status).toBe(302)
  })

  it('times out and cancels', async () => {
    await expect(
      sendRequest(req({url: `${base}/slow`}), {...options, timeoutMs: 100})
    ).rejects.toMatchObject({code: 'ETIMEDOUT'})

    const controller = new AbortController()
    const pending = sendRequest(req({url: `${base}/slow`}), {...options, signal: controller.signal})
    setTimeout(() => controller.abort(), 50)
    await expect(pending).rejects.toMatchObject({code: 'ECANCELLED'})
  })

  it('explains bad urls and refused connections', async () => {
    await expect(sendRequest(req({url: 'not a url'}), options)).rejects.toMatchObject({
      code: 'EINVALIDURL'
    })
    await expect(sendRequest(req({url: 'ftp://x.io'}), options)).rejects.toMatchObject({
      code: 'EPROTOCOL'
    })
    const error = await sendRequest(req({url: 'http://127.0.0.1:1/'}), options).catch((e) => e)
    expect(error).toBeInstanceOf(RequestError)
    expect(error.code).toBe('ECONNREFUSED')
    expect(error.message).toContain('Connection refused')
  })

  it('aborts bodies over the size limit', async () => {
    await expect(
      sendRequest(req({url: `${base}/echo`}), {...options, maxBodyBytes: 10})
    ).rejects.toMatchObject({code: 'ETOOLARGE'})
  })
})

describe('response helpers', () => {
  it('leaves undecodable bodies as they are', () => {
    expect(decompress(Buffer.from('plain'), 'gzip').toString()).toBe('plain')
    expect(decompress(zlib.brotliCompressSync('br!'), 'br').toString()).toBe('br!')
    expect(decompress(zlib.deflateRawSync('raw'), 'deflate').toString()).toBe('raw')
  })

  it('classifies bodies', () => {
    expect(bodyKind(Buffer.from('{}'), 'application/json')).toBe('text')
    expect(bodyKind(Buffer.from('<svg/>'), 'image/svg+xml')).toBe('text')
    expect(bodyKind(Buffer.from([0x89, 0x50]), 'image/png')).toBe('image')
    expect(bodyKind(Buffer.from([1, 0, 2]), 'application/octet-stream')).toBe('binary')
    expect(bodyKind(Buffer.from('hello'), '')).toBe('text')
  })

  it('truncates very large text bodies', () => {
    const view = toResponseView({
      status: 200,
      statusText: 'OK',
      headers: [['Content-Type', 'text/plain; charset=latin1']],
      body: Buffer.alloc(TEXT_LIMIT + 10, 'a'),
      durationMs: 1,
      url: 'http://x',
      redirects: 0
    })
    expect(view.truncated).toBe(true)
    expect(view.bodyText.length).toBe(TEXT_LIMIT)
    expect(view.size).toBe(TEXT_LIMIT + 10)
  })

  it('builds multipart bodies with escaped names', async () => {
    const {data, contentType} = await encodeMultipart(
      [{key: 'a"b', value: 'x', file: false}],
      async () => Buffer.alloc(0),
      'B'
    )
    expect(contentType).toBe('multipart/form-data; boundary=B')
    expect(data.toString()).toBe(
      '--B\r\nContent-Disposition: form-data; name="a%22b"\r\n\r\nx\r\n--B--\r\n'
    )
  })
})
