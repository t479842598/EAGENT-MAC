
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
  console.log('MATCH:', await ev('((document.body.innerText||"").slice(0,400).match(/.{0,20}(登录|Sign in|Log in).{0,20}/i)||["none"])[0]'));
  console.log('avatar:', await ev('document.querySelectorAll("[class*=avatar],img[class*=avatar]").length'));
  console.log('loginBtn:', await ev('document.querySelectorAll("button[class*=login],[class*=login-btn]").length'));
  console.log('composerArea:', await ev('document.querySelectorAll("textarea").length'));
  ws.close();
})();
