// Lyrichord online page (lyricord.<account>.workers.dev): the web app files, plus /where, a tiny address book
// so a phone finds the Mac at home. The Mac's tunnel address changes at every start; the app posts it here,
// filed under SHA-256(access key). A phone that has the key asks for that hash; nobody else can find or change it.
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Cache-Control': 'no-store' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, 'content-type': 'application/json' } });
const sha256 = async s => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map(b => b.toString(16).padStart(2, '0')).join('');
const TUNNEL = /^https:\/\/[a-z0-9-]{3,80}\.trycloudflare\.com$/;

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (u.pathname !== '/where') return env.ASSETS.fetch(req);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (req.method === 'GET') {
      const h = u.searchParams.get('h') || '';
      if (!/^[0-9a-f]{64}$/.test(h)) return json({ error: 'bad hash' }, 400);
      const v = await env.WHERE.get(h);
      return json(v ? JSON.parse(v) : {});
    }
    if (req.method === 'POST') {
      let b; try { b = await req.json(); } catch { return json({ error: 'bad body' }, 400); }
      const key = String(b.key || ''), url = String(b.url || '').replace(/\/+$/, '');
      if (key.length < 12 || key.length > 200) return json({ error: 'bad key' }, 400);
      if (url && !TUNNEL.test(url)) return json({ error: 'bad url' }, 400);
      const h = await sha256(key);
      if (!url) { await env.WHERE.delete(h); return json({ ok: true }); }
      await env.WHERE.put(h, JSON.stringify({ url, at: Date.now() }), { expirationTtl: 60 * 60 * 24 * 30 });
      return json({ ok: true });
    }
    return json({ error: 'method' }, 405);
  },
};
