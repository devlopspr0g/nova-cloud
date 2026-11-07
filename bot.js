import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason } from '@whiskeysockets/baileys'
import { supabase } from './supabase.js'
import express from 'express'
import fs from 'fs'
import path from 'path'
import pino from 'pino'

const app = express()
const PORT = process.env.PORT || 10000
app.get('/', (req,res) => res.send('Nova Cloud ONLINE - Waiting for QR'))
app.listen(PORT, () => console.log('Server on', PORT))

const AUTH_DIR = './auth_info_baileys'

async function restoreFromSupabase() {
  console.log('Restoring session...')
  if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true })
  fs.mkdirSync(AUTH_DIR, { recursive: true })
  
  const { data, error } = await supabase.from('nova_auth').select('*')
  if (error || !data || data.length === 0) { 
    console.log('No session found - will generate QR'); 
    return 
  }
  
  for (const row of data) {
    const filePath = path.join(AUTH_DIR, row.id)
    try {
      const c = row.data
      fs.writeFileSync(filePath, typeof c === 'object' ? JSON.stringify(c) : c)
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
    console.log('Session saved to Supabase!')
  } catch (e) {
    console.log('Save error', e.message)
  }
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
      console.log('=== SCAN QR BELOW ===')
      console.log(qr)
      console.log('=== COPY ABOVE QR STRING TO: https://wa-qrcode-generator.netlify.app/ ===')
    }
    if (connection === 'open') {
      console.log('NOVA ONLINE PERSISTENT - Connected!')
    }
    if (connection === 'close') {
      const status = lastDisconnect?.error?.output?.statusCode
      const shouldReconnect = status !== DisconnectReason.loggedOut
      console.log('Connection closed, code:', status, 'Reconnect:', shouldReconnect)
      if (shouldReconnect) {
        setTimeout(startNova, 3000)
      } else {
        console.log('LOGGED OUT - Run DELETE FROM nova_auth in Supabase')
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return
    const from = msg.key.remoteJid
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ''
    console.log(`Message from ${from}: ${text}`)
    if (text.toLowerCase().trim() === 'ping') {
      await sock.sendMessage(from, { text: 'Nova Cloud PONG ✅ PERSISTENT ONLINE' })
    }
  })
}

startNova()
