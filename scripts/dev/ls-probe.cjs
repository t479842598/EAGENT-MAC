
const WebSocket = require('ws');
(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = list.find(t => t.type === 'page' && t.url.includes('deepseek'));
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pending = new Map();
  ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise(r => ws.on('open', r));
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.text; };
  console.log('lsKeys:', await ev('Object.keys(localStorage).join(",")'));
  console.log('tokenish:', await ev('Object.keys(localStorage).filter(k=>/token|user|auth/i.test(k)).map(k=>k+"="+String(localStorage[k]).slice(0,40)).join(" | ")'));
  console.log('loginEls:', await ev('document.querySelectorAll("[class*=login]").length'));
  console.log('sidebarNew:', await ev('!!Array.from(document.querySelectorAll("*")).find(e=>e.textContent==="开启新对话")'));
  ws.close();
})();
