import { createServer } from 'node:http';
import { chmod, lstat, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const id = '[A-Za-z0-9_-]+';
const routes = [
  ['GET', '/(?:phone/(?:apps|settings)|theme-init\\.js|favicon\\.(?:svg|ico)|nod-logo\\.png)'],
  ['GET', '/(?:assets|fonts|logos)/[A-Za-z0-9_-]+(?:/[A-Za-z0-9_-]+)*\\.[A-Za-z0-9]+'],
  [
    'GET',
    '/api/(?:session|preferences|privacy|apps|apps/catalog|models|models/azure|speech|memory|memory/export|computer-use|local-files/keep-out|usage/work|tasks)',
  ],
  ['PATCH', '/api/(?:preferences|account|computer-use|memory)'],
  ['DELETE', '/api/(?:computer-use|local-files)/keep-out'],
  ['POST', '/api/computer-use/permission'],
  ['GET', '/api/apps/(?:catalog/)?' + id + '/icon'],
  [
    'POST',
    '/api/apps/(?:' +
      id +
      '/connect|' +
      id +
      '/accounts/' +
      id +
      '/disconnect|setup-status|setup-cancel|setup-return)',
  ],
  ['PATCH', '/api/apps/mcp/' + id],
  ['GET POST', '/api/apps/discovery/' + id + '(?:/(?:instance|authorize|complete))?'],
  ['POST', '/api/models/(?:keys|endpoints|oauth|oauth/complete|connections/' + id + '/refresh)'],
  ['PUT', '/api/models/(?:selection|backups|routes)'],
  ['DELETE', '/api/models/(?:connections|oauth)/' + id],
  ['GET', '/api/models/oauth/status/' + id],
  ['PUT', '/api/tasks/' + id + '/model'],
  ['POST', '/api/speech/(?:prepare|preview|voices/refresh)'],
  ['POST', '/api/memory/(?:notes|import|archive/restore|archive/forget)'],
  ['PUT PATCH DELETE', '/api/memory/(?:notes|skills)/[A-Za-z0-9_/-]+(?:\\.md)?'],
  ['POST', '/api/memory/notes/[A-Za-z0-9_/-]+(?:\\.md)?/archive'],
].map(([methods, path]) => [methods.split(' '), new RegExp('^' + path + '$')]);

export function allowedPhoneRequest(method, raw) {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('#')) return false;
  const path = raw.split('?')[0];
  if (path.includes('..') || path.includes('\\') || path.includes('%') || /[\s\x00-\x1f]/.test(raw))
    return false;
  return routes.some(([methods, pattern]) => methods.includes(method) && pattern.test(path));
}

export async function startPhoneManagement(directory, requestEngine, openSignIn) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const dir = await lstat(directory);
  if (!dir.isDirectory() || dir.uid !== process.getuid() || dir.mode & 0o077)
    throw new Error('Nodilus requires a private directory owned by this Mac account.');
  const path = join(directory, 'desktop.sock');
  const stale = await lstat(path).catch((e) => {
    if (e.code !== 'ENOENT') throw e;
  });
  if (stale) {
    if (!stale.isSocket() || stale.uid !== process.getuid())
      throw new Error('Phone socket path is occupied.');
    await rm(path);
  }
  const signIns = new Map();
  const server = createServer({ requestTimeout: 30000 }, async (req, res) => {
    const fail = (status, message) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    };
    try {
      const signIn = req.method === 'POST' && req.url === '/phone/sign-in';
      if (!signIn && !allowedPhoneRequest(req.method, req.url))
        return fail(403, 'Outside phone management.');
      const write = req.method !== 'GET';
      const chunks = [];
      let bytes = 0;
      for await (const chunk of req) {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) return fail(413, 'Request is too large.');
        chunks.push(chunk);
      }
      const headers = {};
      if (bytes) {
        if (!write || req.headers['content-type'] !== 'application/json')
          return fail(415, 'Expected JSON.');
        headers['Content-Type'] = 'application/json';
      }
      if (typeof req.headers['x-nod-account'] === 'string')
        headers['X-nod-Account'] = req.headers['x-nod-account'];
      const client = req.headers['x-nod-phone-session'];
      if (signIn) {
        const { url } = JSON.parse(Buffer.concat(chunks).toString());
        const entry = signIns.get(client);
        if (!entry || entry.until <= Date.now() || entry.url !== url)
          return fail(403, 'Start sign-in again from this iPhone.');
        signIns.delete(client);
        await openSignIn(url);
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end('{}');
      }
      const result = await requestEngine(req.url, {
        method: req.method,
        headers,
        body: bytes ? Buffer.concat(chunks) : undefined,
      });
      if (result.status >= 300 && result.status < 400)
        return fail(409, 'Complete this sign-in on the Mac.');
      if (
        client &&
        result.ok &&
        req.method === 'POST' &&
        /^\/api\/(?:apps\/(?:[A-Za-z0-9_-]+\/connect|discovery\/[A-Za-z0-9_-]+\/(?:instance|authorize))|models\/oauth)$/.test(
          req.url,
        )
      ) {
        const data = await result.json();
        const url = typeof data.url === 'string' && URL.parse(data.url);
        if (
          url &&
          !url.username &&
          !url.password &&
          (url.protocol === 'https:' ||
            (url.protocol === 'http:' &&
              url.hostname === '127.0.0.1' &&
              /^\/[A-Za-z0-9_-]{43}$/.test(url.pathname) &&
              !url.search &&
              !url.hash))
        ) {
          for (const [key, value] of signIns) if (value.until <= Date.now()) signIns.delete(key);
          signIns.set(client, { url: url.href, until: Date.now() + 600000 });
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(data));
      }
      res.writeHead(result.status, {
        'content-type': result.headers.get('content-type') || 'application/octet-stream',
      });
      if (result.body) for await (const part of result.body) res.write(part);
      res.end();
    } catch {
      if (res.headersSent) res.destroy();
      else fail(503, 'Nod Desktop could not complete this request.');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(path, resolve);
  });
  try {
    await chmod(path, 0o600);
  } catch (error) {
    server.close();
    throw error;
  }
  return () => {
    server.close();
    server.closeAllConnections();
  };
}
