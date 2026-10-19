
const WebSocket = require('ws');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const list = await (await fetch('http://127.0.0.1:9444/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0; const pending = new Map();
  ws.on('message', d => { const m = JSON.parse(d.toString()); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise(r => ws.on('open', r));
  const ev = async (e) => { const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.result?.value ?? r.result?.exceptionDetails?.text; };
  await ev("window.eagent.send('再用 shell 执行 uname -a 告诉我系统信息')");
  for (let i = 0; i < 40; i++) {
    await sleep(2500);
    const body = String(await ev('document.body.innerText'));
    if (/Darwin|本轮结束/.test(body.slice(-600)) && /uname/.test(body)) {
      const h1 = await ev("Array.from(document.querySelectorAll('.md-body h1,.md-body h2')).map(e=>e.textContent).join(' | ')");
      console.log('H1/H2_COUNT:', await ev("document.querySelectorAll('.md-body h1,.md-body h2').length"));
      console.log('CODE_INLINE:', await ev("Array.from(document.querySelectorAll('.md-body code')).slice(0,4).map(e=>e.textContent.slice(0,40)).join(' | ')"));
      break;
    }
  }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('/tmp/eagent-fixed.png', Buffer.from(shot.result.data, 'base64'));
  console.log('SHOT ok');
  ws.close();
})();
