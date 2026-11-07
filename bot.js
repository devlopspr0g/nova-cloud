import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } from '@whiskeysockets/baileys'
import { supabase } from './supabase.js'
import express from 'express'
import fs from 'fs'
import path from 'path'
import pino from 'pino'

const app = express()
const PORT = process.env.PORT || 10000
let pairingCode = null
let connectionStatus = 'Starting...'

app.get('/', (req,res) => res.send(`<h1>${connectionStatus}</h1><a href='/qr'>Get Pairing Code</a>`))

app.get('/qr', (req, res) => {
  if (pairingCode) {
    res.send(`<html><body style="text-align:center;font-family:sans-serif;padding:30px"><h1>Your Pairing Code</h1><h2 style="font-size:50px;letter-spacing:5px;background:#000;color:#fff;padding:20px">${pairingCode}</h2><p>WhatsApp > Settings > Linked Devices > Link a Device > Link with phone number instead</p><p>Paste this code</p><p>Status: ${connectionStatus}</p></body></html>`)
  } else {
    res.send(`<h1>${connectionStatus}</h1><p>No code yet, wait 5 sec and refresh</p><script>setTimeout(()=>location.reload(),3000)</script>`)
  }
})

app.listen(PORT, () => console.log('Server on', PORT))

const AUTH_DIR = './auth_info_baileys'

async function restoreFromSupabase() {
  if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true })
  fs.mkdirSync(AUTH_DIR, { recursive: true })
  const { data } = await supabase.from('nova_auth').select('*')
  if (!data || data.length === 0) return
  for (const row of data) {
    fs.writeFileSync(path.join(AUTH_DIR, row.id), typeof row.data === 'object' ? JSON.stringify(row.data) : row.data)
  }
}

async function saveToSupabase() {
  try {
    const files = fs.readdirSync(AUTH_DIR)
    for (const file of files) {
      const raw = fs.readFileSync(path.join(AUTH_DIR, file), 'utf8')
      let toSave; try { toSave = JSON.parse(raw) } catch { toSave = raw }
      await supabase.from('nova_auth').upsert({ id: file, data: toSave, updated_at: new Date().toISOString() })
    }
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

  if (!sock.authState.creds.registered) {
    const phoneNumber = '2348137981597' // <-- CHANGE TO YOUR WHATSAPP NUMBER WITH COUNTRY CODE, NO +
    setTimeout(async () => {
      try {
        const code = await sock.requestPairingCode(phoneNumber)
        pairingCode = code
        connectionStatus = `Pairing code: ${code}`
        console.log('PAIRING CODE:', code)
      } catch(e){ console.log('Pair code error', e.message) }
    }, 3000)
  }

  sock.ev.on('creds.update', async () => { await saveCreds(); await saveToSupabase() })

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update
    if (connection === 'open') {
      pairingCode = null
      connectionStatus = 'ONLINE PERSISTENT ✅'
      console.log('NOVA ONLINE!')
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
      if (shouldReconnect) setTimeout(startNova, 3000)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return
    const from = msg.key.remoteJid
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ''
    if (text.toLowerCase().trim() === 'ping') {
      await sock.sendMessage(from, { text: 'Nova Cloud PONG ✅' })
    }
  })
}

startNova()
