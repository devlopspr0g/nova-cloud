const { default: makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys")
const qrcode = require("qrcode")
const express = require("express")
const app = express()
let qrImage = ""

const MEMORY_API = "https://aibridge-api-render-1.onrender.com"
const API_KEY = process.env.NOVA_API_KEY || process.env.API_KEY || "" // set this in Render env

// --- NOVA MEMORY BRAIN (matches supabase.sql 6 tables) ---
async function novaRemember(content) {
  try {
    if (!API_KEY) return console.log("No API_KEY set in env");
    await fetch(`${MEMORY_API}/api/memories`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "x-api-key": API_KEY
      },
      body: JSON.stringify({ 
        content: content, // <-- new table uses `content` not `text`
        source: "whatsapp",
        type: "memory",
        tags: ["nova","whatsapp"]
      })
    })
    console.log("Nova remembered:", content.slice(0,80))
  } catch (e) {
    console.log("Nova save failed:", e.message)
  }
}

async function novaRecall(query = "") {
  try {
    if (!API_KEY) return [];
    const url = query 
      ? `${MEMORY_API}/api/memories?q=${encodeURIComponent(query)}`
      : `${MEMORY_API}/api/memories`
      
    const r = await fetch(url, {
      headers: { "x-api-key": API_KEY }
    })
    const d = await r.json()
    return Array.isArray(d) ? d : []
  } catch (e) {
    console.log("Recall failed:", e.message)
    return []
  }
}

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState("auth")
    const sock = makeWASocket({ auth: state, printQRInTerminal: true })

    sock.ev.on("creds.update", saveCreds)

    sock.ev.on("connection.update", async (update) => {
        const { connection, qr } = update
        if (qr) {
            qrImage = await qrcode.toDataURL(qr)
            console.log("QR Generated - Open your Render URL to scan!")
        }
        if (connection === "open") {
            console.log("🤫 SILENT - NO REPLIES, GROUPS BLOCKED - 24/7 ONLINE!")
            console.log("🧠 Memory brain:", MEMORY_API)
            qrImage = ""
            const mems = await novaRecall()
            console.log(`Loaded ${mems.length} memories from cloud`)
        }
    })

    sock.ev.on("messages.upsert", async (m) => {
        try {
          const msg = m.messages[0]
          if (!msg.message) return
          const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ""
          if (!text) return
          if (msg.key.fromMe) return
          
          const isGroup = msg.key.remoteJid.endsWith("@g.us")
          if (isGroup) return

          await novaRemember(text)
        } catch (e) {}
    })
}

app.get("/", (req, res) => {
    if (qrImage) {
        res.send(`<center><h2>Scan this QR with WhatsApp</h2><img src="${qrImage}" width="300"><br><br><a href="/">Refresh</a></center>`)
    } else {
        res.send("<center><h2>🤫 NOVA is Online 24/7!</h2><p>🧠 Memory: Connected to AI-Bridge</p><p>If you need QR, restart service in Render</p><p><a href='/memories'>View Memories</a></p></center>")
    }
})

app.get("/memories", async (req, res) => {
    const mems = await novaRecall()
    res.json({ count: mems.length, memories: mems.slice(0,20) })
})

app.get("/nova/search/:q", async (req, res) => {
    const results = await novaRecall(req.params.q)
    res.json({ query: req.params.q, count: results.length, results })
})

app.listen(3000, () => console.log("Web server on 3000"))
startBot()
