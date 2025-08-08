/* global Prism */

// Tiny helpers to avoid crashes if an element is missing.
function $(id){ return document.getElementById(id); }
function bind(el, evt, fn){ if(el) el.addEventListener(evt, fn); else console.warn(`[UI] Missing element for ${evt}:`, fn.name || '(anon)'); }
function txt(el, s){ if(el) el.textContent = s; }
function html(el, s){ if(el) el.innerHTML = s; }

window.addEventListener('error', (e) => {
  console.error('[App] Uncaught error:', e.message, 'at', e.filename, e.lineno+':'+e.colno);
});
window.addEventListener('DOMContentLoaded', () => {
  console.log('[App] Booting UI…');

  // ---- State ----
  let API_ENDPOINT = localStorage.getItem('endpoint') || '/ask-ai';
  let STYLE_PROFILE = localStorage.getItem('styleProfile') || '';
  let DARK = localStorage.getItem('dark') === '1';

  let CURRENCY = localStorage.getItem('currency') || 'CAD';
  let FX_RATE = parseFloat(localStorage.getItem('fxRate') || '1.35') || 1.0;
  let BUDGET_CAP = parseFloat(localStorage.getItem('budgetCap') || '0') || 0;

  let SPEND_USD_GLOBAL = parseFloat(localStorage.getItem('spendAllUsd') || '0') || 0;
  let TOKENS_GLOBAL = parseInt(localStorage.getItem('tokensAll') || '0', 10) || 0;

  // ---- DOM ----
  const chatEl = $('chat');
  const fileInput = $('fileInput');
  const chooseFiles = $('chooseFiles');
  const filePills = $('filePills');
  const promptEl = $('prompt');
  const sendBtn = $('sendBtn');
  const stopBtn = $('stopBtn');
  const historyEl = $('history');
  const newChatBtn = $('newChatBtn');
  const settingsBtn = $('settingsBtn');
  const settingsModal = $('settingsModal');
  const endpointSel = $('endpoint');
  const styleProfileEl = $('styleProfile');
  const currencySel = $('currency');
  const fxRateEl = $('fxRate');
  const budgetInput = $('budgetCap');
  const darkToggle = $('darkToggle');
  const modelName = $('modelName');
  const libraryBtn = $('libraryBtn');
  const libraryModal = $('libraryModal');
  const libFiles = $('libFiles');
  const libCollection = $('libCollection');
  const libUploadBtn = $('libUploadBtn');
  const libList = $('libList');
  const closeLibrary = $('closeLibrary');
  const deleteAllBtn = $('deleteAllBtn');
  const costBadge = $('costBadge');
  const chatBadge = $('chatBadge');
  const totalBadge = $('totalBadge');
  const chatFilesBtn = $('chatFilesBtn');
  const chatFilesModal = $('chatFilesModal');
  const chatFilesList = $('chatFilesList');
  const closeChatFiles = $('closeChatFiles');

  const styleToggle = $('styleToggle');
  const dockMsg = $('dockMessageFiles');
  const dockChat = $('dockChatFiles');
  const dockLib = $('dockLibrary');
  const dockSent = $('dockSent');

  const chipBtns = [...document.querySelectorAll('.chip[data-mode]')];
  const depthSel = $('depthSel');
  const maxTok = $('maxTok');
  const critique = $('critique');

  const retrChips = [...document.querySelectorAll('.chip[data-retrieval]')];
  const ragK = $('ragK');
  const ragBudget = $('ragBudget');
  const srcUploads = $('srcUploads');
  const srcChat = $('srcChat');
  const srcLibrary = $('srcLibrary');

  // quick sanity log
  console.log('[App] Elements wired:', {
    chatEl: !!chatEl, settingsBtn: !!settingsBtn, settingsModal: !!settingsModal,
    libraryBtn: !!libraryBtn, libraryModal: !!libraryModal, deleteAllBtn: !!deleteAllBtn
  });

  // ---- Local state ----
  let attachedFiles = [];
  let conversation = loadOrNewConversation();
  let includeStyle = true;
  let currentAbort = null;
  let libMap = {};
  let chatFilesCache = [];

  const curSymbol = () => (CURRENCY === 'CAD' ? 'C$' : 'US$');
  const toLocal = (usd) => (CURRENCY === 'CAD' ? usd * FX_RATE : usd);
  const fmtMoney = (n) => (n || 0).toFixed(4);

  // ---- Theme ----
  applyTheme();
  function applyTheme(){ document.documentElement.classList.toggle('dark', DARK); }
  if (darkToggle) { darkToggle.checked = DARK; bind(darkToggle, 'change', () => { DARK = !!darkToggle.checked; localStorage.setItem('dark', DARK ? '1':'0'); applyTheme(); }); }

  // ---- Init ----
  if (styleProfileEl) styleProfileEl.value = STYLE_PROFILE;
  refreshLibraryMap().catch(()=>{});
  refreshChatFiles().catch(()=>{});
  renderHistory();
  renderConversation();
  updateSpendBadges();
  renderDock();
  if (costBadge) txt(costBadge, `Est: ${curSymbol()}0.0000 • ~0 tok`);
  if (modelName) txt(modelName, API_ENDPOINT === '/ask-ai' ? 'GPT (real, streaming)' : 'Local (mock)');

  // ---- Conversation ----
  function loadOrNewConversation() {
    const id = localStorage.getItem('activeConvId');
    if (id) {
      const raw = localStorage.getItem(`conv:${id}`);
      if (raw) return JSON.parse(raw);
    }
    const conv = { id: Date.now().toString(), title: "New chat", messages: [], totals: { inputUSD: 0, inputTokens: 0 } };
    localStorage.setItem('activeConvId', conv.id);
    return conv;
  }
  function saveConversation() {
    if (!conversation.title || conversation.title === 'New chat') {
      conversation.title = deriveTitle(conversation);
    }
    localStorage.setItem(`conv:${conversation.id}`, JSON.stringify(conversation));
    localStorage.setItem('activeConvId', conversation.id);
    const all = JSON.parse(localStorage.getItem('history') || '[]').filter(c => c.id !== conversation.id);
    all.unshift({ id: conversation.id, title: conversation.title, updatedAt: Date.now() });
    localStorage.setItem('history', JSON.stringify(all));
    renderHistory();
  }
  function deriveTitle(conv) {
    const m = conv.messages?.find(mm => mm.role === 'user' && (mm.content || '').trim());
    if (m) return (m.content || '').trim().slice(0, 60);
    const f = window._firstFilesForTitle;
    if (f?.length) return f[0].name.slice(0,60);
    return new Date().toLocaleString();
  }
  function renderHistory(){
    if (!historyEl) return;
    const all = JSON.parse(localStorage.getItem('history') || '[]');
    historyEl.innerHTML = '';
    for (const c of all) {
      const row = document.createElement('div'); row.className='item';
      const title = document.createElement('div'); title.className='title'; title.textContent=c.title||'New chat';
      bind(title, 'click', () => loadConversation(c.id));
      const actions = document.createElement('div'); actions.className='actions';
      const del = document.createElement('button'); del.className='btn danger'; del.textContent='Delete';
      bind(del, 'click', (e)=>{ e.stopPropagation(); if(confirm('Delete this chat?')) deleteConversation(c.id); });
      actions.appendChild(del); row.appendChild(title); row.appendChild(actions); historyEl.appendChild(row);
    }
  }
  function deleteConversation(id){
    const wasActive = conversation.id === id;
    localStorage.removeItem(`conv:${id}`);
    const all = JSON.parse(localStorage.getItem('history') || '[]').filter(c => c.id !== id);
    localStorage.setItem('history', JSON.stringify(all));
    if (wasActive) newChat(); else { renderHistory(); updateGlobalTotalsFromStorage(); updateSpendBadges(); }
  }
  function loadConversation(id){
    const raw = localStorage.getItem(`conv:${id}`);
    conversation = raw ? JSON.parse(raw) : { id, title:"Restored chat", messages:[], totals:{inputUSD:0,inputTokens:0}};
    localStorage.setItem('activeConvId', conversation.id);
    attachedFiles = [];
    window._firstFilesForTitle = null;
    renderPills();
    renderConversation();
    refreshChatFiles().catch(()=>{});
    if (dockSent) txt(dockSent, '—');
    renderDock();
    updateSpendBadges();
  }
  function renderConversation(){
    if (!chatEl) return;
    chatEl.innerHTML=''; for (const m of conversation.messages) addMessage(m.role, m.content, m.meta, true);
    chatEl.scrollTop = chatEl.scrollHeight;
  }
  function newChat(){
    if (conversation.messages?.length) saveConversation();
    conversation = { id: Date.now().toString(), title: "New chat", messages: [], totals: { inputUSD: 0, inputTokens: 0 } };
    localStorage.setItem('activeConvId', conversation.id);
    if (chatEl) chatEl.innerHTML='';
    attachedFiles=[]; renderPills(); if (promptEl) { promptEl.value=''; promptEl.focus(); }
    refreshChatFiles().catch(()=>{});
    if (dockSent) txt(dockSent, '—');
    renderDock(); renderHistory(); updateSpendBadges();
  }
  bind(newChatBtn, 'click', newChat);

  // ---- Settings ----
  if (endpointSel) endpointSel.value = API_ENDPOINT;
  if (currencySel) currencySel.value = CURRENCY;
  if (fxRateEl) fxRateEl.value = String(FX_RATE);
  if (budgetInput) budgetInput.value = BUDGET_CAP ? String(BUDGET_CAP) : '';

  bind(settingsBtn, 'click', () => settingsModal?.showModal());
  bind($('closeSettings'), 'click', () => settingsModal?.close());
  bind($('saveSettings'), 'click', () => {
    if (endpointSel) API_ENDPOINT = endpointSel.value;
    if (currencySel) CURRENCY = currencySel.value;
    if (fxRateEl) FX_RATE = parseFloat(fxRateEl.value || '1') || 1.0;
    if (budgetInput) BUDGET_CAP = parseFloat(budgetInput.value || '0') || 0;
    localStorage.setItem('endpoint', API_ENDPOINT);
    localStorage.setItem('currency', CURRENCY);
    localStorage.setItem('fxRate', String(FX_RATE));
    localStorage.setItem('budgetCap', String(BUDGET_CAP));
    if (modelName) txt(modelName, API_ENDPOINT === '/ask-ai' ? 'GPT (real, streaming)' : 'Local (mock)');
    updateSpendBadges();
    settingsModal?.close();
  });

  // ---- Modes ----
  let mode = 'implement';
  chipBtns.forEach(btn=>{
    bind(btn, 'click', () => {
      chipBtns.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      mode = btn.dataset.mode;
    });
  });

  // ---- Retrieval mode ----
  let retrieval = 'semantic';
  retrChips.forEach(btn=>{
    bind(btn, 'click', ()=>{
      retrChips.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      retrieval = btn.dataset.retrieval;
    });
  });

  // ---- Library / Chat files ----
  bind(libraryBtn, 'click', async()=>{ await refreshLibrary().catch(()=>{}); libraryModal?.showModal(); });
  bind(closeLibrary, 'click', ()=>libraryModal?.close());
  bind(libUploadBtn, 'click', async (e)=>{ e.preventDefault(); if(!libFiles?.files?.length) return alert('Choose files first.');
    const fd = new FormData(); for (const f of libFiles.files) fd.append('files', f);
    if (libCollection?.value) fd.append('collection', libCollection.value);
    const r = await fetch('/api/library/upload',{method:'POST',body:fd}); if(!r.ok) return alert('Upload failed.');
    if (libFiles) libFiles.value=''; if (libCollection) libCollection.value='';
    await refreshLibrary().catch(()=>{}); await refreshLibraryMap().catch(()=>{}); renderDock();
    await fetch('/api/rag/reindex?source=library', { method:'POST' }).catch(()=>{});
  });
  async function refreshLibrary(){
    const r=await fetch('/api/library'); const list=await r.json(); if(!libList) return;
    libList.innerHTML='';
    list.forEach(item=>{
      const row=document.createElement('div'); row.className='lib-item';
      row.innerHTML = `<div class="lib-info"><strong>${item.filename}</strong><span class="muted">${Math.round(item.size/1024)} KB • ${item.collection||'default'}</span></div>`;
      const actions=document.createElement('div'); actions.className='lib-actions-row';
      const manual=document.createElement('input'); manual.type='checkbox'; manual.title='Include this turn';
      manual.checked = (JSON.parse(localStorage.getItem('pinnedIds')||'[]')).includes(item.id);
      bind(manual,'change',()=>{ let pins=JSON.parse(localStorage.getItem('pinnedIds')||'[]'); if(manual.checked){ if(!pins.includes(item.id)) pins.push(item.id);} else pins=pins.filter(x=>x!==item.id); localStorage.setItem('pinnedIds',JSON.stringify(pins)); renderDock(); });
      const pin=document.createElement('button'); pin.className='btn'; pin.textContent=item.pinned?'Unpin':'Pin';
      bind(pin,'click', async()=>{ await fetch('/api/library/pin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,pinned:!item.pinned})}); await refreshLibrary(); await refreshLibraryMap(); renderDock(); });
      const del=document.createElement('button'); del.className='btn danger'; del.textContent='Delete';
      bind(del,'click', async()=>{ if(!confirm(`Delete ${item.filename}?`)) return; await fetch(`/api/library/${item.id}`,{method:'DELETE'}); await refreshLibrary(); await refreshLibraryMap(); renderDock(); await fetch('/api/rag/reindex?source=library',{method:'POST'}).catch(()=>{}); });
      actions.appendChild(manual); actions.appendChild(pin); actions.appendChild(del); row.appendChild(actions); libList.appendChild(row);
    });
  }
  async function refreshLibraryMap(){ try{ const r=await fetch('/api/library'); const list=await r.json(); libMap={}; list.forEach(it=>libMap[it.id]=it.filename);}catch{} }

  bind(chatFilesBtn, 'click', async()=>{ await refreshChatFiles().catch(()=>{}); chatFilesModal?.showModal(); });
  bind(closeChatFiles, 'click', ()=>chatFilesModal?.close());
  async function refreshChatFiles(){
    try{
      const r=await fetch(`/api/chat/files?chatId=${encodeURIComponent(conversation.id)}`);
      chatFilesCache=await r.json();
      if (!chatFilesList) return;
      chatFilesList.innerHTML='';
      chatFilesCache.forEach(item=>{
        const row=document.createElement('div'); row.className='lib-item';
        row.innerHTML=`<div class="lib-info"><strong>${item.name}</strong><span class="muted">${Math.round(item.size/1024)} KB • saved</span></div>`;
        const actions=document.createElement('div'); actions.className='lib-actions-row';
        const del=document.createElement('button'); del.className='btn danger'; del.textContent='Delete';
        bind(del,'click', async()=>{ if(!confirm(`Remove ${item.name}?`)) return; await fetch(`/api/chat/files/${encodeURIComponent(item.name)}?chatId=${encodeURIComponent(conversation.id)}`,{method:'DELETE'}); await refreshChatFiles(); renderDock(); await fetch(`/api/rag/reindex?chatId=${encodeURIComponent(conversation.id)}`,{method:'POST'}).catch(()=>{}); });
        actions.appendChild(del); row.appendChild(actions); chatFilesList.appendChild(row);
      });
    }catch(e){ console.warn('refreshChatFiles failed', e); }
  }

  // ---- Dock ----
  if (styleToggle) { styleToggle.checked = true; bind(styleToggle, 'change', ()=>{ includeStyle = !!styleToggle.checked; }); }
  if (styleProfileEl) bind(styleProfileEl, 'input', ()=>{ STYLE_PROFILE = styleProfileEl.value; localStorage.setItem('styleProfile', STYLE_PROFILE); });

  function renderDock(){
    renderLimitedList(dockMsg, attachedFiles.map((f,i)=>({
      name: f.name, size: f.size, source: 'msg', onRemove: ()=>{ attachedFiles.splice(i,1); renderPills(); renderDock(); }
    })), 'No files attached');

    renderLimitedList(dockChat, chatFilesCache.map(cf=>({
      name: cf.name, size: cf.size, source: 'chat'
    })), 'None yet');

    const pinIds = JSON.parse(localStorage.getItem('pinnedIds')||'[]');
    const pinNames = pinIds.map(id=>({id, name: libMap[id]})).filter(x=>!!x.name);
    renderLimitedList(dockLib, pinNames.map(p=>({
      name: p.name, size: 0, source: 'lib', onRemove: ()=>{
        let pins=pinIds.filter(id => id !== p.id); localStorage.setItem('pinnedIds', JSON.stringify(pins)); renderDock();
      }
    })), 'None pinned');
  }

  function renderLimitedList(container, items, emptyText){
    if (!container) return;
    const LIMIT = 30;
    container.innerHTML = '';
    if (!items.length) { txt(container, emptyText); container.classList.add('empty'); return; }
    container.classList.remove('empty');

    const showAllBtn = document.createElement('span');
    showAllBtn.className = 'toggle';
    let expanded = false;

    function draw(){
      container.innerHTML = '';
      const slice = expanded ? items : items.slice(0, LIMIT);
      slice.forEach(it => container.appendChild(dockItem(it)));
      if (items.length > LIMIT) {
        txt(showAllBtn, expanded ? `Show less (${items.length})` : `Show more (+${items.length - LIMIT})`);
        container.appendChild(showAllBtn);
      }
    }
    bind(showAllBtn, 'click', ()=>{ expanded = !expanded; draw(); });
    draw();
  }
  function dockItem({ name, size, source, onRemove }){
    const kb = size ? Math.round(size/1024) : 0;
    const row = document.createElement('div'); row.className='dock-item';
    const left = document.createElement('div'); left.className='left';
    const right = document.createElement('div'); right.className='right';
    const label = document.createElement('div'); label.textContent = name;
    const meta = document.createElement('div'); meta.className='meta'; meta.textContent = kb ? `${kb} KB` : '';
    const badge = document.createElement('span'); badge.className='badge'; badge.textContent = source;
    left.appendChild(badge); left.appendChild(label); left.appendChild(meta);
    if (onRemove) { const rm=document.createElement('button'); rm.className='btn danger tiny'; rm.textContent='×'; rm.title='Remove'; bind(rm,'click',onRemove); }
    row.appendChild(left); row.appendChild(right);
    return row;
  }

  // ---- Attach files ----
  bind(chooseFiles, 'click', ()=> fileInput?.click());
  if (fileInput) fileInput.onchange = () => {
    const arr = Array.from(fileInput.files || []);
    if (arr.length && !conversation.messages?.length) window._firstFilesForTitle = arr;
    for (const f of arr) attachedFiles.push(f);
    fileInput.value=''; renderPills(); renderDock();
  };
  bind(document, 'dragover', (e)=> e.preventDefault());
  bind(document, 'drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) {
      const arr = Array.from(e.dataTransfer.files);
      if (arr.length && !conversation.messages?.length) window._firstFilesForTitle = arr;
      for (const f of arr) attachedFiles.push(f);
      renderPills(); renderDock();
    }
  });
  function renderPills(){
    if (!filePills) return;
    filePills.innerHTML='';
    attachedFiles.forEach((f,i)=>{
      const pill=document.createElement('span'); pill.className='pill'; pill.innerHTML=`${f.name} <span class="x" data-i="${i}">×</span>`;
      filePills.appendChild(pill);
    });
    filePills.querySelectorAll('.x').forEach(x=>x.addEventListener('click',(e)=>{ const i=Number(e.target.dataset.i); attachedFiles.splice(i,1); renderPills(); renderDock(); }));
  }

  // ---- Composer ----
  bind(promptEl, 'input', ()=>{ if(!promptEl) return; promptEl.style.height='auto'; promptEl.style.height=Math.min(promptEl.scrollHeight,220)+'px'; });
  bind(promptEl, 'keydown', (e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); }});
  bind(sendBtn, 'click', send);
  bind(stopBtn, 'click', ()=>{ if(currentAbort && !currentAbort.signal.aborted) currentAbort.abort(); });

  // ---- Estimate ----
  async function estimateCost(fd){
    try{ const r=await fetch('/api/estimate',{method:'POST',body:fd}); const d=await r.json(); const usd=+d.inputCostUSD||0; const tokens=+d.tokens||0;
      if (costBadge) txt(costBadge, `Est: ${curSymbol()}${fmtMoney(toLocal(usd))} • ~${tokens} tok`); return {usd,tokens};
    }catch{ if (costBadge) txt(costBadge, `Est: ${curSymbol()}0.0000 • ~0 tok`); return {usd:0,tokens:0}; }
  }

  // ---- Totals ----
  function updateConversationTotals(addUsd, addTokens){ conversation.totals=conversation.totals||{inputUSD:0,inputTokens:0}; conversation.totals.inputUSD+=(addUsd||0); conversation.totals.inputTokens+=(addTokens||0); saveConversation(); }
  function updateGlobalTotalsFromStorage(){ const all=JSON.parse(localStorage.getItem('history')||'[]'); let usd=0,tok=0; for(const c of all){ const raw=localStorage.getItem(`conv:${c.id}`); if(!raw) continue; const conv=JSON.parse(raw); if(conv?.totals){ usd+=+conv.totals.inputUSD||0; tok+=+conv.totals.inputTokens||0; } } SPEND_USD_GLOBAL=usd; TOKENS_GLOBAL=tok; localStorage.setItem('spendAllUsd',String(usd)); localStorage.setItem('tokensAll',String(tok)); }
  function updateSpendBadges(){ updateGlobalTotalsFromStorage(); const cu=+(conversation?.totals?.inputUSD||0), ct=+(conversation?.totals?.inputTokens||0); if (chatBadge) txt(chatBadge, `Chat: ${curSymbol()}${fmtMoney(toLocal(cu))} • ${ct} tok`); if (totalBadge) txt(totalBadge, `All: ${curSymbol()}${fmtMoney(toLocal(SPEND_USD_GLOBAL))} • ${TOKENS_GLOBAL} tok`); if (modelName) txt(modelName, API_ENDPOINT === '/ask-ai' ? 'GPT (real, streaming)' : 'Local (mock)'); }

  // ---- Send ----
  async function send(){
    const text = (promptEl?.value||'').trim();
    if (!text && attachedFiles.length===0) return;

    addMessage('user', text || '(no text)');
    conversation.messages.push({ role:'user', content:text });
    if (!conversation.title || conversation.title === 'New chat') {
      conversation.title = text ? text.slice(0,60) : (attachedFiles[0]?.name || new Date().toLocaleString());
    }
    saveConversation();

    const fd = new FormData();
    fd.append('prompt', text);
    fd.append('chatId', conversation.id);
    fd.append('mode', (document.querySelector('.chip[data-mode].active')?.dataset.mode) || 'implement');
    fd.append('depth', depthSel ? depthSel.value : 'normal');
    fd.append('maxTokens', String(Math.max(256, Math.min(8192, Number(maxTok?.value)||4096))));
    fd.append('critique', critique?.checked ? '1' : '0');

    const rChip = document.querySelector('.chip[data-retrieval].active');
    const retrieval = rChip ? rChip.dataset.retrieval : 'semantic';
    fd.append('retrieval', retrieval);
    fd.append('ragK', String(Math.max(2, Math.min(64, Number(ragK?.value)||24))));
    fd.append('ragBudget', String(Math.max(1000, Math.min(60000, Number(ragBudget?.value)||12000))));
    fd.append('srcUploads', srcUploads?.checked ? '1':'0');
    fd.append('srcChat', srcChat?.checked ? '1':'0');
    fd.append('srcLibrary', srcLibrary?.checked ? '1':'0');

    if (includeStyle && STYLE_PROFILE) fd.append('styleProfile', STYLE_PROFILE);
    const pinnedIds = JSON.parse(localStorage.getItem('pinnedIds')||'[]');
    if (pinnedIds.length) fd.append('pinned', JSON.stringify(pinnedIds));
    for (const f of attachedFiles) fd.append('files', f);

    const { usd:estUsd, tokens:estTok } = await estimateCost(copyFD(fd));
    if (estTok > 50000) {
      const go = confirm(`This turn is ~${estTok} tokens of input. Expect a long wait for the first token.\nProceed anyway?`);
      if (!go) return;
    }
    const chatLocal = toLocal(+conversation?.totals?.inputUSD||0), newLocal=toLocal(estUsd);
    if (BUDGET_CAP && (chatLocal + newLocal) > BUDGET_CAP){ if(!confirm(`This message is estimated ${curSymbol()}${fmtMoney(newLocal)}.\nCurrent chat: ${curSymbol()}${fmtMoney(chatLocal)}\nCap: ${curSymbol()}${fmtMoney(BUDGET_CAP)}\n\nProceed?`)) return; }

    const meta = { included:{ profile:!!(includeStyle && STYLE_PROFILE), uploads:attachedFiles.map(f=>f.name), chatFiles:chatFilesCache.map(f=>f.name), pinned:pinnedIds.map(id=>libMap[id]).filter(Boolean) }, est:{ inputTokens:estTok, inputUSD:estUsd } };

    if (API_ENDPOINT === '/ask-ai') await streamAskAI(fd, meta); else await postMock(fd, meta);
  }

  async function postMock(fd, meta){
    toggleSending(true);
    const msg = addMessage('assistant','',meta); const bubble = msg.querySelector('.bubble');
    try{
      const r=await fetch('/api/process',{method:'POST',body:fd}); const d=await r.json(); const content=d.aiResponse||d.response||'';
      html(bubble, renderMarkdown(content)); highlightBubble(bubble);
      conversation.messages.push({ role:'assistant', content, meta });
      updateConversationTotals(meta.est.inputUSD, meta.est.inputTokens); updateSpendBadges(); saveConversation(); await refreshChatFiles().catch(()=>{});
      if (dockSent) txt(dockSent, 'Mock mode (no actual context snapshot)');
    }catch(e){ txt(bubble, '⚠️ '+(e.message||e)); }
    finally{ resetComposer(); toggleSending(false); }
  }

  async function streamAskAI(fd, meta){
    toggleSending(true);
    const msg = addMessage('assistant','',meta); const bubble = msg.querySelector('.bubble');
    html(bubble,''); let full=''; let gotAny=false;

    if (currentAbort?.signal?.aborted) currentAbort=null;
    try{
      currentAbort = new AbortController();
      const res = await fetch('/ask-ai/stream',{method:'POST',body:fd,signal:currentAbort.signal});
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const reader = res.body.getReader(); const decoder = new TextDecoder('utf-8'); let buffer='';

      while(true){
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value,{stream:true});
        const parts = buffer.split('\n\n'); buffer = parts.pop() || '';
        for (const part of parts){
          const line = part.trim(); if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();

          if (data === '[DONE]'){
            if (!gotAny || !full.trim()) {
              const r2 = await fetch('/ask-ai', { method:'POST', body: copyFD(fd) });
              const j2 = await r2.json(); const fallback = j2.aiResponse || j2.response || '';
              full = fallback; html(bubble, renderMarkdown(fallback)); highlightBubble(bubble);
            }
            conversation.messages.push({ role:'assistant', content: full, meta });
            updateConversationTotals(meta.est.inputUSD, meta.est.inputTokens); updateSpendBadges(); saveConversation(); await refreshChatFiles().catch(()=>{});
            toggleSending(false); resetComposer(); currentAbort=null; return;
          }

          try{
            const obj = JSON.parse(data);
            if (obj.meta) { renderSentSnapshot(obj.meta); continue; }
            if (obj?.delta){
              gotAny = true;
              full += obj.delta;
              html(bubble, renderMarkdown(full));
              highlightBubble(bubble);
              if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
            } else if (obj?.error){
              txt(bubble, `⚠️ ${obj.error}`);
            }
          }catch{}
        }
      }

      if (!gotAny || !full.trim()) {
        try {
          const r2 = await fetch('/ask-ai', { method:'POST', body: copyFD(fd) });
          const j2 = await r2.json(); const fallback = j2.aiResponse || j2.response || '';
          full = fallback; html(bubble, renderMarkdown(fallback)); highlightBubble(bubble);
        } catch (e) { txt(bubble, '⚠️ Stream ended with no content and fallback failed.'); }
      }

      conversation.messages.push({ role:'assistant', content: full, meta });
      updateConversationTotals(meta.est.inputUSD, meta.est.inputTokens); updateSpendBadges(); saveConversation(); await refreshChatFiles().catch(()=>{});
    } catch (e) {
      if (e.name==='AbortError'||/aborted/i.test(e.message||'')){ txt(bubble, (bubble.textContent||'') + (bubble.textContent.endsWith('[stopped]')?'':'\n\n[stopped]')); }
      else {
        try { const r2 = await fetch('/ask-ai', { method:'POST', body: copyFD(fd) });
          const j2 = await r2.json(); const fallback = j2.aiResponse || j2.response || '';
          html(bubble, renderMarkdown(fallback)); highlightBubble(bubble);
          conversation.messages.push({ role:'assistant', content: fallback, meta });
          updateConversationTotals(meta.est.inputUSD, meta.est.inputTokens); updateSpendBadges(); saveConversation(); await refreshChatFiles().catch(()=>{});
        } catch { txt(bubble,'⚠️ '+(e.message||e)); }
      }
    } finally { currentAbort=null; toggleSending(false); resetComposer(); }
  }

  function renderSentSnapshot(meta){
    if (!dockSent) return;
    if (!meta || !meta.files) { txt(dockSent,'—'); return; }
    dockSent.innerHTML = '';
    const header = document.createElement('div'); header.className='muted';
    const totalTok = Math.ceil((meta.tokens||0));
    const rstats = meta.retrievalStats ? ` • RAG: k=${meta.retrievalStats.k}, picked=${meta.retrievalStats.selected}/${meta.retrievalStats.candidates}` : '';
    header.textContent = `Total ~${totalTok} tok • mode=${meta.mode} • depth=${meta.depth} • max=${meta.maxTokensUsed}${rstats}`;
    dockSent.appendChild(header);

    const list = meta.files.map(f=>({ name: f.name, size: Math.ceil((f.chars||0)/4), source: f.source }));
    const container = document.createElement('div');
    dockSent.appendChild(container);
    renderLimitedList(container, list, '—');
  }

  function toggleSending(b){ if(sendBtn) sendBtn.style.display=b?'none':'inline-block'; if(stopBtn) stopBtn.style.display=b?'inline-block':'none'; if(promptEl) promptEl.disabled=b; }
  function resetComposer(){ if(!promptEl) return; promptEl.value=''; promptEl.style.height='auto'; attachedFiles=[]; renderPills(); renderDock(); if (chatEl) chatEl.scrollTop=chatEl.scrollHeight; }
  function copyFD(fd){ const f=new FormData(); fd.forEach((v,k)=>f.append(k,v)); return f; }

  // ---- Rendering ----
  function addMessage(role, text, meta, skipMd){
    if (!chatEl) return { querySelector:()=>({}) };
    const msg=document.createElement('div'); msg.className='msg '+role;
    const avatar=document.createElement('div'); avatar.className='avatar'; avatar.textContent=role==='user'?'U':'AI';
    const bubble=document.createElement('div'); bubble.className='bubble'; bubble.innerHTML = skipMd ? escapeHtml(text||'') : renderMarkdown(text||'');
    msg.appendChild(avatar); msg.appendChild(bubble);

    if(role==='assistant' && meta){
      const metaWrap=document.createElement('div'); metaWrap.className='meta-row';
      const btn=document.createElement('button'); btn.className='btn ghost'; btn.textContent='ⓘ Context';
      const details=document.createElement('div'); details.style.display='none'; details.className='muted'; details.style.whiteSpace='pre-wrap';
      bind(btn,'click',()=>{ details.style.display = details.style.display==='none' ? 'block':'none'; });
      const lines=[];
      lines.push(`Style profile included: ${meta.included.profile?'Yes':'No'}`);
      if(meta.included.uploads?.length) lines.push(`Uploads (this message): ${meta.included.uploads.join(', ')}`);
      if(meta.included.chatFiles?.length) lines.push(`Chat files: ${meta.included.chatFiles.join(', ')}`);
      if(meta.included.pinned?.length) lines.push(`Pinned (global): ${meta.included.pinned.join(', ')}`);
      lines.push(`Estimated input: ~${meta.est.inputTokens} tok • ${curSymbol()}${fmtMoney(toLocal(meta.est.inputUSD))}`);
      details.textContent = lines.join('\n'); metaWrap.appendChild(btn); metaWrap.appendChild(details); msg.appendChild(metaWrap);
    }
    chatEl.appendChild(msg); chatEl.scrollTop = chatEl.scrollHeight;
    if (!skipMd) highlightBubble(bubble);
    return msg;
  }

  function highlightBubble(bubble){ setTimeout(()=>{ try { Prism && Prism.highlightAllUnder && Prism.highlightAllUnder(bubble); } catch(e){ /* no prism */ } }, 0); }
  function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ---- NEW: streaming-safe Markdown renderer (preserves code fences & newlines) ----
  function renderMarkdown(md) {
    if (!md) return '';

    const L = md.replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let inFence = false;
    let fenceLang = '';
    let fenceBuf = [];
    let paraBuf = [];

    const escape = (s) =>
      (s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    const flushPara = () => {
      if (!paraBuf.length) return;
      const raw = paraBuf.join('\n');

      // inline inside paragraphs
      let p = raw
        .replace(/`([^`]+)`/g, (_, c) => `<code>${escape(c)}</code>`)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>');

      // headings
      p = p.replace(/^### (.+)$/gm, '<h3>$1</h3>')
           .replace(/^## (.+)$/gm, '<h2>$1</h2>')
           .replace(/^# (.+)$/gm, '<h1>$1</h1>');

      // simple bullets
      if (/^\s*-\s+/.test(p)) {
        const items = p.split('\n').filter(Boolean)
          .map(line => line.replace(/^\s*-\s+/, ''))
          .map(li => `<li>${li}</li>`).join('');
        html.push(`<ul>${items}</ul>`);
      } else {
        html.push(`<p>${p.replace(/\n/g, '<br>')}</p>`);
      }
      paraBuf = [];
    };

    for (let i = 0; i < L.length; i++) {
      const line = L[i];

      // code fence open/close
      const m = line.match(/^```(\w+)?\s*$/);
      if (m) {
        if (inFence) {
          const code = fenceBuf.join('\n');
          const lang = (fenceLang || '').toLowerCase();
          html.push(`<pre><code class="language-${lang}">${escape(code)}</code></pre>`);
          inFence = false; fenceLang = ''; fenceBuf = [];
        } else {
          flushPara();
          inFence = true; fenceLang = m[1] || ''; fenceBuf = [];
        }
        continue;
      }

      if (inFence) {
        fenceBuf.push(line);
        continue;
      }

      if (line.trim() === '') {
        flushPara();
      } else {
        paraBuf.push(line);
      }
    }

    // end
    if (inFence) {
      // render incomplete fence as code (useful during streaming)
      const code = fenceBuf.join('\n');
      html.push(`<pre><code class="language-${(fenceLang || '').toLowerCase()}">${escape(code)}</code></pre>`);
    } else {
      flushPara();
    }

    return html.join('\n');
  }

  // ---- Delete all chats ----
  bind(deleteAllBtn, 'click', () => {
    if (!confirm('Delete ALL chats locally?')) return;
    const all = JSON.parse(localStorage.getItem('history') || '[]');
    for (const c of all) localStorage.removeItem(`conv:${c.id}`);
    localStorage.removeItem('history');
    newChat();
  });

  console.log('[App] UI ready.');
});

