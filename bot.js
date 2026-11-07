const { default: makeWASocket, useMultiFileAuthState, BufferJSON } = require("@whiskeysockets/baileys")
const qrcode = require("qrcode")
const express = require("express")
const { createClient } = require("@supabase/supabase-js")
const fs = require("fs")
const path = require("path")

const app = express()
let qrImage = ""

const MEMORY_API = "https://aibridge-api-render-1.onrender.com"
const API_KEY = process.env.NOVA_API_KEY || process.env.API_KEY || ""
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null

const AUTH_DIR = "auth"
if(process.env.CLEAR_AUTH === "true"){
  if(fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, {recursive:true, force:true})
  console.log("CLEARED AUTH FOLDER")
}
if(!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR)

async function loadAuthFromSupabase(){
  if(!supabase) return console.log("No Supabase env - running ephemeral")
  console.log("Restoring session from Supabase...")
  const { data } = await supabase.from("nova_auth").select("*")
  if(!data || data.length===0) return console.log("No saved session yet")
  for(const row of data){
    const filePath = path.join(AUTH_DIR, row.id)
    fs.writeFileSync(filePath, JSON.stringify(row.data, BufferJSON.replacer))
  }
  console.log(`Restored ${data.length} files`)
}

async function saveAuthToSupabase(filename){
  if(!supabase) return
  try{
    const filePath = path.join(AUTH_DIR, filename)
    if(!fs.existsSync(filePath)) return
    const content = JSON.parse(fs.readFileSync(filePath, "utf-8"), BufferJSON.reviver)
    await supabase.from("nova_auth").upsert({ id: filename, data: content })
    console.log("Saved:", filename)
  }catch(e){ console.log("SB save fail", e.message) }
}

async function novaRemember(content) {
  try {
    if (!API_KEY) return
    await fetch(`${MEMORY_API}/api/memories`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
      body: JSON.stringify({ content, source: "whatsapp", type: "memory", tags: ["nova"] })
    })
    console.log("Remembered:", content.slice(0,60))
  } catch (e) {}
}

async function novaRecall(q="") {
  try {
    const url = q ? `${MEMORY_API}/api/memories?q=${encodeURIComponent(q)}` : `${MEMORY_API}/api/memories`
    const r = await fetch(url, { headers: { "x-api-key": API_KEY } })
    const d = await r.json()
    return Array.isArray(d) ? d : []
  } catch(e){ return [] }
}

async function startBot() {
    await loadAuthFromSupabase()
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
    const sock = makeWASocket({ auth: state, printQRInTerminal: true })

    sock.ev.on("creds.update", async () => {
        await saveCreds()
        const files = fs.readdirSync(AUTH_DIR)
        for(const f of files) await saveAuthToSupabase(f)
    })

        sock.ev.on("connection.update", async (u) => {
        if (u.qr) {
            qrImage = await qrcode.toDataURL(u.qr)
            console.log("QR READY - OPEN RENDER URL!")
        }
        if (u.connection === "open") {
            console.log("🤫 NOVA ONLINE PERSISTENT - NO MORE SCAN EVER!")
            qrImage = ""
            const mems = await novaRecall()
            console.log(`Loaded ${mems.length} memories`)
        }
        if (u.connection === "close") {
            const shouldReconnect = u.lastDisconnect?.error?.output?.statusCode !== 401
            console.log("Connection closed, restarting...", u.lastDisconnect?.error?.message)
            if(shouldReconnect){
                setTimeout(()=>startBot(), 2000)
            } else {
                console.log("401 Logged out - need new QR")
                qrImage = ""
            }
        }
    })
    sock.ev.on("messages.upsert", async (m) => {
        try {
          const msg = m.messages[0]
          if (!msg.message) return
          const text = msg.message.conversation || msg.message.extendedTextMessage?.text || ""
          if (!text || msg.key.fromMe) return
          if (msg.key.remoteJid.endsWith("@g.us")) return
          await novaRemember(text)
        } catch(e){}
    })
}

app.get("/", (req,res)=>{
    if(qrImage) res.send(`<center><h2>SCAN NOW - LAST TIME</h2><img src="${qrImage}" width="300"><br><a href="/">Refresh</a></center>`)
    else res.send("<center><h2>NOVA ONLINE PERSISTENT 24/7</h2><p>Memory connected</p></center>")
})

app.listen(3000, ()=>console.log("Web server on 3000"))
startBot()
