import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion, DisconnectReason, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys'
import { supabase } from './supabase.js'
import express from 'express'
import fs from 'fs'
import path from 'path'
import pino from 'pino'
import QRCode from 'qrcode'

const app = express()
const PORT = process.env.PORT || 10000
let qrDataURL = null
let connectionStatus = 'Starting...'

app.get('/', (req,res) => res.redirect('/qr'))

app.get('/qr', async (req, res) => {
  if (connectionStatus.includes('ONLINE')) {
    return res.send(`<h1 style="text-align:center;font-family:sans-serif">✅ Nova Cloud ONLINE PERSISTENT - No need to scan!</h1>`)
  }
  if (!qrDataURL) {
    return res.send(`<h1>${connectionStatus}</h1><p>Generating QR... refresh in 3 sec</p><script>setTimeout(()=>location.reload(),3000)</script>`)
  }
  res.send(`
    <html><body style="text-align:center;font-family:sans-serif;padding:20px;background:#111;color:#fff">
    <h1>Nova Cloud - Scan QR</h1>
    <p>Status: ${connectionStatus}</p>
    <img src="${qrDataURL}" style="width:320px;height:320px;border:10px solid white;border-radius:20px" />
    <p>WhatsApp > Linked Devices > Link a Device > Scan QR</p>
    <p>QR changes every 30 sec, refresh page for new QR</p>
    <script>setTimeout(()=>location.reload(),25000)</script>
    </body></html>
  `)
})

app.listen(PORT, () => console.log('Server on', PORT))

const AUTH_DIR = './auth_info_baileys'

async function restoreFromSupabase() {
  if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true })
  fs.mkdirSync(AUTH_DIR, { recursive: true })
  const { data } = await supabase.from('nova_auth').select('*')
  if (!data || data.length===0) { console.log('No session'); return }
  for (const row of data) {
    fs.writeFileSync(path.join(AUTH_DIR, row.id), typeof row.data==='object'?JSON.stringify(row.data):row.data)
  }
  console.log(`Restored ${data.length} files`)
}

async function saveToSupabase() {
  try {
    const files = fs.readdirSync(AUTH_DIR)
    for (const file of files) {
      const raw = fs.readFileSync(path.join(AUTH_DIR, file), 'utf8')
      let toSave; try{toSave=JSON.parse(raw)}catch{toSave=raw}
      await supabase.from('nova_auth').upsert({ id: file, data: toSave, updated_at: new Date().toISOString() })
    }
    console.log('Session saved!')
  } catch(e){ console.log('Save err', e.message) }
}

async function startNova() {
  await restoreFromSupabase()
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()
  
  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' }))
    },
    logger: pino({ level: 'silent' }),
    browser: ['Ubuntu', 'Chrome', '20.0.04'], // FIX - WhatsApp blocks custom browsers
    printQRInTerminal: false
  })

  sock.ev.on('creds.update', async () => { await saveCreds(); await saveToSupabase() })

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) {
      qrDataURL = await QRCode.toDataURL(qr)
      connectionStatus = 'QR READY - Scan at /qr'
      console.log('QR ready')
    }
    if (connection === 'open') {
      qrDataURL = null
      connectionStatus = 'ONLINE PERSISTENT ✅'
      console.log('NOVA ONLINE!')
    }
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
      console.log('Closed, code:', statusCode)
      if (statusCode !== DisconnectReason.loggedOut) {
        connectionStatus = 'Reconnecting...'
        setTimeout(startNova, 3000)
      } else {
        connectionStatus = 'Logged out - Delete nova_auth table to restart'
        qrDataURL = null
      }
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]; if (!msg.message || msg.key.fromMe) return
    const from = msg.key.remoteJid
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ''
    console.log(`Msg: ${text}`)
    if (text.toLowerCase().trim()==='ping') await sock.sendMessage(from, { text: 'Nova Cloud PONG ✅ PERSISTENT' })
  })
}

startNova()
