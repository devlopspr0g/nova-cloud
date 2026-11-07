import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys'
import { supabase } from './supabase.js'
import express from 'express'
import fs from 'fs'
import path from 'path'
import QRCode from 'qrcode'
import pino from 'pino'

const AUTH_DIR = './auth'
const PORT = process.env.PORT || 10000
if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true })

let qrCodeData = null
const app = express()
app.get('/', async (req, res) => {
  if (!qrCodeData) return res.send('<h2>NOVA ONLINE PERSISTENT ✅ - No QR needed</h2>')
  const qrImg = await QRCode.toDataURL(qrCodeData)
  res.send(`<div style="text-align:center;padding:20px"><h1>Scan Nova QR - 15 sec only!</h1><img src="${qrImg}" width="300"/><p>Open WhatsApp 2348137981597 > Linked Devices > Link a device</p></div>`)
})
app.listen(PORT, () => console.log(`QR Server on ${PORT}`))

// RESTORE FROM SUPABASE
async function restoreAuth() {
  console.log('Restoring session from Supabase...')
  const { data, error } = await supabase.from('nova_auth').select('*')
  if (error || !data || data.length === 0) {
    console.log('No saved session found, need QR')
    return
  }
  for (const row of data) {
    const filePath = path.join(AUTH_DIR, row.id)
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(filePath, Buffer.from(row.data.content, 'base64'))
  }
  console.log(`Restored ${data.length} files from Supabase`)
}

// SAVE TO SUPABASE - SAVES ALL FILES
async function saveAuth() {
  try {
    const files = fs.readdirSync(AUTH_DIR)
    for (const file of files) {
      const fullPath = path.join(AUTH_DIR, file)
      if (fs.statSync(fullPath).isDirectory()) {
        // Handle subfolders like session, etc
        const subFiles = fs.readdirSync(fullPath)
        for (const sub of subFiles) {
          const subPath = path.join(fullPath, sub)
          const content = fs.readFileSync(subPath)
          await supabase.from('nova_auth').upsert({
            id: `${file}/${sub}`,
            data: { content: content.toString('base64') }
          })
        }
      } else {
        const content = fs.readFileSync(fullPath)
        await supabase.from('nova_auth').upsert({
          id: file,
          data: { content: content.toString('base64') }
        })
      }
    }
    console.log(`Saved auth to Supabase`)
  } catch (e) {
    console.log('Save error:', e.message)
  }
}

async function startNova() {
  await restoreAuth()
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)

  const sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }), // HIDES Bad MAC spam
    printQRInTerminal: false,
    browser: ['Nova Cloud', 'Chrome', '1.0.0'],
    syncFullHistory: false,
    markOnlineOnConnect: true,
    getMessage: async () => undefined
  })

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) {
      qrCodeData = qr
      console.log('QR READY - OPEN RENDER URL!')
    }
    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut
      console.log('Connection closed, restarting...', lastDisconnect?.error?.message)
      if (shouldReconnect) {
        setTimeout(startNova, 2000)
      } else {
        console.log('Logged out - clear supabase table')
      }
    } else if (connection === 'open') {
      qrCodeData = null
      console.log('NOVA ONLINE PERSISTENT 24/7 ✅')
      await saveAuth()
    }
  })

  sock.ev.on('creds.update', async () => {
    await saveCreds()
    await saveAuth()
  })

  // OPTIONAL: Ignore decrypt errors, keep bot alive
  sock.ev.on('messages.upsert', async (m) => {
    try {
      const msg = m.messages[0]
      if (!msg.message) return
      console.log('Message from:', msg.key.remoteJid)
      // Your memory logic here...
    } catch (e) {
      // ignore decrypt errors
    }
  })
}

startNova()
