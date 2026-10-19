
const WebSocket = require('ws');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pending = new Map();
  ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise(r => ws.on('open', r));
  const evalJs = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.result?.value;

  // 打开自检面板，截图验证
  await evalJs("window.__t = []; window.eagent.onEvent(e => window.__t.push(e.type + ':' + (e.state || e.type)));");
  console.log('SEND:', await evalJs("window.eagent.send('请用 shell 工具执行 echo hello-from-eagent 并把输出告诉我')"));
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const st = await evalJs("JSON.stringify({state: (window.__lastState||''), body: document.body.innerText.slice(-500)})");
    const parsed = JSON.parse(st || '{}');
    console.log('T' + i, parsed.body ? parsed.body.replace(/\n+/g, ' | ').slice(0, 300) : '');
    if (/待授权|允许本次/.test(parsed.body || '')) { console.log('>>> 需要授权'); break; }
    if (/hello-from-eagent/.test(parsed.body || '')) { console.log('>>> 已拿到结果'); break; }
  }
  ws.close();
})();
