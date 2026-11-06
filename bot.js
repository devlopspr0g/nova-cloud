const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const fetch = require('node-fetch');
const API = "https://aibridge-api-render.onrender.com";
async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('auth');
  const sock = makeWASocket({ auth: state });
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', u => {
    if(u.qr) qrcode.generate(u.qr,{small:true});
    if(u.connection==='open') console.log("🤫 SILENT - NO REPLIES, GROUPS BLOCKED");
    if(u.connection==='close' && u.lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut) start();
  });
  sock.ev.on('messages.upsert', async ({messages}) => {
    const msg = messages[0];
    if(!msg.message || msg.key.fromMe) return;
    const jid = msg.key.remoteJid || "";
    if(jid.includes("@g.us") || jid.includes("status@broadcast")) { console.log("Blocked group/status:", jid); return; }
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
    if(!text) return;
    console.log("[Saved only, NO reply] ", text);
    try{ await fetch(`${API}/api/`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text})}); }catch(e){}
  });
}
start();
