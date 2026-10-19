
const WebSocket = require('ws');
(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  console.log('TARGETS:');
  for (const t of list) console.log(' -', t.type, '|', t.url.slice(0,60));
  const page = list.find(t => t.type === 'page' && t.url.includes('deepseek'));
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pending = new Map();
  ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise(r => ws.on('open', r));
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); return JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.text ?? null); };
  console.log('hasInput:', await ev('!!document.querySelector("textarea,textarea[placeholder]")'));
  console.log('bodyHead:', (await ev('document.body.innerText.slice(0,200)')).slice(0,200));
  console.log('loginRegex:', await ev('!/登录|Sign in|Log in/i.test((document.body.innerText||"").slice(0,400))'));
  ws.close();
})();
