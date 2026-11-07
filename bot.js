import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } from '@whiskeysockets/baileys'
import { supabase } from './supabase.js'
import express from 'express'
import fs from 'fs'
import path from 'path'
import pino from 'pino'

const app = express()
const PORT = process.env.PORT || 10000

let latestQR = null
let connectionStatus = 'Starting...'

app.get('/', (req,res) => res.send(`<h1>Nova Cloud: ${connectionStatus}</h1><a href='/qr'>Go to /qr to scan</a>`))

app.get('/qr', (req, res) => {
  if (!latestQR) {
    return res.send(`<h1>${connectionStatus}</h1><p>No QR yet. If connected, you don't need QR. If not, wait 10 sec and refresh.</p><script>setTimeout(()=>location.reload(),3000)</script>`)
  }
  const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(latestQR)}`
  res.send(`
    <html><body style="text-align:center; font-family:sans-serif; padding:20px">
    <h1>Scan Nova Cloud QR</h1>
    <p>Open WhatsApp > Linked Devices > Link a Device</p>
    <img src="${qrImageUrl}" style="border:10px solid black" />
    <p>This QR refreshes every 20 sec - keep refreshing if it expires</p>
    <script>setTimeout(()=>location.reload(),20000)</script>
    <p>Status: ${connectionStatus}</p>
    </body></html>
  `)
})

app.listen(PORT, () => console.log('Server on', PORT))

const AUTH_DIR = './auth_info_baileys'

async function restoreFromSupabase() {
  console.log('Restoring session...')
  if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true })
  fs.mkdirSync(AUTH_DIR, { recursive: true })
  const { data } = await supabase.from('nova_auth').select('*')
  if (!data || data.length === 0) { console.log('No session'); return }
  for (const row of data) {
    const filePath = path.join(AUTH_DIR, row.id)
    try {
      fs.writeFileSync(filePath, typeof row.data === 'object' ? JSON.stringify(row.data) : row.data)
    } catch {}
  }
  console.log(`Restored ${data.length} files`)
}

async function saveToSupabase() {
  try {
    const files = fs.readdirSync(AUTH_DIR)
    for (const file of files) {
      const raw = fs.readFileSync(path.join(AUTH_DIR, file), 'utf8')
      let toSave; try { toSave = JSON.parse(raw) } catch { toSave = raw }
      await supabase.from('nova_auth').upsert({ id: file, data: toSave, updated_at: new Date().toISOString() })
    }
    console.log('Session saved!')
  } catch {}
}

async function startNova() {
  await restoreFromSupabase()
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()
  
  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    browser: ['Nova Cloud', 'Chrome', '1.0']
  })

  sock.ev.on('creds.update', async () => {
    await saveCreds()
    await saveToSupabase()
  })

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) {
      latestQR = qr
      connectionStatus = 'QR Ready - Scan at /qr'
      console.log('QR ready - open /qr page')
    }
    if (connection === 'open') {
      latestQR = null
      connectionStatus = 'ONLINE PERSISTENT ✅'
      console.log('NOVA ONLINE PERSISTENT!')
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
      connectionStatus = 'Reconnecting...'
      if (shouldReconnect) setTimeout(startNova, 3000)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return
    const from = msg.key.remoteJid
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ''
    console.log(`Msg from ${from}: ${text}`)
    if (text.toLowerCase().trim() === 'ping') {
      await sock.sendMessage(from, { text: 'Nova Cloud PONG ✅ PERSISTENT ONLINE' })
    }
  })
}

startNova()
