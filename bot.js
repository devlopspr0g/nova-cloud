const { default: makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys")
const qrcode = require("qrcode")
const express = require("express")
const app = express()
let qrImage = ""

const MEMORY_API = "https://aibridge-api-render-1.onrender.com"

// --- NOVA MEMORY BRAIN (shared with dashboard) ---
async function novaRemember(text) {
  try {
    await fetch(`${MEMORY_API}/api/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text })
    })
    console.log("Nova remembered:", text)
  } catch (e) {
    console.log("Nova offline save failed:", e.message)
  }
}

async function novaRecall(query = "") {
  try {
    if (!query) {
      const r = await fetch(`${MEMORY_API}/api/`)
      const d = await r.json()
      return d.memories || []
    }
    const res = await fetch(`${MEMORY_API}/api/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query })
    })
    const data = await res.json()
    return data.results || data.memories || []
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
            console.log("🧠 Memory brain connected to", MEMORY_API)
            qrImage = ""
            // Load memories on boot
            const mems = await novaRecall()
            console.log(`Loaded ${mems.length} memories from cloud`)
        }
    })

    sock.ev.on("messages.upsert", async (m) => {
        // SILENT LEARNING - does not reply, just learns
        try {
          const msg = m.messages[0]
          if (!msg.message) return
          const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ""
          if (!text) return
          if (msg.key.fromMe) return // don't learn own
          
          // Learn only DMs, ignore groups (silent mode)
          const isGroup = msg.key.remoteJid.endsWith("@g.us")
          if (isGroup) return

          // Save to shared memory
          await novaRemember(`WhatsApp: ${text}`)
        } catch (e) {}
    })
}

app.get("/", (req, res) => {
    if (qrImage) {
        res.send(`<center><h2>Scan this QR with WhatsApp</h2><img src="${qrImage}" width="300"><br><br><a href="/">Refresh</a></center>`)
    } else {
        res.send("<center><h2>🤫 NOVA is Online 24/7!</h2><p>🧠 Memory: Connected to AI-Bridge</p><p>If you need QR, restart service in Render</p><p><a href='/memories'>View Memories</a></p></center>`)
    }
})

// New route: View shared memories
app.get("/memories", async (req, res) => {
    const mems = await novaRecall()
    res.json({ count: mems.length, memories: mems.slice(-20).reverse() })
})

// New route: Nova search
app.get("/nova/search/:q", async (req, res) => {
    const results = await novaRecall(req.params.q)
    res.json({ query: req.params.q, results })
})

app.listen(3000, () => console.log("Web server on 3000"))
startBot()
