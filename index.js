// ================================
// MyCoder Backend (index.js)
// ================================
require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const multer = require('multer');
const axios = require('axios');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---- Static front-end
app.use(express.static(path.join(__dirname, 'public')));

// ---- Storage layout
const DATA_DIR = path.join(__dirname, 'data');
const CHAT_DIR = path.join(DATA_DIR, 'chats');
const LIB_DIR = path.join(DATA_DIR, 'library');
const TMP_DIR = path.join(__dirname, 'uploads');

for (const d of [DATA_DIR, CHAT_DIR, LIB_DIR, TMP_DIR]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

// ---- Multer temp upload
const upload = multer({ dest: TMP_DIR });

// ---- Secrets & OpenAI
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_BASE = process.env.OPENAI_BASE || 'https://api.openai.com';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o'; // high-end
const PER_TOKEN_USD = 0.000002; // rough input token estimate
const ACCESS_KEY = process.env.MYCODER_PASSWORD || ''; // protects only the real endpoints

// ---- Access-key guard: only for /ask-ai* (real API)
function requireKey(req, res, next) {
  if (!ACCESS_KEY) {
    return res.status(503).json({ error: 'Real API disabled (no MYCODER_PASSWORD set).' });
  }
  const incoming = req.get('x-mycoder-key') || req.query.key;
  if (incoming && incoming === ACCESS_KEY) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// Tiny verification endpoint for front-end login modal
app.post('/auth/verify', (req, res) => {
  const key = req.body?.key;
  if (!ACCESS_KEY) return res.status(503).json({ ok: false, error: 'Real API disabled' });
  if (key && key === ACCESS_KEY) return res.json({ ok: true });
  return res.status(401).json({ ok: false, error: 'Invalid key' });
});

// ---- Util
function assertApiKey() {
  if (!OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY in .env');
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function safeName(name) { return (name||'').replace(/[^\w.\-()+\s]/g, '_'); }
async function ensureDir(p) { await fsp.mkdir(p, { recursive: true }); }
function tokensFromChars(chars) { return Math.ceil(chars / 4); }
function truncateByBudget(str, maxChars) { return (str.length <= maxChars) ? str : (str.slice(0, maxChars) + '\n\n[truncated]'); }

async function extractText(filePath, originalname, mimetype) {
  const ext = (path.extname(originalname || '').toLowerCase());
  try {
    if (ext === '.pdf' || mimetype === 'application/pdf') {
      const data = await pdfParse(fs.readFileSync(filePath));
      return data.text || '';
    } else if (ext === '.docx' || mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const { value } = await mammoth.extractRawText({ path: filePath });
      return value || '';
    } else if (ext === '.txt' || mimetype?.startsWith('text/')) {
      return fs.readFileSync(filePath, 'utf8');
    } else {
      try { return fs.readFileSync(filePath, 'utf8'); }
      catch { return ''; }
    }
  } catch (e) {
    console.warn('extractText failed for', originalname, e.message);
    return '';
  }
}

async function listChatFiles(chatId) {
  const dir = path.join(CHAT_DIR, chatId);
  try {
    const files = await fsp.readdir(dir);
    return await Promise.all(files.map(async f => {
      const p = path.join(dir, f);
      const stat = await fsp.stat(p);
      return { name: f, size: stat.size, path: p };
    }));
  } catch {
    return [];
  }
}
async function readPinnedIds() {
  const pinPath = path.join(LIB_DIR, '.pins.json');
  try { return JSON.parse(await fsp.readFile(pinPath, 'utf8')); } catch { return []; }
}
async function writePinnedIds(arr) {
  const pinPath = path.join(LIB_DIR, '.pins.json');
  await fsp.writeFile(pinPath, JSON.stringify(arr || []), 'utf8');
}
async function listLibrary() {
  const pinIds = await readPinnedIds();
  const files = await fsp.readdir(LIB_DIR);
  const rows = [];
  for (const f of files) {
    if (f.startsWith('.')) continue;
    const p = path.join(LIB_DIR, f);
    const st = await fsp.stat(p);
    if (!st.isFile()) continue;
    rows.push({ id: f, filename: f, size: st.size, pinned: pinIds.includes(f), collection: '' });
  }
  return rows;
}

// ===================================
// Library & chat file endpoints
// ===================================
app.get('/api/library', async (req, res) => {
  try { res.json(await listLibrary()); } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/library/upload', upload.array('files'), async (req, res) => {
  try {
    for (const f of req.files || []) {
      const dest = path.join(LIB_DIR, safeName(f.originalname));
      await fsp.rename(f.path, dest);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/library/pin', async (req, res) => {
  try {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const { id, pinned } = body;
      const current = await readPinnedIds();
      const next = pinned ? Array.from(new Set([...current, id])) : current.filter(x => x !== id);
      await writePinnedIds(next);
      res.json({ ok: true, pinned: next });
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/library/:id', async (req, res) => {
  try {
    const id = safeName(req.params.id);
    await fsp.unlink(path.join(LIB_DIR, id));
    const pins = await readPinnedIds();
    await writePinnedIds(pins.filter(x => x !== id));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.get('/api/chat/files', async (req, res) => {
  const { chatId } = req.query;
  if (!chatId) return res.json([]);
  const rows = await listChatFiles(chatId);
  res.json(rows.map(r => ({ name: r.name, size: r.size })));
});
app.delete('/api/chat/files/:name', async (req, res) => {
  const { chatId } = req.query;
  const name = req.params.name;
  if (!chatId || !name) return res.status(400).json({ error: 'chatId and name required' });
  try {
    await fsp.unlink(path.join(CHAT_DIR, chatId, name));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// =====================
// Cost / token estimate
// =====================
app.post('/api/estimate', upload.array('files'), async (req, res) => {
  try {
    const { prompt = '', styleProfile = '' } = req.body || {};
    let chars = prompt.length + styleProfile.length;

    for (const f of req.files || []) {
      chars += Math.min(400000, Math.max(1000, f.size));
      fs.unlinkSync(f.path);
    }

    const tokens = tokensFromChars(chars);
    const inputCostUSD = tokens * PER_TOKEN_USD;
    res.json({ tokens, inputCostUSD });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ======================
// Non-streaming fallback
// ======================
app.post('/ask-ai', requireKey, upload.array('files'), async (req, res) => {
  try {
    assertApiKey();
    const {
      prompt = '',
      chatId = 'default',
      styleProfile = '',
      retrieval = 'semantic',
      ragK = '24',
      ragBudget = '48000',
      srcUploads = '1',
      srcChat = '1',
      srcLibrary = '1',
      mode = 'implement',
      depth = 'normal',
      maxTokens = '4096',
      critique = '0'
    } = req.body || {};

    const context = await buildContext({
      chatId,
      uploaded: req.files || [],
      takeUploads: srcUploads === '1',
      takeChat: srcChat === '1',
      takeLibrary: srcLibrary === '1',
      ragBudget: Number(ragBudget)
    });

    const sys = systemPrompt({ mode, depth, critique });
    const user = userPrompt({ prompt, styleProfile, context, retrieval, ragK: Number(ragK), maxTokens: Number(maxTokens) });

    const r = await axios.post(`${OPENAI_BASE}/v1/chat/completions`, {
      model: OPENAI_MODEL,
      stream: false,
      temperature: 0.2,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user }
      ],
      max_tokens: Math.max(256, Math.min(8192, Number(maxTokens) || 4096))
    }, { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } });

    // Cleanup temp uploads
    for (const f of req.files || []) try { fs.unlinkSync(f.path); } catch {}

    res.json({ aiResponse: r.data.choices?.[0]?.message?.content || '' });
  } catch (e) {
    console.error('ask-ai error', e.response?.data || e.message);
    res.status(500).json({ error: e.message });
  }
});

// ==================
// Streaming endpoint
// ==================
app.post('/ask-ai/stream', requireKey, upload.array('files'), async (resReq, resRes) => {
  try {
    assertApiKey();
    resRes.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const fields = { ...(resReq.body || {}) };
    const {
      prompt = '',
      chatId = 'default',
      styleProfile = '',
      retrieval = 'semantic',
      ragK = '24',
      ragBudget = '48000',
      srcUploads = '1',
      srcChat = '1',
      srcLibrary = '1',
      mode = 'implement',
      depth = 'normal',
      maxTokens = '4096',
      critique = '0'
    } = fields;

    const context = await buildContext({
      chatId,
      uploaded: resReq.files || [],
      takeUploads: srcUploads === '1',
      takeChat: srcChat === '1',
      takeLibrary: srcLibrary === '1',
      ragBudget: Number(ragBudget)
    });

    resRes.write(`data: ${JSON.stringify({
      meta: {
        files: context.parts.map(p => ({ name: p.name, source: p.source, chars: p.text.length })),
        tokens: tokensFromChars(context.concatText.length),
        mode, depth,
        retrievalStats: { k: Number(ragK), selected: context.parts.length, candidates: context.candidates },
        maxTokensUsed: Math.max(256, Math.min(8192, Number(maxTokens) || 4096))
      }
    })}\n\n`);

    const sys = systemPrompt({ mode, depth, critique });
    const user = userPrompt({ prompt, styleProfile, context, retrieval, ragK: Number(ragK), maxTokens: Number(maxTokens) });

    const r = await axios({
      method: 'post',
      url: `${OPENAI_BASE}/v1/chat/completions`,
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      responseType: 'stream',
      data: {
        model: OPENAI_MODEL,
        stream: true,
        temperature: 0.2,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user }
        ],
        max_tokens: Math.max(256, Math.min(8192, Number(maxTokens) || 4096))
      }
    });

    let gotAny = false;
    r.data.on('data', (chunk) => {
      const str = chunk.toString('utf8');
      str.split('\n').forEach(line => {
        if (!line.trim()) return;
        if (line.startsWith('data:')) {
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') {
            resRes.write('data: [DONE]\n\n');
            resRes.end(); return;
          }
          try {
            const obj = JSON.parse(payload);
            const delta = obj.choices?.[0]?.delta?.content || '';
            if (delta) {
              gotAny = true;
              resRes.write(`data: ${JSON.stringify({ delta })}\n\n`);
            }
          } catch { /* ignore keepalive */ }
        }
      });
    });

    r.data.on('end', async () => {
      if (!gotAny) {
        try {
          const rr = await axios.post(`${OPENAI_BASE}/v1/chat/completions`, {
            model: OPENAI_MODEL,
            stream: false,
            temperature: 0.2,
            messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
            max_tokens: Math.max(256, Math.min(8192, Number(maxTokens) || 4096))
          }, { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } });
          const content = rr.data.choices?.[0]?.message?.content || '';
          resRes.write(`data: ${JSON.stringify({ delta: content })}\n\n`);
        } catch (e) {
          resRes.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
        }
      }
      resRes.write('data: [DONE]\n\n');
      resRes.end();
    });

    r.data.on('error', (e) => {
      resRes.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
      resRes.write('data: [DONE]\n\n');
      resRes.end();
    });
  } catch (e) {
    console.error('stream error', e.message);
    try {
      resRes.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
      resRes.write('data: [DONE]\n\n');
      resRes.end();
    } catch {}
  } finally {
    for (const f of (resReq.files || [])) try { fs.unlinkSync(f.path); } catch {}
  }
});

// =====================
// Mock endpoint (public)
// =====================
app.post('/api/process', upload.array('files'), async (req, res) => {
  const prompt = req.body.prompt || '';
  const files = req.files || [];
  for (const f of files) try { fs.unlinkSync(f.path); } catch {}
  res.json({ response: `Pretend AI says: "${prompt}" with ${files.length} file(s) uploaded.` });
});

// =====================
// Context helpers
// =====================
async function buildContext({ chatId, uploaded, takeUploads, takeChat, takeLibrary, ragBudget }) {
  const parts = [];
  let candidates = 0;

  // 1) New uploads: persist to chat folder, extract text
  if (takeUploads && uploaded?.length) {
    const chatPath = path.join(CHAT_DIR, chatId);
    await ensureDir(chatPath);
    for (const f of uploaded) {
      const dest = path.join(chatPath, safeName(f.originalname));
      try { await fsp.copyFile(f.path, dest); } catch {}
      const text = await extractText(f.path, f.originalname, f.mimetype);
      if (text?.trim()) parts.push({ source: 'upload', name: f.originalname, text });
    }
  }

  // 2) Chat files (persisted)
  if (takeChat) {
    const rows = await listChatFiles(chatId);
    for (const r of rows) {
      const text = await extractText(r.path, r.name, '');
      candidates++;
      if (text?.trim()) parts.push({ source: 'chat', name: r.name, text });
    }
  }

  // 3) Pinned library
  if (takeLibrary) {
    const pinIds = await readPinnedIds();
    for (const id of pinIds) {
      const p = path.join(LIB_DIR, id);
      if (!fs.existsSync(p)) continue;
      const text = await extractText(p, id, '');
      candidates++;
      if (text?.trim()) parts.push({ source: 'lib', name: id, text });
    }
  }

  // Budgeting: keep order: uploads first, then chat files, then library; trim to char budget
  let remaining = Math.max(2000, ragBudget || 48000);
  const selected = [];
  for (const part of parts) {
    if (remaining <= 0) break;
    const take = part.text.length <= remaining ? part.text : part.text.slice(0, remaining);
    selected.push({ ...part, text: take });
    remaining -= take.length;
  }

  const concatText = selected.map(p => `## [${p.source}] ${p.name}\n${p.text}`).join('\n\n');
  return { parts: selected, concatText, candidates };
}

function systemPrompt({ mode, depth, critique }) {
  return [
    'You are MyCoder, a rigorous coding assistant.',
    'Always produce clear, compilable code with explanations.',
    `Mode: ${mode}. Depth: ${depth}. Critique pass: ${critique==='1'?'enabled':'disabled'}.`,
    'When given a PDF/notes, align with course conventions and the user’s style profile.',
    'Prefer step-by-step planning for larger tasks, and show structure (files, classes) before code.'
  ].join(' ');
}

function userPrompt({ prompt, styleProfile, context, retrieval, ragK, maxTokens }) {
  const pro = prompt || '';
  const style = styleProfile ? `\n\n### Style Profile\n${styleProfile}\n` : '';
  const ctx = context?.concatText ? `\n\n### Context (${retrieval}, k=${ragK}, maxOut=${maxTokens})\n${context.concatText}\n` : '';
  const ask = `\n\n### Task\n${pro}\n`;
  const instr = '\n\n### Instructions\nReturn well-formatted Markdown with code blocks using proper language tags.';
  return `${style}${ctx}${ask}${instr}`;
}

// ----------------
// Start Server
// ----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

