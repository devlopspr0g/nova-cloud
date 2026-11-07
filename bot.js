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
const MY_NUMBER = '2348137981597' // YOUR NUMBER - correct!

app.get('/', (req,res) => res.send(`<h1>${connectionStatus}</h1><a href='/qr'>/qr for pairing code</a>`))
app.get('/qr', (req, res) => {
  res.send(`<html><body style="text-align:center;font-family:sans-serif;padding:30px">
  <h1>Nova Cloud</h1><h2>Status: ${connectionStatus}</h2>
  ${pairingCode ? `<h1 style="font-size:60px;background:#000;color:#0f0;padding:20px;letter-spacing:8px">${pairingCode}</h1><p>WhatsApp > Linked Devices > Link a Device > Link with phone number</p><p>Enter this code on THIS number: ${MY_NUMBER}</p>` : `<p>Waiting for code... refresh in 5 sec</p>`}
  <script>setTimeout(()=>location.reload(),10000)</script></body></html>`)
})
app.listen(PORT, () => console.log('Server on', PORT))

const AUTH_DIR = './auth_info_baileys'
async function restoreFromSupabase() {
  if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true })
  fs.mkdirSync(AUTH_DIR, { recursive: true })
  const { data } = await supabase.from('nova_auth').select('*')
  if (!data || data.length===0) return
  for (const row of data) {
    fs.writeFileSync(path.join(AUTH_DIR, row.id), typeof row.data==='object'?JSON.stringify(row.data):row.data)
  }
}
async function saveToSupabase() {
  try {
    const files = fs.readdirSync(AUTH_DIR)
    for (const file of files) {
      const raw = fs.readFileSync(path.join(AUTH_DIR, file), 'utf8')
      let toSave; try{toSave=JSON.parse(raw)}catch{toSave=raw}
      await supabase.from('nova_auth').upsert({ id: file, data: toSave, updated_at: new Date().toISOString() })
    }
  } catch {}
}
async function startNova() {
  await restoreFromSupabase()
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()
  const sock = makeWASocket({ version, auth: state, logger: pino({ level: 'silent' }), browser: ['Nova Cloud','Chrome','1.0'] })
  
  if (!sock.authState.creds.registered) {
    const requestCode = async () => {
      try {
        await new Promise(r=>setTimeout(r,5000))
        const code = await sock.requestPairingCode(MY_NUMBER)
        pairingCode = code
        connectionStatus = 'CODE READY - Type it now!'
        console.log('PAIRING CODE:', code)
      } catch(e){ console.log('Pair error', e.message); setTimeout(requestCode,10000) }
    }
    requestCode()
  }

  sock.ev.on('creds.update', async () => { await saveCreds(); await saveToSupabase() })
  sock.ev.on('connection.update', async (u) => {
    const { connection, lastDisconnect } = u
    if (connection==='open') { pairingCode=null; connectionStatus='ONLINE PERSISTENT ✅'; console.log('ONLINE!') }
    if (connection==='close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
      connectionStatus='Reconnecting...'
      if (shouldReconnect) setTimeout(startNova,3000)
      else { connectionStatus='Logged out - delete nova_auth table'; }
    }
  })
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]; if (!msg.message || msg.key.fromMe) return
    const from = msg.key.remoteJid
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ''
    if (text.toLowerCase().trim()==='ping') await sock.sendMessage(from, { text: 'Nova Cloud PONG ✅' })
  })
}
startNova()
