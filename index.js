// ================================
// MyCoder Backend (index.js) — Responses API streaming
// ================================

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const pdfParse = require('pdf-parse');

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));
// Quiet dev favicon 404
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// ---------- directories ----------
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const LIB_DIR = path.join(UPLOADS_DIR, 'library');
const CHATS_DIR = path.join(UPLOADS_DIR, 'chats');
for (const p of [DATA_DIR, UPLOADS_DIR, LIB_DIR, CHATS_DIR]) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
const LIB_INDEX = path.join(DATA_DIR, 'library.json');
if (!fs.existsSync(LIB_INDEX)) fs.writeFileSync(LIB_INDEX, JSON.stringify([]));

// ---------- multer ----------
const uploadTemp = multer({ dest: path.join(UPLOADS_DIR, 'tmp') });
const uploadLibrary = multer({ dest: LIB_DIR });

// ---------- utils ----------
async function readFileSmart(filePath, originalName) {
  const lower = (originalName || '').toLowerCase();
  try {
    if (lower.endsWith('.pdf')) {
      const data = await pdfParse(await fsp.readFile(filePath));
      return data.text || '';
    }
    return await fsp.readFile(filePath, 'utf8');
  } catch {
    return `[binary or unreadable content for ${originalName}]`;
  }
}
const safeName = (s) => (s || '').replace(/[\/\\]+/g, '_');
function chatDir(chatId) { return path.join(CHATS_DIR, safeName(chatId || 'default')); }
async function ensureChatDir(chatId) {
  const dir = chatDir(chatId);
  if (!fs.existsSync(dir)) await fsp.mkdir(dir, { recursive: true });
  return dir;
}
async function listChatFiles(chatId) {
  const dir = chatDir(chatId);
  if (!fs.existsSync(dir)) return [];
  const names = await fsp.readdir(dir);
  const out = [];
  for (const n of names) {
    const p = path.join(dir, n);
    const st = await fsp.stat(p);
    if (st.isFile()) out.push({ name: n, size: st.size, uploadedAt: st.mtimeMs });
  }
  return out.sort((a, b) => a.uploadedAt - b.uploadedAt);
}

// ---------- health ----------
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// ---------- library (global) ----------
function loadLib() { return JSON.parse(fs.readFileSync(LIB_INDEX, 'utf8')); }
function saveLib(items) { fs.writeFileSync(LIB_INDEX, JSON.stringify(items, null, 2)); }

app.get('/api/library', (_req, res) => res.json(loadLib()));

app.post('/api/library/upload', uploadLibrary.array('files'), async (req, res) => {
  try {
    const collection = req.body.collection || 'default';
    const items = loadLib();
    const newItems = await Promise.all((req.files || []).map(async f => {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      const dest = path.join(LIB_DIR, f.filename); // already saved
      const stats = await fsp.stat(dest);
      const meta = {
        id, filename: f.originalname, storedName: f.filename,
        size: stats.size, uploadedAt: Date.now(), collection, pinned: false
      };
      items.push(meta);
      return meta;
    }));
    saveLib(items);
    res.json({ ok: true, added: newItems.length, items: newItems });
  } catch (e) { console.error(e); res.status(500).json({ error: 'Upload failed' }); }
});

app.post('/api/library/pin', express.json(), (req, res) => {
  const { id, pinned } = req.body || {};
  const items = loadLib();
  const idx = items.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  items[idx].pinned = !!pinned;
  saveLib(items);
  res.json({ ok: true, item: items[idx] });
});

app.delete('/api/library/:id', async (req, res) => {
  const { id } = req.params;
  const items = loadLib();
  const idx = items.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const item = items[idx];
  try {
    const filePath = path.join(LIB_DIR, item.storedName);
    if (fs.existsSync(filePath)) await fsp.unlink(filePath);
  } catch (e) { console.warn('Could not delete file:', e.message); }
  items.splice(idx, 1); saveLib(items);
  res.json({ ok: true });
});

