
const WebSocket = require('ws');
(async () => {
  const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pending = new Map();
  ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise(r => ws.on('open', r));
  const evalJs = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.text; };
  const rep = await evalJs("window.eagent.runDoctor().then(r => JSON.stringify(r.results.map(x => [x.id, x.ok, x.detail])))");
  const parsed = JSON.parse(rep);
  for (const [id, ok, detail] of parsed) console.log((ok ? '[OK]  ' : '[FAIL]') + ' ' + id + ' :: ' + String(detail).slice(0, 110));
  ws.close();
})();
