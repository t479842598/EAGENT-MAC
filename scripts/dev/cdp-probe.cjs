
const WebSocket = require('ws');
(async () => {
  const list = await (await fetch('http://127.0.0.1:9333/json/list')).json();
  const page = list.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl, { perMessageDeflate: false });
  let id = 0;
  const pending = new Map();
  ws.on('message', d => {
    const m = JSON.parse(d.toString());
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    if (m.method === 'Runtime.consoleAPICalled') {
      console.log('CONSOLE', m.params.type, m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      console.log('EXCEPTION', JSON.stringify(m.params.exceptionDetails).slice(0, 600));
    }
  });
  const send = (method, params = {}) => new Promise(res => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await new Promise(r => ws.on('open', r));
  await send('Runtime.enable');
  await send('Page.enable');
  const r = await send('Runtime.evaluate', { expression: "document.body.innerText.slice(0,900)", returnByValue: true });
  console.log('BODY:', r.result?.result?.value);
  const r2 = await send('Runtime.evaluate', { expression: "JSON.stringify({hasEagent: !!window.eagent, hasElectron: !!window.electronAPI, rootChildren: document.getElementById('root')?.children.length, bg: getComputedStyle(document.body).backgroundColor})", returnByValue: true });
  console.log('STATE:', r2.result?.result?.value);
  await new Promise(r => setTimeout(r, 1500));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  if (shot.result?.data) { require('fs').writeFileSync('/tmp/eagent-ui.png', Buffer.from(shot.result.data, 'base64')); console.log('SHOT saved'); }
  ws.close();
})();