// ---------- chat files (per chat) ----------
app.get('/api/chat/files', async (req, res) => {
  try { res.json(await listChatFiles(req.query.chatId || 'default')); }
  catch { res.status(500).json({ error: 'list failed' }); }
});

app.delete('/api/chat/files/:name', async (req, res) => {
  try {
    const chatId = req.query.chatId || 'default';
    const fname = safeName(req.params.name || '');
    const p = path.join(chatDir(chatId), fname);
    if (!p.startsWith(chatDir(chatId))) return res.status(400).json({ error: 'bad path' });
    if (fs.existsSync(p)) await fsp.unlink(p);
    res.json({ ok: true });
  } catch { res.status(500).json({ error: 'delete failed' }); }
});

// ---------- mock local ----------
app.post('/api/process', uploadTemp.array('files'), async (req, res) => {
  try {
    const { prompt = '', styleProfile = '', pinned = '[]', chatId = 'default' } = req.body;
    const pinnedIds = JSON.parse(pinned || '[]');

    let filesData = '';
    for (const file of (req.files || [])) {
      const content = await readFileSmart(file.path, file.originalname);
      filesData += `\n\n--- FILE: ${file.originalname} ---\n${content.slice(0, 8000)}`;
    }
    const chatFiles = await listChatFiles(chatId);
    for (const cf of chatFiles) {
      const p = path.join(chatDir(chatId), cf.name);
      const content = await readFileSmart(p, cf.name);
      filesData += `\n\n--- CHAT: ${cf.name} ---\n${content.slice(0, 8000)}`;
    }
    const items = loadLib().filter(x => pinnedIds.includes(x.id) || x.pinned);
    for (const it of items) {
      const p = path.join(LIB_DIR, it.storedName);
      const content = await readFileSmart(p, it.filename);
      filesData += `\n\n--- LIBRARY: ${it.filename} ---\n${content.slice(0, 8000)}`;
    }

    if (req.files?.length) {
      const dir = await ensureChatDir(chatId);
      for (const f of req.files) {
        await fsp.rename(f.path, path.join(dir, `${Date.now()}_${safeName(f.originalname)}`));
      }
    }

    res.json({
      response:
        `Pretend AI says: "${prompt || '(no text)'}"\n\n` +
        `StyleProfile: ${styleProfile ? '[provided]' : '[none]'}\n` +
        `Attachments (new): ${(req.files || []).length} | Chat files: ${chatFiles.length} | Pinned: ${items.length}\n` +
        `\n(Context length preview: ${filesData.length} chars)`
    });
  } catch (e) { console.error(e); res.status(500).json({ error: 'process failed' }); }
});

// ---------- non-stream (fallback) ----------
app.post('/ask-ai', uploadTemp.array('files'), async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  const useMock = !apiKey || apiKey === 'xxx';
  try {
    const { prompt = '', styleProfile = '', pinned = '[]', chatId = 'default' } = req.body;
    const pinnedIds = JSON.parse(pinned || '[]');

    let filesData = '';
    for (const file of (req.files || [])) {
      const content = await readFileSmart(file.path, file.originalname);
      filesData += `\n\n--- FILE: ${file.originalname} ---\n${content.slice(0, 8000)}`;
    }
    const chatFiles = await listChatFiles(chatId);
    for (const cf of chatFiles) {
      const p = path.join(chatDir(chatId), cf.name);
      const content = await readFileSmart(p, cf.name);
      filesData += `\n\n--- CHAT: ${cf.name} ---\n${content.slice(0, 8000)}`;
    }
    const items = loadLib().filter(x => pinnedIds.includes(x.id) || x.pinned);
    for (const it of items) {
      const p = path.join(LIB_DIR, it.storedName);
      const content = await readFileSmart(p, it.filename);
      filesData += `\n\n--- LIBRARY: ${it.filename} ---\n${content.slice(0, 8000)}`;
    }

    if (req.files?.length) {
      const dir = await ensureChatDir(chatId);
      for (const f of req.files) {
        await fsp.rename(f.path, path.join(dir, `${Date.now()}_${safeName(f.originalname)}`));
      }
    }

    const systemPrompt =
`You are an AI coding assistant.
Honor the user's coding style (JSON below) and prefer course materials in context.

STYLE PROFILE (JSON):
${styleProfile || '(none provided)'}`;

    const fullUser =
`ASSIGNMENT / REQUEST:
${prompt || '(no text)'}

CONTEXT (Uploads this message + Chat files + Pinned Library):
${filesData || '(none)'}
`;

    if (useMock) return res.json({ aiResponse: `🧪 MOCK RESPONSE\n\n${prompt}` });

    // Non-stream fallback: Chat Completions is fine here.
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        response_format: { type: 'text' },
        temperature: 0.2,
        max_tokens: 2000,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: fullUser }
        ]
      })
    });
    const data = await r.json();
    res.json({ aiResponse: data?.choices?.[0]?.message?.content || '' });
  } catch (e) { console.error(e); res.status(500).json({ error: 'ask-ai failed' }); }
});

