
const WebSocket = require('ws');
(async () => {
  const list = await (await fetch('http://127.0.0.1:9444/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pending = new Map();
  ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise(r => ws.on('open', r));
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.text; };
  const rep = await ev("window.eagent.runDoctor().then(r => JSON.stringify({results: r.results.map(x => [x.id, x.ok, x.detail]), macinput: r.macinput}))");
  const o = JSON.parse(rep);
  for (const [i, ok, d] of o.results) console.log((ok?'[OK]  ':'[FAIL]') + ' ' + i + ' :: ' + String(d).slice(0,120));
  console.log('MACINPUT_BIN:', o.macinput && o.macinput.binaryPath);
  // skills 目录
  console.log('SKILL_LIST:', String(await ev("window.eagent.send").then(()=>'n/a')));
  ws.close();
})();
