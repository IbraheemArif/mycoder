// ================================
// MyCoder Backend (index.js)
// ================================

require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const axios = require('axios');
const pdfParse = require('pdf-parse');

const app = express();
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Ensure needed folders exist ---
const DATA_DIR = path.join(__dirname, 'data');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const LIB_DIR = path.join(UPLOADS_DIR, 'library');
for (const p of [DATA_DIR, UPLOADS_DIR, LIB_DIR]) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}
const LIB_INDEX = path.join(DATA_DIR, 'library.json');
if (!fs.existsSync(LIB_INDEX)) fs.writeFileSync(LIB_INDEX, JSON.stringify([]));

// --- Multer uploaders ---
const uploadTemp = multer({ dest: path.join(UPLOADS_DIR, 'tmp') });
const uploadLibrary = multer({ dest: LIB_DIR });

// ---------------
// Health Check
// ---------------
app.get('/', (_req, res) => {
  res.send('✅ MyCoder backend is running!');
});

// ---------------
// Utility: read file content (with PDF support)
// ---------------
async function readFileSmart(filePath, originalName) {
  const ext = (originalName || '').toLowerCase();
  try {
    if (ext.endsWith('.pdf')) {
      const data = await pdfParse(await fsp.readFile(filePath));
      return data.text || '';
    }
    // treat as utf8 text for code/markdown/txt/json/java/py/etc
    return await fsp.readFile(filePath, 'utf8');
  } catch {
    // fallback: binary not supported -> return a notice
    return `[binary or unreadable content for ${originalName}]`;
  }
}

// ---------------
// Library APIs (persistent uploads you can reuse/pin)
// ---------------
function loadLib() {
  return JSON.parse(fs.readFileSync(LIB_INDEX, 'utf8'));
}
function saveLib(items) {
  fs.writeFileSync(LIB_INDEX, JSON.stringify(items, null, 2));
}

// List
app.get('/api/library', (_req, res) => {
  res.json(loadLib());
});

