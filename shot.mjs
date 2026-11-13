// node shot.mjs [WxH] [query] [seconds] -> serves this folder, screenshots index.html in headless Chrome (WebGL on), prints PNG path + console errors
import {chromium} from 'playwright-core';
import http from 'http'; import fs from 'fs'; import path from 'path';
const dir = path.dirname(new URL(import.meta.url).pathname);
const [size = '1440x900', query = '', secs = '4'] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number);
const types = {'.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.hdr': 'application/octet-stream', '.exr': 'application/octet-stream', '.svg': 'image/svg+xml', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.ktx2': 'application/octet-stream', '.woff2': 'font/woff2'};
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
  const f = path.join(dir, p);
  if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, {'Content-Type': types[path.extname(f)] || 'application/octet-stream'}); fs.createReadStream(f).pipe(res);
}).listen(0, '127.0.0.1');
await new Promise((r) => srv.on('listening', r));
const exe = process.env.CHROME || undefined;   // optional: path to a Chrome/headless shell
const b = await chromium.launch({executablePath: exe, args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization']});
const pg = await b.newPage({viewport: {width: w, height: h}, deviceScaleFactor: 1});
const logs = [];
pg.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`${m.type()}: ${m.text()}`.slice(0, 300)); });
pg.on('pageerror', (e) => logs.push('pageerror: ' + String(e.message).slice(0, 300)));
pg.on('requestfailed', (r) => logs.push('requestfailed: ' + r.url().slice(0, 150)));
const q = query && !query.startsWith('?') ? '?' + query : query;
await pg.goto(`http://127.0.0.1:${srv.address().port}/index.html${q}`, {waitUntil: 'load', timeout: 60000}).catch((e) => logs.push('goto: ' + e.message));
await pg.waitForTimeout(+secs * 1000);
fs.mkdirSync(path.join(dir, '.shots'), {recursive: true});
const out = path.join(dir, '.shots', `${new Date().toTimeString().slice(0, 8).replace(/:/g, '')}-${Math.random().toString(36).slice(2, 5)}.png`);
await pg.screenshot({path: out});
console.log(out); for (const l of logs.slice(0, 25)) console.log(l);
await b.close(); srv.close();
