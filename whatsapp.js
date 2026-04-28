import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  downloadMediaMessage,
} from '@whiskeysockets/baileys'
import pino from 'pino'
import QRCode from 'qrcode'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { extractInvoiceData } from './gemini.js'
import { addExpense, createRecord } from './storage.js'
import crypto from 'crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const AUTH_DIR   = path.join(__dirname, 'auth_info_baileys')
const MAX_SIZE   = 4 * 1024 * 1024
const MEDIA_TYPES = new Set(['imageMessage', 'documentMessage', 'videoMessage'])

let everConnected = false
let currentSock   = null
let reconnectAttempts = 0
const MAX_RECONNECTS  = 10

async function clearAuthState() {
  try {
    await fs.promises.rm(AUTH_DIR, { recursive: true, force: true })
    console.log('[WA] Sesión borrada — generando QR nuevo...')
  } catch { /* ignore */ }
}

export async function resetConnection(broadcastSSE) {
  everConnected = false
  if (currentSock) {
    try { currentSock.end() } catch { }
    currentSock = null
  }
  await clearAuthState()
  return initWhatsApp(broadcastSSE)
}

export async function initWhatsApp(broadcastSSE) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
  })
  currentSock = sock

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      console.log('[WA] QR generado — escanea desde el panel web.')
      const qrDataURL = await QRCode.toDataURL(qr, {
        width: 256,
        margin: 2,
        color: { dark: '#111111', light: '#FFFFFF' },
      })
      broadcastSSE({ type: 'qr', data: qrDataURL })
    }

    if (connection === 'close') {
      const err        = lastDisconnect?.error
      const statusCode = err?.output?.statusCode ?? err?.code ?? null
      const isLoggedOut = statusCode === DisconnectReason.loggedOut

      console.log(`[WA] Conexión cerrada. Código: ${statusCode} | Nunca conectado: ${!everConnected}`)

      // Clear stale/partial auth if we got a bad session code OR never connected
      // Status 405 = WhatsApp rejected the session (old partial credentials)
      const badSession = statusCode === 405 || statusCode === 500 || statusCode === 411
      if (badSession || !everConnected) {
        await clearAuthState()
      }

      broadcastSSE({ type: 'disconnected', data: { statusCode } })

      if (!isLoggedOut) {
        if (reconnectAttempts < MAX_RECONNECTS) {
          reconnectAttempts++
          await new Promise(r => setTimeout(r, 3000))
          initWhatsApp(broadcastSSE)
        } else {
          console.error('[WA] Máximo de reconexiones alcanzado. Reinicia el servicio.')
          broadcastSSE({ type: 'disconnected', data: { statusCode: 'MAX_RECONNECTS' } })
        }
      } else {
        console.log('[WA] Sesión cerrada manualmente. Reinicia el servidor para vincular de nuevo.')
      }
    }

    if (connection === 'open') {
      everConnected = true
      reconnectAttempts = 0
      console.log('[WA] Conectado correctamente.')
      broadcastSSE({ type: 'connected', data: { message: 'WhatsApp conectado' } })
    }
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return

    for (const m of messages) {
      if (m.key.fromMe) continue

      const msgType = Object.keys(m.message || {})[0]
      if (!MEDIA_TYPES.has(msgType)) continue

      const from      = m.key.remoteJid
      const mediaInfo = m.message[msgType]
      const mimeType  = mediaInfo?.mimetype || 'image/jpeg'

      try {
        await sock.sendMessage(from, { text: '⏳ Procesando tu factura... un momento.' })

        const buffer = await downloadMediaMessage(m, 'buffer', {})

        if (buffer.length > MAX_SIZE) {
          await sock.sendMessage(from, {
            text: 'El archivo es demasiado grande (máx 4 MB). Envía una imagen de menor tamaño.',
          })
          continue
        }

        const extractedData = await extractInvoiceData(buffer, mimeType)
        const record = createRecord({ from, buffer, mimeType, extractedData })

        addExpense(record)
        broadcastSSE({ type: 'invoice', data: record })

        const proveedor = extractedData.proveedor ?? 'Desconocido'
        const total     = extractedData.total != null
          ? `$ ${Number(extractedData.total).toLocaleString('es-CO')}`
          : 'N/D'
        const confianza = extractedData.confianza ?? 'baja'

        await sock.sendMessage(from, {
          text: `✅ Factura registrada.\n\nProveedor: ${proveedor}\nTotal: ${total} COP\nConfianza IA: ${confianza}\n\nYa puedes verla en el panel web.`,
        })
      } catch (err) {
        console.error('[WA] Error procesando media:', err.message)
        await sock.sendMessage(from, {
          text: '❌ No se pudo procesar la imagen. Asegúrate de que sea una factura legible e inténtalo de nuevo.',
        })
      }
    }
  })

  return sock
}
