window.addEventListener('DOMContentLoaded', () => {
  // ---- State ----
  let API_ENDPOINT = localStorage.getItem('endpoint') || '/api/process';
  let STYLE_PROFILE = localStorage.getItem('styleProfile') || '';
  let DARK = localStorage.getItem('dark') === '1';

  // Currency defaults
  let CURRENCY = localStorage.getItem('currency') || 'CAD';
  let FX_RATE = parseFloat(localStorage.getItem('fxRate') || '1.35') || 1.0;
  let BUDGET_CAP = parseFloat(localStorage.getItem('budgetCap') || '0') || 0;

  let SPEND_USD_GLOBAL = parseFloat(localStorage.getItem('spendAllUsd') || '0') || 0;
  let TOKENS_GLOBAL = parseInt(localStorage.getItem('tokensAll') || '0', 10) || 0;

  // DOM
  const chatEl = document.getElementById('chat');
  const fileInput = document.getElementById('fileInput');
  const chooseFiles = document.getElementById('chooseFiles');
  const filePills = document.getElementById('filePills');
  const promptEl = document.getElementById('prompt');
  const sendBtn = document.getElementById('sendBtn');
  const stopBtn = document.getElementById('stopBtn');
  const historyEl = document.getElementById('history');
  const newChatBtn = document.getElementById('newChatBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const endpointSel = document.getElementById('endpoint');
  const styleProfileEl = document.getElementById('styleProfile');
  const currencySel = document.getElementById('currency');
  const fxRateEl = document.getElementById('fxRate');
  const budgetInput = document.getElementById('budgetCap');
  const darkToggle = document.getElementById('darkToggle');
  const modelName = document.getElementById('modelName');
  const libraryBtn = document.getElementById('libraryBtn');
  const libraryModal = document.getElementById('libraryModal');
  const libFiles = document.getElementById('libFiles');
  const libCollection = document.getElementById('libCollection');
  const libUploadBtn = document.getElementById('libUploadBtn');
  const libList = document.getElementById('libList');
  const closeLibrary = document.getElementById('closeLibrary');
  const deleteAllBtn = document.getElementById('deleteAllBtn');
  const costBadge = document.getElementById('costBadge');
  const chatBadge = document.getElementById('chatBadge');
  const totalBadge = document.getElementById('totalBadge');
  const chatFilesBtn = document.getElementById('chatFilesBtn');
  const chatFilesModal = document.getElementById('chatFilesModal');
  const chatFilesList = document.getElementById('chatFilesList');
  const closeChatFiles = document.getElementById('closeChatFiles');

  // Local state
  let attachedFiles = [];
  let conversation = loadOrNewConversation();
  let pinnedIds = JSON.parse(localStorage.getItem('pinnedIds') || '[]');
  let currentAbort = null;
  let libMap = {};
  let chatFilesCache = [];

  const curSymbol = () => (CURRENCY === 'CAD' ? 'C$' : 'US$');
  const toLocal = (usd) => (CURRENCY === 'CAD' ? usd * FX_RATE : usd);
  const fmtMoney = (n) => (n || 0).toFixed(4);

  // ---- Theme ----
  applyTheme();
  function applyTheme(){ document.documentElement.classList.toggle('dark', DARK); }
  darkToggle.onclick = () => { DARK = !DARK; localStorage.setItem('dark', DARK ? '1':'0'); applyTheme(); };

  // Init
  refreshLibraryMap();
  refreshChatFiles();
  renderHistory();
  renderConversation();
  updateSpendBadges();

  // ---- Conversation helpers ----
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
  function deriveTitle(conv) {
    // Prefer first non-empty user message; otherwise first file; otherwise timestamp.
    const m = conv.messages?.find(mm => mm.role === 'user' && (mm.content || '').trim());
    if (m) return (m.content || '').trim().slice(0, 60);
    const firstFile = window._firstFilesForTitle;
    if (firstFile?.length) return firstFile[0].name.slice(0, 60);
    return new Date().toLocaleString();
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
  function renderHistory(){
    const all = JSON.parse(localStorage.getItem('history') || '[]');
    historyEl.innerHTML = '';
    for (const c of all) {
      const row = document.createElement('div'); row.className='item';
      const title = document.createElement('div'); title.className='title'; title.textContent=c.title||'New chat';
      title.onclick = () => loadConversation(c.id);
      const actions = document.createElement('div'); actions.className='actions';
      const del = document.createElement('button'); del.className='btn danger'; del.textContent='Delete';
      del.onclick = (e)=>{ e.stopPropagation(); if (confirm('Delete this chat?')) deleteConversation(c.id); };
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
    renderConversation(); refreshChatFiles(); updateSpendBadges();
  }
  function renderConversation(){
    chatEl.innerHTML=''; for (const m of conversation.messages) addMessage(m.role, m.content, m.meta, true);
    chatEl.scrollTop = chatEl.scrollHeight;
  }
  function newChat(){
    if (conversation.messages?.length) saveConversation();
    conversation = { id: Date.now().toString(), title: "New chat", messages: [], totals: { inputUSD: 0, inputTokens: 0 } };
    localStorage.setItem('activeConvId', conversation.id);
    chatEl.innerHTML=''; attachedFiles=[]; renderPills(); promptEl.value=''; promptEl.focus();
    refreshChatFiles(); renderHistory(); updateSpendBadges();
  }
  newChatBtn.onclick = newChat;

  // ---- Settings ----
  endpointSel.value = API_ENDPOINT; styleProfileEl.value = STYLE_PROFILE;
  currencySel.value = CURRENCY; fxRateEl.value = String(FX_RATE); budgetInput.value = BUDGET_CAP ? String(BUDGET_CAP) : '';
  settingsBtn.onclick = () => { endpointSel.value=API_ENDPOINT; styleProfileEl.value=STYLE_PROFILE; currencySel.value=CURRENCY; fxRateEl.value=String(FX_RATE); budgetInput.value=BUDGET_CAP?String(BUDGET_CAP):''; settingsModal.showModal(); };
  document.getElementById('closeSettings').onclick = () => settingsModal.close();
  document.getElementById('saveSettings').onclick = () => {
    API_ENDPOINT = endpointSel.value; STYLE_PROFILE = styleProfileEl.value;
    CURRENCY = currencySel.value; FX_RATE = parseFloat(fxRateEl.value||'1')||1.0; BUDGET_CAP = parseFloat(budgetInput.value||'0')||0;
    localStorage.setItem('endpoint',API_ENDPOINT); localStorage.setItem('styleProfile',STYLE_PROFILE);
    localStorage.setItem('currency',CURRENCY); localStorage.setItem('fxRate',String(FX_RATE)); localStorage.setItem('budgetCap',String(BUDGET_CAP));
    modelName.textContent = API_ENDPOINT === '/ask-ai' ? 'GPT (real, streaming)' : 'Local (mock)';
    updateSpendBadges(); settingsModal.close();
  };

  // ---- Library / Chat files (unchanged UI logic) ----
  libraryBtn.onclick = async()=>{ await refreshLibrary(); libraryModal.showModal(); };
  closeLibrary.onclick = ()=>libraryModal.close();
  libUploadBtn.onclick = async (e)=>{ e.preventDefault(); if(!libFiles.files.length) return alert('Choose files first.');
    const fd = new FormData(); for (const f of libFiles.files) fd.append('files', f);
    if (libCollection.value) fd.append('collection', libCollection.value);
    const r = await fetch('/api/library/upload',{method:'POST',body:fd}); if(!r.ok) return alert('Upload failed.');
    libFiles.value=''; libCollection.value=''; await refreshLibrary(); refreshLibraryMap();
  };
  async function refreshLibrary(){ const r=await fetch('/api/library'); const list=await r.json(); libList.innerHTML='';
    list.forEach(item=>{
      const row=document.createElement('div'); row.className='lib-item';
      row.innerHTML = `<div class="lib-info"><strong>${item.filename}</strong><span class="muted">${Math.round(item.size/1024)} KB • ${item.collection||'default'}</span></div>`;
      const actions=document.createElement('div'); actions.className='lib-actions-row';
      const manual=document.createElement('input'); manual.type='checkbox'; manual.title='Include this turn'; manual.checked = pinnedIds.includes(item.id);
      manual.onchange=()=>{ if(manual.checked){ if(!pinnedIds.includes(item.id)) pinnedIds.push(item.id);} else pinnedIds=pinnedIds.filter(x=>x!==item.id); localStorage.setItem('pinnedIds',JSON.stringify(pinnedIds)); };
      const pin=document.createElement('button'); pin.className='btn'; pin.textContent=item.pinned?'Unpin':'Pin';
      pin.onclick=async()=>{ await fetch('/api/library/pin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:item.id,pinned:!item.pinned})}); await refreshLibrary(); refreshLibraryMap(); };
      const del=document.createElement('button'); del.className='btn danger'; del.textContent='Delete';
      del.onclick=async()=>{ if(!confirm(`Delete ${item.filename}?`)) return; await fetch(`/api/library/${item.id}`,{method:'DELETE'}); await refreshLibrary(); refreshLibraryMap(); };
      actions.appendChild(manual); actions.appendChild(pin); actions.appendChild(del); row.appendChild(actions); libList.appendChild(row);
    });}
  async function refreshLibraryMap(){ try{ const r=await fetch('/api/library'); const list=await r.json(); libMap={}; list.forEach(it=>libMap[it.id]=it.filename);}catch{} }

  chatFilesBtn.onclick = async()=>{ await refreshChatFiles(); chatFilesModal.showModal(); };
  closeChatFiles.onclick = ()=>chatFilesModal.close();
  async function refreshChatFiles(){
    try{ const r=await fetch(`/api/chat/files?chatId=${encodeURIComponent(conversation.id)}`); chatFilesCache=await r.json();
      chatFilesList.innerHTML=''; chatFilesCache.forEach(item=>{
        const row=document.createElement('div'); row.className='lib-item';
        row.innerHTML=`<div class="lib-info"><strong>${item.name}</strong><span class="muted">${Math.round(item.size/1024)} KB • saved</span></div>`;
        const actions=document.createElement('div'); actions.className='lib-actions-row';
        const del=document.createElement('button'); del.className='btn danger'; del.textContent='Delete';
        del.onclick=async()=>{ if(!confirm(`Remove ${item.name}?`)) return; await fetch(`/api/chat/files/${encodeURIComponent(item.name)}?chatId=${encodeURIComponent(conversation.id)}`,{method:'DELETE'}); await refreshChatFiles(); };
        actions.appendChild(del); row.appendChild(actions); chatFilesList.appendChild(row);
      });
    }catch{}
  }

  // ---- Attach files for this message (also used for title fallback) ----
  chooseFiles.onclick = () => fileInput.click();
  fileInput.onchange = () => {
    const arr = Array.from(fileInput.files || []);
    if (arr.length && !conversation.messages?.length) {
      // remember first files so deriveTitle() can use them
      window._firstFilesForTitle = arr;
    }
    for (const f of arr) attachedFiles.push(f);
    fileInput.value=''; renderPills();
  };
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) {
      const arr = Array.from(e.dataTransfer.files);
      if (arr.length && !conversation.messages?.length) window._firstFilesForTitle = arr;
      for (const f of arr) attachedFiles.push(f);
      renderPills();
    }
  });
  function renderPills(){
    filePills.innerHTML=''; attachedFiles.forEach((f,i)=>{ const pill=document.createElement('span'); pill.className='pill'; pill.innerHTML=`${f.name} <span class="x" data-i="${i}">×</span>`; filePills.appendChild(pill); });
    filePills.querySelectorAll('.x').forEach(x=>x.onclick=(e)=>{ const i=Number(e.target.dataset.i); attachedFiles.splice(i,1); renderPills(); });
  }

  // ---- Composer ----
  promptEl.addEventListener('input', ()=>{ promptEl.style.height='auto'; promptEl.style.height=Math.min(promptEl.scrollHeight,220)+'px'; });
  promptEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); }});
  sendBtn.onclick = send; stopBtn.onclick = ()=>{ if(currentAbort && !currentAbort.signal.aborted) currentAbort.abort(); };

  // ---- Estimate ----
  async function estimateCost(fd){
    try{ const r=await fetch('/api/estimate',{method:'POST',body:fd}); const d=await r.json(); const usd=+d.inputCostUSD||0; const tokens=+d.tokens||0;
      costBadge.textContent = `Est: ${curSymbol()}${fmtMoney(toLocal(usd))} • ~${tokens} tok`; return {usd,tokens};
    }catch{ costBadge.textContent = `Est: ${curSymbol()}0.0000 • ~0 tok`; return {usd:0,tokens:0}; }
  }

  // ---- Totals ----
  function updateConversationTotals(addUsd, addTokens){ conversation.totals=conversation.totals||{inputUSD:0,inputTokens:0}; conversation.totals.inputUSD+=(addUsd||0); conversation.totals.inputTokens+=(addTokens||0); saveConversation(); }
  function updateGlobalTotalsFromStorage(){ const all=JSON.parse(localStorage.getItem('history')||'[]'); let usd=0,tok=0; for(const c of all){ const raw=localStorage.getItem(`conv:${c.id}`); if(!raw) continue; const conv=JSON.parse(raw); if(conv?.totals){ usd+=+conv.totals.inputUSD||0; tok+=+conv.totals.inputTokens||0; } } SPEND_USD_GLOBAL=usd; TOKENS_GLOBAL=tok; localStorage.setItem('spendAllUsd',String(usd)); localStorage.setItem('tokensAll',String(tok)); }
  function updateSpendBadges(){ updateGlobalTotalsFromStorage(); const cu=+(conversation?.totals?.inputUSD||0), ct=+(conversation?.totals?.inputTokens||0); chatBadge.textContent=`Chat: ${curSymbol()}${fmtMoney(toLocal(cu))} • ${ct} tok`; totalBadge.textContent=`All: ${curSymbol()}${fmtMoney(toLocal(SPEND_USD_GLOBAL))} • ${TOKENS_GLOBAL} tok`; modelName.textContent = API_ENDPOINT === '/ask-ai' ? 'GPT (real, streaming)' : 'Local (mock)'; }

  // ---- Send ----
  async function send(){
    const text = (promptEl.value||'').trim();
    if (!text && attachedFiles.length===0) return;

    const uploadNames = attachedFiles.map(f=>f.name);
    const pinnedNames = (JSON.parse(localStorage.getItem('pinnedIds')||'[]')).map(id=>libMap[id]).filter(Boolean);
    const hasProfile = !!(STYLE_PROFILE && STYLE_PROFILE.trim());
    const chatFileNames = chatFilesCache.map(f=>f.name);

    addMessage('user', text || '(no text)');
    conversation.messages.push({ role:'user', content:text });
    // -> ensure title sticks immediately
    if (!conversation.title || conversation.title === 'New chat') {
      conversation.title = text ? text.slice(0,60) : (attachedFiles[0]?.name || new Date().toLocaleString());
    }
    saveConversation();

    const fd = new FormData();
    fd.append('prompt', text);
    fd.append('chatId', conversation.id);
    if (STYLE_PROFILE) fd.append('styleProfile', STYLE_PROFILE);
    const ids = JSON.parse(localStorage.getItem('pinnedIds')||'[]'); if (ids.length) fd.append('pinned', JSON.stringify(ids));
    for (const f of attachedFiles) fd.append('files', f);

    const { usd:estUsd, tokens:estTok } = await estimateCost(copyFD(fd));
    const chatLocal = toLocal(+conversation?.totals?.inputUSD||0), newLocal=toLocal(estUsd);
    if (BUDGET_CAP && (chatLocal + newLocal) > BUDGET_CAP){ if(!confirm(`This message is estimated ${curSymbol()}${fmtMoney(newLocal)}.\nCurrent chat: ${curSymbol()}${fmtMoney(chatLocal)}\nCap: ${curSymbol()}${fmtMoney(BUDGET_CAP)}\n\nProceed?`)) return; }

    const meta = { included:{ profile:hasProfile, uploads:uploadNames, chatFiles:chatFileNames, pinned:pinnedNames }, est:{ inputTokens:estTok, inputUSD:estUsd } };
    if (API_ENDPOINT === '/ask-ai') await streamAskAI(fd, meta); else await postMock(fd, meta);
  }

  async function postMock(fd, meta){
    toggleSending(true);
    const msg = addMessage('assistant','',meta); const bubble = msg.querySelector('.bubble');
    try{
      const r=await fetch('/api/process',{method:'POST',body:fd}); const d=await r.json(); const content=d.aiResponse||d.response||'';
      bubble.innerHTML = renderMarkdown(content);
      conversation.messages.push({ role:'assistant', content, meta });
      updateConversationTotals(meta.est.inputUSD, meta.est.inputTokens); updateSpendBadges(); saveConversation(); await refreshChatFiles();
    }catch(e){ bubble.textContent='⚠️ '+(e.message||e); }
    finally{ resetComposer(); toggleSending(false); }
  }

  // streaming with fallback (unchanged)
  async function streamAskAI(fd, meta){
    toggleSending(true);
    const msg = addMessage('assistant','',meta); const bubble = msg.querySelector('.bubble');
    bubble.innerHTML=''; let full=''; let gotAny=false;

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
              full = fallback; bubble.innerHTML = renderMarkdown(fallback);
            }
            conversation.messages.push({ role:'assistant', content: full, meta });
            updateConversationTotals(meta.est.inputUSD, meta.est.inputTokens); updateSpendBadges(); saveConversation(); await refreshChatFiles();
            toggleSending(false); resetComposer(); currentAbort=null; return;
          }

          try{
            const obj = JSON.parse(data);
            if (obj?.delta){
              gotAny = true;
              full += obj.delta;
              bubble.innerHTML = renderMarkdown(full);
              chatEl.scrollTop = chatEl.scrollHeight;
            } else if (obj?.error){
              bubble.textContent = `⚠️ ${obj.error}`;
            }
          }catch{}
        }
      }

      if (!gotAny || !full.trim()) {
        try {
          const r2 = await fetch('/ask-ai', { method:'POST', body: copyFD(fd) });
          const j2 = await r2.json(); const fallback = j2.aiResponse || j2.response || '';
          full = fallback; bubble.innerHTML = renderMarkdown(fallback);
        } catch (e) { bubble.textContent = '⚠️ Stream ended with no content and fallback failed.'; }
      }

      conversation.messages.push({ role:'assistant', content: full, meta });
      updateConversationTotals(meta.est.inputUSD, meta.est.inputTokens); updateSpendBadges(); saveConversation(); await refreshChatFiles();
    } catch (e) {
      if (e.name==='AbortError'||/aborted/i.test(e.message||'')){ bubble.textContent += bubble.textContent.endsWith('[stopped]')?'':'\n\n[stopped]'; }
      else {
        try { const r2 = await fetch('/ask-ai', { method:'POST', body: copyFD(fd) });
          const j2 = await r2.json(); const fallback = j2.aiResponse || j2.response || '';
          bubble.innerHTML = renderMarkdown(fallback);
          conversation.messages.push({ role:'assistant', content: fallback, meta });
          updateConversationTotals(meta.est.inputUSD, meta.est.inputTokens); updateSpendBadges(); saveConversation(); await refreshChatFiles();
        } catch { bubble.textContent='⚠️ '+(e.message||e); }
      }
    } finally { currentAbort=null; toggleSending(false); resetComposer(); }
  }

  function toggleSending(b){ sendBtn.style.display=b?'none':'inline-block'; stopBtn.style.display=b?'inline-block':'none'; promptEl.disabled=b; }
  function resetComposer(){ promptEl.value=''; promptEl.style.height='auto'; attachedFiles=[]; renderPills(); chatEl.scrollTop=chatEl.scrollHeight; }
  function copyFD(fd){ const f=new FormData(); fd.forEach((v,k)=>f.append(k,v)); return f; }

  // ---- Rendering ----
  function addMessage(role, text, meta, skipMd){
    const msg=document.createElement('div'); msg.className='msg '+role;
    const avatar=document.createElement('div'); avatar.className='avatar'; avatar.textContent=role==='user'?'U':'AI';
    const bubble=document.createElement('div'); bubble.className='bubble'; bubble.innerHTML = skipMd ? escapeHtml(text||'') : renderMarkdown(text||'');
    msg.appendChild(avatar); msg.appendChild(bubble);

    if(role==='assistant' && meta){
      const metaWrap=document.createElement('div'); metaWrap.className='meta-row';
      const btn=document.createElement('button'); btn.className='btn ghost'; btn.textContent='ⓘ Context';
      const details=document.createElement('div'); details.style.display='none'; details.className='muted'; details.style.whiteSpace='pre-wrap';
      btn.onclick=()=>{ details.style.display = details.style.display==='none' ? 'block':'none'; };
      const lines=[];
      lines.push(`Style profile included: ${meta.included.profile?'Yes':'No'}`);
      if(meta.included.uploads?.length) lines.push(`Uploads (this message): ${meta.included.uploads.join(', ')}`);
      if(meta.included.chatFiles?.length) lines.push(`Chat files: ${meta.included.chatFiles.join(', ')}`);
      if(meta.included.pinned?.length) lines.push(`Pinned (global): ${meta.included.pinned.join(', ')}`);
      lines.push(`Estimated input: ~${meta.est.inputTokens} tok • ${curSymbol()}${fmtMoney(toLocal(meta.est.inputUSD))}`);
      details.textContent = lines.join('\n'); metaWrap.appendChild(btn); metaWrap.appendChild(details); msg.appendChild(metaWrap);
    }
    chatEl.appendChild(msg); chatEl.scrollTop = chatEl.scrollHeight; return msg;
  }

  function escapeHtml(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function renderMarkdown(md){
    if(!md) return '';
    let out = md.replace(/\r\n/g,'\n');
    out = out.replace(/```(\w+)?\n([\s\S]*?)```/g,(m,lang,code)=>`<pre><code data-lang="${lang||''}">${escapeHtml(code)}</code></pre>`);
    out = out.replace(/`([^`]+)`/g,(m,c)=>`<code>${escapeHtml(c)}</code>`);
    out = out.replace(/^### (.+)$/gm,'<h3>$1</h3>'); out = out.replace(/^## (.+)$/gm,'<h2>$1</h2>'); out = out.replace(/^# (.+)$/gm,'<h1>$1</h1>');
    out = out.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>'); out = out.replace(/\*([^*]+)\*/g,'<em>$1</em>');
    out = out.replace(/^\s*-\s+(.+)$/gm,'<li>$1</li>'); out = out.replace(/(<li>.*<\/li>)(\n(?!<li>))/gs,'<ul>$1</ul>\n');
    out = out.split('\n\n').map(p=>/^<h\d|^<pre>|^<ul>|^<li>|^<blockquote>/.test(p)?p:`<p>${p.replace(/\n/g,'<br>')}</p>`).join('\n');
    return out;
  }

  // ---- init badges ----
  costBadge.textContent = `Est: ${curSymbol()}0.0000 • ~0 tok`;
  modelName.textContent = API_ENDPOINT === '/ask-ai' ? 'GPT (real, streaming)' : 'Local (mock)';
});

