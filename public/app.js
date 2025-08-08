window.addEventListener('DOMContentLoaded', () => {
  // --- State ---
  let API_ENDPOINT = localStorage.getItem('endpoint') || '/api/process';
  let STYLE_PROFILE = localStorage.getItem('styleProfile') || '';
  let DARK = localStorage.getItem('dark') === '1';
  let BUDGET_CAP = parseFloat(localStorage.getItem('budgetCap') || '0') || 0;
  let SPEND_EST = parseFloat(localStorage.getItem('spendEst') || '0') || 0;

  const chatEl = document.getElementById('chat');
  const fileInput = document.getElementById('fileInput');
  const chooseFiles = document.getElementById('chooseFiles');
  const filePills = document.getElementById('filePills');
  const promptEl = document.getElementById('prompt');
  const sendBtn = document.getElementById('sendBtn');
  const historyEl = document.getElementById('history');
  const newChatBtn = document.getElementById('newChatBtn');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const endpointSel = document.getElementById('endpoint');
  const styleProfileEl = document.getElementById('styleProfile');
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

  let attachedFiles = [];  // File[]
  let conversation = { id: Date.now().toString(), title: "New chat", messages: [] };
  let pinnedIds = JSON.parse(localStorage.getItem('pinnedIds') || '[]');

  // --- Theme ---
  applyTheme();
  function applyTheme(){ document.documentElement.classList.toggle('dark', DARK); }
  if (darkToggle) {
    darkToggle.onclick = () => { DARK = !DARK; localStorage.setItem('dark', DARK ? '1':'0'); applyTheme(); };
  }

  // --- History (persist full conversations in localStorage) ---
  renderHistory();

  function deriveTitle(conv) {
    for (const m of conv.messages) {
      if (m.role === 'user' && m.content && m.content.trim()) {
        return m.content.trim().slice(0, 40);
      }
    }
    for (const m of conv.messages) {
      if (m.content && m.content.trim()) {
        return m.content.trim().slice(0, 40);
      }
    }
    return "New chat";
  }

  function saveConversation() {
    conversation.title = deriveTitle(conversation);
    localStorage.setItem(`conv:${conversation.id}`, JSON.stringify(conversation));

    const all = JSON.parse(localStorage.getItem('history') || '[]')
      .filter(c => c.id !== conversation.id);
    all.unshift({ id: conversation.id, title: conversation.title, updatedAt: Date.now() });
    localStorage.setItem('history', JSON.stringify(all));

    renderHistory();
  }

  function renderHistory(){
    if (!historyEl) return;
    const all = JSON.parse(localStorage.getItem('history') || '[]');
    historyEl.innerHTML = '';
    for(const c of all){
      const row = document.createElement('div');
      row.className = 'item';

      const title = document.createElement('div');
      title.className = 'title';
      title.textContent = c.title || 'New chat';
      title.title = new Date(c.updatedAt || Date.now()).toLocaleString();
      title.ondblclick = () => {
        const newTitle = prompt('Rename chat:', title.textContent);
        if (newTitle) {
          const convRaw = localStorage.getItem(`conv:${c.id}`);
          if (convRaw) {
            const conv = JSON.parse(convRaw);
            conv.title = newTitle;
            localStorage.setItem(`conv:${c.id}`, JSON.stringify(conv));
            c.title = newTitle;
            localStorage.setItem('history', JSON.stringify(all));
            renderHistory();
          }
        }
      };
      title.onclick = () => loadConversation(c.id);

      const actions = document.createElement('div');
      actions.className = 'actions';

      const del = document.createElement('button');
      del.className = 'btn danger';
      del.textContent = 'Delete';
      del.onclick = (e) => {
        e.stopPropagation();
        if (!confirm('Delete this chat?')) return;
        deleteConversation(c.id);
      };

      actions.appendChild(del);
      row.appendChild(title);
      row.appendChild(actions);
      historyEl.appendChild(row);
    }
  }

  function deleteConversation(id) {
    localStorage.removeItem(`conv:${id}`);
    const all = JSON.parse(localStorage.getItem('history') || '[]').filter(c => c.id !== id);
    localStorage.setItem('history', JSON.stringify(all));
    if (conversation.id === id) {
      newChat();
    } else {
      renderHistory();
    }
  }

  if (deleteAllBtn) {
    deleteAllBtn.onclick = () => {
      if (!confirm('Delete ALL chats?')) return;
      const all = JSON.parse(localStorage.getItem('history') || '[]');
      for (const c of all) localStorage.removeItem(`conv:${c.id}`);
      localStorage.removeItem('history');
      newChat();
    };
  }

  function loadConversation(id){
    const raw = localStorage.getItem(`conv:${id}`);
    if (raw) {
      conversation = JSON.parse(raw);
    } else {
      conversation = { id, title: "Restored chat", messages: [] };
    }
    renderConversation();
  }

  function renderConversation() {
    if (!chatEl) return;
    chatEl.innerHTML = '';
    for (const m of conversation.messages) {
      addMessage(m.role, m.content);
    }
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function newChat() {
    if (conversation.messages?.length) saveConversation();
    conversation = { id: Date.now().toString(), title: "New chat", messages: [] };
    if (chatEl) chatEl.innerHTML = '';
    attachedFiles = [];
    renderPills();
    if (promptEl) { promptEl.value = ''; promptEl.focus(); }
    renderHistory();
  }
  if (newChatBtn) newChatBtn.onclick = newChat;

  // --- Settings ---
  if (endpointSel) endpointSel.value = API_ENDPOINT;
  if (styleProfileEl) styleProfileEl.value = STYLE_PROFILE;
  const budgetInput = document.getElementById('budgetCap');
  if (budgetInput) budgetInput.value = BUDGET_CAP ? String(BUDGET_CAP) : '';
  if (settingsBtn) {
    settingsBtn.onclick = () => {
      if (endpointSel) endpointSel.value = API_ENDPOINT;
      if (styleProfileEl) styleProfileEl.value = STYLE_PROFILE;
      if (budgetInput) budgetInput.value = BUDGET_CAP ? String(BUDGET_CAP) : '';
      settingsModal?.showModal();
    };
  }
  const closeSettings = document.getElementById('closeSettings');
  if (closeSettings) closeSettings.onclick = () => settingsModal?.close();
  const saveSettings = document.getElementById('saveSettings');
  if (saveSettings) {
    saveSettings.onclick = () => {
      if (endpointSel) API_ENDPOINT = endpointSel.value;
      if (styleProfileEl) STYLE_PROFILE = styleProfileEl.value;
      if (budgetInput) BUDGET_CAP = parseFloat(budgetInput.value || '0') || 0;
      localStorage.setItem('endpoint', API_ENDPOINT);
      localStorage.setItem('styleProfile', STYLE_PROFILE);
      localStorage.setItem('budgetCap', String(BUDGET_CAP));
      if (modelName) modelName.textContent = API_ENDPOINT === '/ask-ai' ? 'GPT (real)' : 'Local (mock)';
      settingsModal?.close();
    };
  }

  // --- Library modal ---
  if (libraryBtn) {
    libraryBtn.onclick = async () => {
      await refreshLibrary();
      libraryModal?.showModal();
    };
  }
  if (closeLibrary) closeLibrary.onclick = () => libraryModal?.close();

  if (libUploadBtn) {
    libUploadBtn.onclick = async (e) => {
      e.preventDefault();
      if (!libFiles?.files?.length) return alert('Choose files first.');
      const fd = new FormData();
      for (const f of libFiles.files) fd.append('files', f);
      if (libCollection?.value) fd.append('collection', libCollection.value);
      const res = await fetch('/api/library/upload', { method: 'POST', body: fd });
      if (!res.ok) return alert('Upload failed.');
      if (libFiles) libFiles.value = '';
      if (libCollection) libCollection.value = '';
      await refreshLibrary();
    };
  }

  async function refreshLibrary() {
    const res = await fetch('/api/library');
    const list = await res.json();
    if (!libList) return;
    libList.innerHTML = '';
    list.forEach(item => {
      const row = document.createElement('div');
      row.className = 'lib-item';

      const info = document.createElement('div');
      info.className = 'lib-info';
      info.innerHTML = `<strong>${item.filename}</strong>
        <span class="muted">${Math.round(item.size/1024)} KB • ${item.collection || 'default'}</span>`;

      const actions = document.createElement('div');
      actions.className = 'lib-actions-row';

      const pin = document.createElement('button');
      pin.className = 'btn';
      pin.textContent = item.pinned ? 'Unpin' : 'Pin';
      pin.onclick = async () => {
        const r = await fetch('/api/library/pin', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: item.id, pinned: !item.pinned })
        });
        if (r.ok) { await refreshLibrary(); }
      };

      const del = document.createElement('button');
      del.className = 'btn danger';
      del.textContent = 'Delete';
      del.onclick = async () => {
        if (!confirm(`Delete ${item.filename}?`)) return;
        const r = await fetch(`/api/library/${item.id}`, { method: 'DELETE' });
        if (r.ok) { await refreshLibrary(); }
      };

      const manualPin = document.createElement('input');
      manualPin.type = 'checkbox';
      manualPin.title = 'Include in this message';
      manualPin.checked = pinnedIds.includes(item.id);
      manualPin.onchange = () => {
        if (manualPin.checked) {
          if (!pinnedIds.includes(item.id)) pinnedIds.push(item.id);
        } else {
          pinnedIds = pinnedIds.filter(x => x !== item.id);
        }
        localStorage.setItem('pinnedIds', JSON.stringify(pinnedIds));
      };

      actions.appendChild(manualPin);
      actions.appendChild(pin);
      actions.appendChild(del);

      row.appendChild(info);
      row.appendChild(actions);
      libList.appendChild(row);
    });
  }

  // --- File handling for message ---
  if (chooseFiles) chooseFiles.onclick = () => fileInput?.click();
  if (fileInput) {
    fileInput.onchange = () => { for(const f of fileInput.files) attachedFiles.push(f); fileInput.value = ''; renderPills(); };
  }
  document.addEventListener('dragover', e => { e.preventDefault(); });
  document.addEventListener('drop', e => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) {
      for (const f of e.dataTransfer.files) attachedFiles.push(f);
      renderPills();
    }
  });
  function renderPills(){
    if (!filePills) return;
    filePills.innerHTML = '';
    attachedFiles.forEach((f, i) => {
      const pill = document.createElement('span');
      pill.className = 'pill';
      pill.innerHTML = `${f.name} <span class="x" data-i="${i}">×</span>`;
      filePills.appendChild(pill);
    });
    filePills.querySelectorAll('.x').forEach(x => x.onclick = (e)=>{
      const i = Number(e.target.dataset.i);
      attachedFiles.splice(i,1);
      renderPills();
    });
  }

  // --- Composer behavior ---
  if (promptEl) {
    promptEl.addEventListener('input', () => {
      promptEl.style.height = 'auto';
      promptEl.style.height = Math.min(promptEl.scrollHeight, 220) + 'px';
    });
    promptEl.addEventListener('keydown', (e)=>{
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
  }
  if (sendBtn) sendBtn.onclick = send;

  // --- Cost estimate helper ---
  async function estimateCost(fd) {
    try {
      const res = await fetch('/api/estimate', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error();
      if (costBadge) costBadge.textContent = `~${data.tokens} tok • $${data.inputCostUSD.toFixed(4)}`;
      return data.inputCostUSD;
    } catch {
      if (costBadge) costBadge.textContent = `~? tok • $0.0000`;
      return 0;
    }
  }

  // --- Send flow ---
  async function send(){
    const text = (promptEl?.value || '').trim();
    if (!text && attachedFiles.length === 0) return;

    addMessage('user', text || '(no text)');
    conversation.messages.push({ role:'user', content:text });
    saveConversation();

    const fd = new FormData();
    fd.append('prompt', text);
    if (STYLE_PROFILE) fd.append('styleProfile', STYLE_PROFILE);
    if (pinnedIds.length) fd.append('pinned', JSON.stringify(pinnedIds));
    for(const f of attachedFiles) fd.append('files', f);

    // estimate cost
    const fdCopy = new FormData();
    fd.forEach((v,k)=>fdCopy.append(k,v));
    const est = await estimateCost(fdCopy);
    if (BUDGET_CAP && (SPEND_EST + est) > BUDGET_CAP) {
      const proceed = confirm(`Estimated $${(SPEND_EST+est).toFixed(4)} exceeds your cap ($${BUDGET_CAP.toFixed(2)}). Proceed?`);
      if (!proceed) return;
    }

    if (sendBtn) sendBtn.disabled = true;
    if (promptEl) promptEl.disabled = true;
    const placeholder = addMessage('assistant', 'Thinking…');
    typeSim(placeholder.querySelector('.bubble'), 'Thinking…');

    try{
      const res = await fetch(API_ENDPOINT, { method:'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `${res.status} ${res.statusText}`);

      const content = data.aiResponse || data.response || JSON.stringify(data, null, 2);

      placeholder.querySelector('.bubble').textContent = content;
      conversation.messages.push({ role:'assistant', content });
      saveConversation();

      SPEND_EST += est;
      localStorage.setItem('spendEst', String(SPEND_EST));
    } catch(err){
      placeholder.querySelector('.bubble').textContent = '⚠️ Error: '+ (err.message || err);
    } finally {
      if (promptEl) { promptEl.value=''; promptEl.disabled=false; promptEl.style.height='auto'; }
      if (sendBtn) sendBtn.disabled=false;
      attachedFiles = []; renderPills();
      if (chatEl) chatEl.scrollTop = chatEl.scrollHeight;
    }
  }

  // --- Helpers ---
  function addMessage(role, text){
    if (!chatEl) return document.createElement('div');
    const msg = document.createElement('div');
    msg.className = 'msg '+role;
    const avatar = document.createElement('div');
    avatar.className = 'avatar';
    avatar.textContent = role==='user' ? 'U' : 'AI';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    bubble.textContent = text;
    msg.appendChild(avatar); msg.appendChild(bubble);
    chatEl.appendChild(msg);
    chatEl.scrollTop = chatEl.scrollHeight;
    return msg;
  }
  function typeSim(el, text){
    el.textContent = '';
    let i=0; const id = setInterval(()=>{
      el.textContent += text[i++] || '';
      if(i>text.length) clearInterval(id);
    }, 15);
  }

  // --- Model label + initial cost badge ---
  if (modelName) modelName.textContent = API_ENDPOINT === '/ask-ai' ? 'GPT (real)' : 'Local (mock)';
  if (costBadge) costBadge.textContent = `~0 tok • $0.0000`;
});

