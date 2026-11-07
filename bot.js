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

async function restoreFromSupabase() {
  console.log('Restoring session from Supabase...')
  if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true })
  
  const { data, error } = await supabase.from('nova_auth').select('*')
  if (error) { console.log('Supabase restore error:', error.message); return }
  if (!data || data.length === 0) { console.log('No session in Supabase, need QR'); return }
  
  for (const row of data) {
    const filePath = path.join(AUTH_DIR, row.id)
    try {
      const content = row.data
      if (typeof content === 'object') {
        fs.writeFileSync(filePath, JSON.stringify(content))
      } else if (typeof content === 'string') {
        // try base64, fallback to raw string
        try {
          if (content.length > 200 && !content.trim().startsWith('{')) {
            fs.writeFileSync(filePath, Buffer.from(content, 'base64'))
          } else {
            fs.writeFileSync(filePath, content)
          }
        } catch {
          fs.writeFileSync(filePath, content)
        }
      }
    } catch (e) {
      console.log('Failed restore', row.id, e.message)
    }
  }
  console.log(`Restored ${data.length} files from Supabase`)
}

async function saveToSupabase() {
  console.log('Saving session to Supabase...')
  try {
    const files = fs.readdirSync(AUTH_DIR)
    for (const file of files) {
      const filePath = path.join(AUTH_DIR, file)
      const raw = fs.readFileSync(filePath, 'utf8')
      let toSave
      try { toSave = JSON.parse(raw) } catch { toSave = raw }
      
      const { error } = await supabase.from('nova_auth').upsert({
        id: file,
        data: toSave,
        updated_at: new Date().toISOString()
      })
      if (error) console.log('Save error', file, error.message)
    }
    console.log('Session saved to Supabase!')
  } catch (e) {
    console.log('saveToSupabase error', e.message)
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
    if (connection === 'close') {
      console.log('Connection closed, restarting in 3s...')
      setTimeout(startNova, 3000)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe) return
    
    const from = msg.key.remoteJid
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || msg.message.imageMessage?.caption || ''
    
    console.log(`Message from ${from}: ${text}`)

    if (!text) return

    if (text.toLowerCase().includes('remember')) {
      await sock.sendMessage(from, { text: `Got it! I remembered: ${text}` })
    }
    
    if (text.toLowerCase().includes('what do you remember')) {
      await sock.sendMessage(from, { text: `You told me you're DevLops system owner in Warri, building Nova Cloud!` })
    }

    if (text.toLowerCase().trim() === 'ping') {
      await sock.sendMessage(from, { text: 'Nova Cloud PONG - ONLINE PERSISTENT ✅' })
    }
  })
}

startNova()
