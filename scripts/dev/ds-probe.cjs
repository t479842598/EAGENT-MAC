
const WebSocket = require('ws');
(async () => {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = list.find(t => t.type === 'page' && t.url.includes('deepseek'));
  if (!page) { console.log('NO DEEPSEEK PAGE'); return; }
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pending = new Map();
  ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise(r => ws.on('open', r));
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;
  console.log('URL:', await evalJs('location.href'));
  console.log('TITLE:', await evalJs('document.title'));
  console.log('TEXTAREA:', await evalJs('document.querySelectorAll("textarea").length'));
  console.log('ASST:', await evalJs('document.querySelectorAll(".ds-assistant-message-main-content,[class*=ds-markdown]").length'));
  console.log('LOGIN_HINT:', await evalJs('document.body.innerText.slice(0,300).replace(/\\n/g," | ")'));
  ws.close();
})();
