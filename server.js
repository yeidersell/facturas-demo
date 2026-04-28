import 'dotenv/config'
import express from 'express'
import { fileURLToPath } from 'url'
import path from 'path'
import { initStorage, getExpenses } from './storage.js'
import { initWhatsApp, resetConnection } from './whatsapp.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const PORT = process.env.PORT || 3000

// ── SSE Broker ────────────────────────────────────────────────────────────────
const sseClients = new Set()
let lastQR = null
let connectionStatus = 'disconnected'

function broadcastSSE({ type, data }) {
  if (type === 'qr') lastQR = data
  if (type === 'connected') { connectionStatus = 'connected'; lastQR = null }
  if (type === 'disconnected') connectionStatus = 'disconnected'

  const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of sseClients) {
    try {
      res.write(payload)
    } catch {
      sseClients.delete(res)
    }
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')))

app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  next()
})

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }))

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.flushHeaders()

  // Replay current state to newly connected client
  if (connectionStatus === 'connected') {
    res.write(`event: connected\ndata: ${JSON.stringify({ message: 'WhatsApp conectado' })}\n\n`)
  } else if (lastQR) {
    res.write(`event: qr\ndata: ${JSON.stringify(lastQR)}\n\n`)
  }

  // Heartbeat to prevent proxy timeouts
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n') } catch { /* client gone */ }
  }, 25000)

  sseClients.add(res)

  req.on('close', () => {
    clearInterval(heartbeat)
    sseClients.delete(res)
  })
})

app.get('/api/expenses', (_req, res) => {
  res.json(getExpenses())
})

app.post('/api/reset-whatsapp', async (_req, res) => {
  lastQR = null
  connectionStatus = 'disconnected'
  broadcastSSE({ type: 'disconnected', data: { statusCode: null } })
  resetConnection(broadcastSSE).catch(console.error)
  res.json({ ok: true })
})

// ── Bootstrap ─────────────────────────────────────────────────────────────────
initStorage()

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`)
})

initWhatsApp(broadcastSSE).catch(err => {
  console.error('Error al iniciar WhatsApp:', err)
})