// ---------- STREAM (SSE) via Responses API “wire” ----------
app.post('/ask-ai/stream', uploadTemp.array('files'), async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  const useMock = !apiKey || apiKey === 'xxx';

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const write = (obj) => { if (!res.writableEnded) res.write(`data: ${typeof obj === 'string' ? obj : JSON.stringify(obj)}\n\n`); };
  const ping  = () => { if (!res.writableEnded) res.write(':keep-alive\n\n'); }; // comment heartbeat
  const end   = () => { if (!res.writableEnded) res.end(); };

  let clientGone = false;
  const abort = new AbortController();
  req.on('close', () => { clientGone = true; abort.abort(); clear(); end(); });

  const HEARTBEAT_MS = 15000;
  const WATCHDOG_MS = 45000; // allow long “first token”
  let hbTimer = setInterval(ping, HEARTBEAT_MS);
  let watchdog = null;
  const clear = () => { clearInterval(hbTimer); clearTimeout(watchdog); };

  try {
    const { prompt = '', styleProfile = '', pinned = '[]', chatId = 'default' } = req.body;
    const pinnedIds = JSON.parse(pinned || '[]');

    // Build context
    let filesData = '';
    for (const file of (req.files || [])) {
      const content = await readFileSmart(file.path, file.originalname);
      filesData += `\n\n--- FILE: ${file.originalname} ---\n${content.slice(0, 8000)}`;
    }
    const chatFiles = await listChatFiles(chatId);
    for (const cf of chatFiles) {
      const p = path.join(chatDir(chatId), cf.name);
      const content = await readFileSmart(p, cf.name);
      filesData += `\n\n--- CHAT: ${cf.name} ---\n${content.slice(0, 8000)}`;
    }
    const items = loadLib().filter(x => pinnedIds.includes(x.id) || x.pinned);
    for (const it of items) {
      const p = path.join(LIB_DIR, it.storedName);
      const content = await readFileSmart(p, it.filename);
      filesData += `\n\n--- LIBRARY: ${it.filename} ---\n${content.slice(0, 8000)}`;
    }
    if (req.files?.length) {
      const dir = await ensureChatDir(chatId);
      for (const f of req.files) {
        await fsp.rename(f.path, path.join(dir, `${Date.now()}_${safeName(f.originalname)}`));
      }
    }

    const systemPrompt =
`You are an AI coding assistant.
Honor the user's coding style (JSON below) and prefer course materials in context.

STYLE PROFILE (JSON):
${styleProfile || '(none provided)'}`;

    const fullUser =
`ASSIGNMENT / REQUEST:
${prompt || '(no text)'}

CONTEXT (Uploads this message + Chat files + Pinned Library):
${filesData || '(none)'}
`;

    if (useMock) {
      const fake = `🧪 MOCK STREAM for: ${prompt}\n\n\`\`\`java\nSystem.out.println("hi");\n\`\`\``;
      for (let i = 0; i < fake.length; i += 6) {
        if (clientGone) break;
        write({ delta: fake.slice(i, i + 6) });
        // eslint-disable-next-line no-await-in-loop
        await new Promise(r => setTimeout(r, 25));
      }
      if (!clientGone) write('[DONE]');
      clear(); return end();
    }

    // ---- Responses API wire stream ----
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',            // pick your model
        stream: true,               // wire streaming
        temperature: 0.2,
        max_output_tokens: 2000,
        instructions: systemPrompt, // system
        input: fullUser             // user content
      }),
      signal: abort.signal
    });

    if (!r.ok || !r.body) {
      const text = await r.text().catch(() => '');
      if (!clientGone) { write({ error: `OpenAI ${r.status}: ${text}` }); write('[DONE]'); }
      clear(); return end();
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let gotAny = false;

    // watchdog fires only if nothing has streamed yet
    watchdog = setTimeout(() => { if (!gotAny) abort.abort(); }, WATCHDOG_MS);

    // Minimal event parser: blocks are separated by \n\n, each block may contain:
    //   event: <name>
    //   data: <json>
    let currentEvent = null;

    while (!clientGone) {
      const { value, done } = await reader.read().catch(() => ({ done: true }));
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const raw = buffer.slice(0, idx).trim(); // one event block
        buffer = buffer.slice(idx + 2);

        if (!raw) continue;
        const lines = raw.split('\n');
        for (const line of lines) {
          if (line.startsWith('event:')) currentEvent = line.slice(6).trim();
          else if (line.startsWith('data:')) {
            const payload = line.slice(5).trim();
            if (!payload) continue;
            // Handle interesting events
            if (currentEvent === 'response.output_text.delta') {
              try {
                const j = JSON.parse(payload);
                const delta = j?.delta || '';
                if (delta) {
                  gotAny = true;
                  write({ delta }); // forward to client
                }
              } catch {}
            } else if (currentEvent === 'response.error') {
              try {
                const j = JSON.parse(payload);
                write({ error: j?.error?.message || 'response.error' });
              } catch { write({ error: 'response.error' }); }
            } else if (currentEvent === 'response.completed') {
              // graceful end — do nothing, we'll finish when stream ends
            }
          }
        }
        currentEvent = null; // reset for next block
      }
    }

    clear();
    if (!clientGone) { write('[DONE]'); end(); }
  } catch (e) {
    const aborted = e?.name === 'AbortError' || /aborted/i.test(e?.message || '');
    if (!aborted) { try { write({ error: e.message || 'stream failed' }); write('[DONE]'); } catch {} }
    end();
  }
});

