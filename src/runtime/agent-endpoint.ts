import { randomUUID } from 'node:crypto'
import { createServer, request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { agentDriver, type AgentSelection } from '../shared/workflow.ts'

export type AgentEndpoint = { url: string; token: string }
const proxyHeaders = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']

function forwardedHeaders(headers: IncomingHttpHeaders) {
  const result = { ...headers }
  for (const name of [...proxyHeaders, ...(headers.connection ?? '').toLowerCase().split(',').map((name) => name.trim())]) delete result[name]
  return result
}

export async function withAgentEndpoint<T>(selection: AgentSelection, apiKey: string | undefined, run: (endpoint?: AgentEndpoint) => Promise<T>) {
  const { baseUrl } = selection
  if (!baseUrl) return run()
  const token = randomUUID()
  const server = createServer((incoming, outgoing) => {
    if (incoming.headers.authorization !== `Bearer ${token}` && incoming.headers['x-api-key'] !== token) {
      outgoing.writeHead(401).end()
      return
    }
    if (!incoming.url?.startsWith('/')) {
      outgoing.writeHead(400).end()
      return
    }
    const url = new URL(baseUrl + incoming.url)
    const headers = forwardedHeaders(incoming.headers)
    delete headers.host
    delete headers.cookie
    delete headers.authorization
    delete headers['x-api-key']
    if (apiKey) {
      if (agentDriver(selection) === 'claude') headers['x-api-key'] = apiKey
      else headers.authorization = `Bearer ${apiKey}`
    }
    const forward = url.protocol === 'https:' ? httpsRequest : httpRequest
    const upstream = forward(url, { method: incoming.method, headers }, (response) => {
      const status = response.statusCode ?? 502
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        outgoing.writeHead(502).end('The model endpoint redirected the request. Configure the destination URL directly.')
        return
      }
      outgoing.writeHead(status, forwardedHeaders(response.headers))
      response.on('error', () => outgoing.destroy())
      response.pipe(outgoing)
    })
    upstream.on('error', () => {
      if (outgoing.headersSent) outgoing.destroy()
      else outgoing.writeHead(502).end('Meshwork could not reach the configured model endpoint.')
    })
    outgoing.on('close', () => upstream.destroy())
    incoming.pipe(upstream)
  })

  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Could not start the model endpoint connection.')
    return await run({ url: `http://127.0.0.1:${address.port}`, token })
  } finally {
    server.close()
    server.closeAllConnections()
  }
}
