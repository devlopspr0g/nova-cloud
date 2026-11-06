const { default: makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys")
const qrcode = require("qrcode")
const express = require("express")
const app = express()
let qrImage = ""

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
            qrImage = ""
        }
    })

    sock.ev.on("messages.upsert", async () => {
        // SILENT - does nothing, just learns
    })
}

app.get("/", (req, res) => {
    if (qrImage) {
        res.send(`<center><h2>Scan this QR with WhatsApp</h2><img src="${qrImage}" width="300"><br><br><a href="/">Refresh</a></center>`)
    } else {
        res.send("<center><h2>🤫 NOVA is Online 24/7!</h2><p>If you need QR, restart service in Render</p></center>")
    }
})

app.listen(3000, () => console.log("Web server on 3000"))
startBot()