// ---------- cost estimate ----------
app.post('/api/estimate', uploadTemp.array('files'), async (req, res) => {
  try {
    const { prompt = '', styleProfile = '', pinned = '[]', chatId = 'default' } = req.body;
    const pinnedIds = JSON.parse(pinned || '[]');

    let chars = prompt.length + styleProfile.length;
    for (const f of (req.files || [])) {
      const content = await readFileSmart(f.path, f.originalname);
      chars += content.length;
    }
    const chatFiles = await listChatFiles(chatId);
    for (const cf of chatFiles) {
      const p = path.join(chatDir(chatId), cf.name);
      const content = await readFileSmart(p, cf.name);
      chars += content.length;
    }
    const items = loadLib().filter(x => pinnedIds.includes(x.id) || x.pinned);
    for (const it of items) {
      const p = path.join(LIB_DIR, it.storedName);
      const content = await readFileSmart(p, it.filename);
      chars += content.length;
    }
    for (const f of (req.files || [])) { try { await fsp.unlink(f.path); } catch {} }

    const tokens = Math.ceil(chars / 4);
    const inputCost = (tokens / 1_000_000) * 5; // ≈$5/million input tokens (tweak to your model)
    res.json({ tokens, inputCostUSD: Number(inputCost.toFixed(4)) });
  } catch (e) { console.error(e); res.status(500).json({ error: 'estimate failed' }); }
});

// ---------- start ----------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