// Upload to library
app.post('/api/library/upload', uploadLibrary.array('files'), async (req, res) => {
  try {
    const collection = req.body.collection || 'default';
    const items = loadLib();

    const newItems = await Promise.all((req.files || []).map(async f => {
      // Move file to a stable name (keep multer name)
      const id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
      const dest = path.join(LIB_DIR, f.filename);
      // already there with multer; record metadata:
      const stats = await fsp.stat(dest);
      const meta = {
        id,
        filename: f.originalname,
        storedName: f.filename,
        size: stats.size,
        uploadedAt: Date.now(),
        collection,
        pinned: false
      };
      items.push(meta);
      return meta;
    }));

    saveLib(items);
    res.json({ ok: true, added: newItems.length, items: newItems });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// Pin / Unpin
app.post('/api/library/pin', express.json(), (req, res) => {
  const { id, pinned } = req.body || {};
  const items = loadLib();
  const idx = items.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  items[idx].pinned = !!pinned;
  saveLib(items);
  res.json({ ok: true, item: items[idx] });
});

// Delete library item
app.delete('/api/library/:id', async (req, res) => {
  const { id } = req.params;
  const items = loadLib();
  const idx = items.findIndex(x => x.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  const item = items[idx];
  try {
    const filePath = path.join(LIB_DIR, item.storedName);
    if (fs.existsSync(filePath)) await fsp.unlink(filePath);
  } catch (e) {
    console.warn('Could not delete file:', e.message);
  }
  items.splice(idx, 1);
  saveLib(items);
  res.json({ ok: true });
});

// ---------------
// Mock process endpoint (local only)
// ---------------
app.post('/api/process', uploadTemp.array('files'), async (req, res) => {
  try {
    const { prompt = '', styleProfile = '', pinned = '[]' } = req.body;
    const pinnedIds = JSON.parse(pinned || '[]');

    // Collect context from uploaded files
    let filesData = '';
    for (const file of (req.files || [])) {
      const content = await readFileSmart(file.path, file.originalname);
      filesData += `\n\n--- FILE: ${file.originalname} ---\n${content.slice(0, 8000)}`;
      // cleanup temp
      try { await fsp.unlink(file.path); } catch {}
    }

    // Add pinned library items
    const items = loadLib().filter(x => pinnedIds.includes(x.id) || x.pinned);
    for (const it of items) {
      const filePath = path.join(LIB_DIR, it.storedName);
      const content = await readFileSmart(filePath, it.filename);
      filesData += `\n\n--- LIBRARY: ${it.filename} ---\n${content.slice(0, 8000)}`;
    }

    // Return mock response
    return res.json({
      response:
        `Pretend AI says: "${prompt || '(no text)'}"\n\n` +
        `StyleProfile: ${styleProfile ? '[provided]' : '[none]'}\n` +
        `Attachments: ${(req.files || []).length} | Pinned library: ${items.length}\n` +
        `\n(Context length preview: ${filesData.length} chars)`
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'process failed' });
  }
});

// ---------------
// Plan endpoint (mock unless API key set)
// ---------------
app.post('/api/plan', uploadTemp.array('files'), async (req, res) => {
  try {
    const { prompt = '' } = req.body;
    const plan = {
      requirements: [
        'Parse assignment PDF to extract tasks',
        'Reference slides/starter code first',
        'Generate code per-file with your style',
      ],
      steps: [
        'Build structured plan (dir tree, classes, methods)',
        'Retrieve top-12 relevant snippets (slides → starter → projects)',
        'Generate code; run style check; retry if needed',
      ],
      dirTree: [
        'src/',
        'src/Main.java',
        'src/PriorityQueue280.java'
      ],
      citations: (req.files || []).map(f => ({ type: 'upload', name: f.originalname }))
    };
    res.json({ ok: true, plan });
    // cleanup temp
    for (const file of (req.files || [])) { try { await fsp.unlink(file.path); } catch {} }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'plan failed' });
  }
});

// ---------------
// Ask-AI (real OpenAI if key != 'xxx')
// ---------------
app.post('/ask-ai', uploadTemp.array('files'), async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  const useMock = !apiKey || apiKey === 'xxx';

  try {
    const { prompt = '', styleProfile = '', pinned = '[]' } = req.body;
    const pinnedIds = JSON.parse(pinned || '[]');

    let filesData = '';
    for (const file of (req.files || [])) {
      const content = await readFileSmart(file.path, file.originalname);
      filesData += `\n\n--- FILE: ${file.originalname} ---\n${content.slice(0, 8000)}`;
      try { await fsp.unlink(file.path); } catch {}
    }
    const items = loadLib().filter(x => pinnedIds.includes(x.id) || x.pinned);
    for (const it of items) {
      const filePath = path.join(LIB_DIR, it.storedName);
      const content = await readFileSmart(filePath, it.filename);
      filesData += `\n\n--- LIBRARY: ${it.filename} ---\n${content.slice(0, 8000)}`;
    }

    const systemPrompt =
`You are an AI coding assistant. 
Always honor the user's coding style (JSON below) and prefer course materials (slides/starter/projects) in context.
If you cite, refer to filenames and page/line when possible.

STYLE PROFILE (JSON):
${styleProfile || '(none provided)'}`;

    const fullUser =
`ASSIGNMENT / REQUEST:
${prompt || '(no text)'}

CONTEXT (Uploads + Pinned Library):
${filesData || '(none)'}
`;

    if (useMock) {
      return res.json({
        aiResponse:
          `🧪 MOCK RESPONSE (no API key):\n\n` +
          `Request: ${prompt || '(no text)'}\n` +
          `Style profile: ${styleProfile ? '[provided]' : '[none]'}\n` +
          `Pinned items: ${items.length} | Attachments: ${(req.files || []).length}\n` +
          `\n(Provide a real OPENAI_API_KEY in .env to enable GPT-4o)`
      });
    }

    // Real OpenAI call
    const r = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: fullUser }
        ],
        temperature: 0.2,
        max_tokens: 2000
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const text = r.data?.choices?.[0]?.message?.content || '(no content)';
    res.json({ aiResponse: text });
  } catch (e) {
    console.error(e.response?.data || e.message);
    res.status(500).json({ error: 'ask-ai failed' });
  }
});

// ---------------
// Cost estimate (very rough)
// ---------------
app.post('/api/estimate', uploadTemp.array('files'), async (req, res) => {
  try {
    const { prompt = '', styleProfile = '', pinned = '[]' } = req.body;
    const pinnedIds = JSON.parse(pinned || '[]');

    let chars = prompt.length + styleProfile.length;
    // uploaded files
    for (const f of (req.files || [])) {
      const content = await readFileSmart(f.path, f.originalname);
      chars += content.length;
      try { await fsp.unlink(f.path); } catch {}
    }
    // pinned
    const items = loadLib().filter(x => pinnedIds.includes(x.id) || x.pinned);
    for (const it of items) {
      const filePath = path.join(LIB_DIR, it.storedName);
      const content = await readFileSmart(filePath, it.filename);
      chars += content.length;
    }

    // rough tokens = chars/4
    const tokens = Math.ceil(chars / 4);
    // rough costs @ 4o: $5/million in, $15/million out. We only estimate input here.
    const inputCost = (tokens / 1_000_000) * 5;
    res.json({ tokens, inputCostUSD: Number(inputCost.toFixed(4)) });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'estimate failed' });
  }
});

// ---------------
// Start
// ---------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

