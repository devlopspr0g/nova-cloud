import makeWASocket, { useMultiFileAuthState, fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import { supabase } from './supabase.js'
import express from 'express'
import fs from 'fs'
import path from 'path'
import pino from 'pino'

const app = express()
const PORT = process.env.PORT || 10000
app.get('/', (req,res) => res.send('Nova Cloud ONLINE'))
app.listen(PORT, () => console.log('Server on', PORT))

const AUTH_DIR = './auth_info_baileys'
const BUCKET = 'nova_sessions' // you need this bucket? No, we use table

async function restoreFromSupabase() {
  console.log('Restoring session from Supabase...')
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true })
  
  const { data, error } = await supabase.from('nova_auth').select('*')
  if (error) { console.log('Supabase restore error:', error); return }
  if (!data || data.length === 0) { console.log('No session in Supabase, need QR'); return }
  
  for (const row of data) {
    fs.writeFileSync(path.join(AUTH_DIR, row.id), Buffer.from(row.data, 'base64'))
  }
  console.log(`Restored ${data.length} files from Supabase`)
}

async function saveToSupabase() {
  console.log('Saving session to Supabase...')
  const files = fs.readdirSync(AUTH_DIR)
  for (const file of files) {
    const filePath = path.join(AUTH_DIR, file)
    const content = fs.readFileSync(filePath)
    await supabase.from('nova_auth').upsert({
      id: file,
      data: content.toString('base64'),
      updated_at: new Date().toISOString()
    })
  }
  console.log('Session saved to Supabase!')
}

async function startNova() {
  await restoreFromSupabase()
  
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
  const { version } = await fetchLatestBaileysVersion()
  
  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: true,
    browser: ['Nova Cloud', 'Chrome', '1.0']
  })

  sock.ev.on('creds.update', async () => {
    await saveCreds()
    await saveToSupabase()
  })

  sock.ev.on('connection.update', (update) => {
    const { connection } = update
    if (connection === 'open') {
      console.log('NOVA ONLINE PERSISTENT - Connected!')
    }
  })

  // MESSAGE HANDLER - THIS WAS MISSING FOR YOU
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return
    
    const from = msg.key.remoteJid
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ''
    
    console.log(`Message from ${from}: ${text}`)

    if (text.toLowerCase().includes('remember')) {
      await sock.sendMessage(from, { text: `Got it! I remembered: ${text}` })
      // Here you can save to supabase memory table
    }
    
    if (text.toLowerCase().includes('what do you remember')) {
      await sock.sendMessage(from, { text: `You told me you're DevLops system owner in Warri, building Nova Cloud!` })
    }

    if (text.toLowerCase() === 'ping') {
      await sock.sendMessage(from, { text: 'Nova Cloud PONG - ONLINE PERSISTENT ✅' })
    }
  })
}

startNova()
