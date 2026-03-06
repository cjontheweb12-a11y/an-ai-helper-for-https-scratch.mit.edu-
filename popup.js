// ─── State ───────────────────────────────────────────────────────────────────
let apiKey = '';
let selectedLevel = 'beginner';
let model = 'gpt-4o';
let style = 'detailed';
let history = [];

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupTabs();
  setupPills();
  setupCharCount();
  renderHistory();
  updateApiStatus();

  document.getElementById('apiKeyShortcut').addEventListener('click', e => {
    e.preventDefault();
    switchTab('settings');
    document.getElementById('apiKeyInput').focus();
  });
});

// ─── Load settings from chrome.storage ────────────────────────────────────────
async function loadSettings() {
  return new Promise(resolve => {
    chrome.storage.local.get(['apiKey', 'model', 'style', 'history'], res => {
      apiKey = res.apiKey || '';
      model = res.model || 'gpt-4o';
      style = res.style || 'detailed';
      history = res.history || [];

      document.getElementById('apiKeyInput').value = apiKey;
      document.getElementById('modelSelect').value = model;
      document.getElementById('styleSelect').value = style;
      resolve();
    });
  });
}

// ─── Save settings ────────────────────────────────────────────────────────────
document.getElementById('saveApiKey').addEventListener('click', () => {
  const key = document.getElementById('apiKeyInput').value.trim();
  if (!key.startsWith('sk-')) {
    showToast('⚠️ Key should start with sk-', true);
    return;
  }
  apiKey = key;
  chrome.storage.local.set({ apiKey: key }, () => {
    updateApiStatus();
    showToast('✅ API key saved!');
  });
});

document.getElementById('saveSettings').addEventListener('click', () => {
  model = document.getElementById('modelSelect').value;
  style = document.getElementById('styleSelect').value;
  chrome.storage.local.set({ model, style }, () => {
    showToast('✅ Settings saved!');
  });
});

// ─── Tab switching ────────────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${name}`));
  if (name === 'history') renderHistory();
}

// ─── Level pills ──────────────────────────────────────────────────────────────
function setupPills() {
  document.querySelectorAll('.pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      selectedLevel = pill.dataset.level;
    });
  });
}

// ─── Char count ───────────────────────────────────────────────────────────────
function setupCharCount() {
  const ta = document.getElementById('generatePrompt');
  const cc = document.getElementById('charCount');
  ta.addEventListener('input', () => {
    const len = ta.value.length;
    cc.textContent = len;
    if (len > 550) cc.style.color = '#ff6680';
    else cc.style.color = '';
    if (ta.value.length > 600) ta.value = ta.value.slice(0, 600);
  });
}

// ─── API Status ───────────────────────────────────────────────────────────────
function updateApiStatus() {
  const dot = document.getElementById('apiDot');
  const text = document.getElementById('apiStatusText');
  const link = document.getElementById('apiKeyShortcut');
  if (apiKey && apiKey.startsWith('sk-')) {
    dot.classList.add('connected');
    text.textContent = 'Connected · ' + model;
    link.textContent = 'Change →';
  } else {
    dot.classList.remove('connected');
    text.textContent = 'No API key set';
    link.textContent = 'Set key →';
  }
}

// ─── GENERATE ─────────────────────────────────────────────────────────────────
document.getElementById('generateBtn').addEventListener('click', async () => {
  const prompt = document.getElementById('generatePrompt').value.trim();
  if (!prompt) { showToast('⚠️ Enter a description first!', true); return; }
  if (!checkApiKey()) return;

  const projectType = document.getElementById('projectType').value;
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildGeneratePrompt(prompt, projectType, selectedLevel);

  setLoading('generate', true);
  try {
    const result = await callChatGPT(systemPrompt, userPrompt);
    showOutput('generate', result);
    saveToHistory(prompt, result, 'generate');
    showToast('✅ Code generated!');
  } catch (e) {
    showToast('❌ ' + e.message, true);
  } finally {
    setLoading('generate', false);
  }
});

// ─── FIX ──────────────────────────────────────────────────────────────────────
document.getElementById('fixBtn').addEventListener('click', async () => {
  const problem = document.getElementById('fixProblem').value.trim();
  if (!problem) { showToast('⚠️ Describe the problem first!', true); return; }
  if (!checkApiKey()) return;

  const code = document.getElementById('fixCode').value.trim();
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildFixPrompt(problem, code);

  setLoading('fix', true);
  try {
    const result = await callChatGPT(systemPrompt, userPrompt);
    showOutput('fix', result);
    saveToHistory(problem, result, 'fix');
    showToast('✅ Bug fixed!');
  } catch (e) {
    showToast('❌ ' + e.message, true);
  } finally {
    setLoading('fix', false);
  }
});

// ─── Copy buttons ─────────────────────────────────────────────────────────────
document.getElementById('copyGenerate').addEventListener('click', () => {
  copyText(document.getElementById('generateResult').innerText);
});
document.getElementById('copyFix').addEventListener('click', () => {
  copyText(document.getElementById('fixResult').innerText);
});

function copyText(text) {
  navigator.clipboard.writeText(text).then(() => showToast('📋 Copied!'));
}

// ─── Prompts ──────────────────────────────────────────────────────────────────
function buildSystemPrompt() {
  const styleGuide = {
    detailed: 'Provide step-by-step instructions with explanations of WHY each block is used. Format clearly.',
    concise: 'Be concise. List blocks in order with minimal explanation. Focus on the code.',
    educational: 'You are a friendly teacher for kids aged 8-14. Explain things simply, use encouraging language and emojis. Make it fun!'
  }[style] || '';

  return `You are ScratchAI, an expert at the Scratch programming language (scratch.mit.edu). You help users build Scratch projects using Scratch's block-based programming system.

IMPORTANT RULES:
- Scratch uses visual blocks, NOT text code. Always describe blocks like: "when green flag clicked", "move (10) steps", "if <touching color [red]?> then", etc.
- Use Scratch block category names: Motion, Looks, Sound, Events, Control, Sensing, Operators, Variables, My Blocks
- Format blocks clearly. Use indentation for blocks inside loops/conditionals.
- Use → to show block connections and | for the "then" in if blocks.
- Wrap block names in quotes: "move (10) steps"
- Always specify WHICH SPRITE the code goes on if multiple sprites are needed.
- For variables, always say "make a variable called X" first.
- Mention the Scratch category (in parentheses) for each block type.
- Number each major step.
- End with a "🧪 Test it!" section explaining how to verify it works.

${styleGuide}`;
}

function buildGeneratePrompt(prompt, projectType, level) {
  const levelDesc = {
    beginner: 'beginner (simple blocks, minimal code, great for new Scratchers)',
    intermediate: 'intermediate (uses variables, lists, some custom blocks)',
    advanced: 'advanced (complex logic, multiple sprites, clones, broadcasts, custom blocks)'
  }[level];

  return `Create a Scratch project for this idea:

"${prompt}"

Project type: ${projectType}
Complexity: ${levelDesc}

Please provide:
1. 🎨 PROJECT OVERVIEW — What the project does
2. 🖼️ SPRITES NEEDED — List each sprite and its costumes
3. 🎵 SOUNDS NEEDED — Any sounds to add
4. 📦 VARIABLES/LISTS — Any variables to create first
5. 💻 CODE BLOCKS — For each sprite, list ALL the blocks in order. Use proper indentation for nested blocks.
6. 🧪 TEST IT! — How to check it's working
7. 🚀 CHALLENGE IDEAS — 2-3 ways to extend the project`;
}

function buildFixPrompt(problem, code) {
  let prompt = `I have a problem with my Scratch project:\n\n"${problem}"`;
  if (code) {
    prompt += `\n\nHere's my current code:\n\`\`\`\n${code}\n\`\`\``;
  }
  prompt += `\n\nPlease:
1. 🔍 DIAGNOSE — Explain what's causing the problem
2. ✅ FIXED CODE — Show the corrected Scratch blocks
3. 💡 EXPLANATION — Why the fix works
4. 🛡️ PREVENTION TIP — How to avoid this issue in the future`;
  return prompt;
}

// ─── ChatGPT API Call ─────────────────────────────────────────────────────────
async function callChatGPT(systemPrompt, userPrompt) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 2000,
      temperature: 0.7
    })
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const msg = err?.error?.message || `API error ${response.status}`;
    if (response.status === 401) throw new Error('Invalid API key. Check Settings!');
    if (response.status === 429) throw new Error('Rate limit hit. Wait a moment!');
    if (response.status === 402) throw new Error('OpenAI billing issue. Check your account.');
    throw new Error(msg);
  }

  const data = await response.json();
  return data.choices?.[0]?.message?.content || 'No response received.';
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────
function setLoading(type, on) {
  document.getElementById(`${type}Loader`).classList.toggle('show', on);
  document.getElementById(`${type}Btn`).disabled = on;
  if (on) document.getElementById(`${type}Output`).style.display = 'none';
}

function showOutput(type, text) {
  const wrap = document.getElementById(`${type}Output`);
  const box = document.getElementById(`${type}Result`);
  wrap.style.display = 'block';
  box.textContent = text;
  // Animate in
  box.style.opacity = '0';
  setTimeout(() => { box.style.transition = 'opacity 0.4s'; box.style.opacity = '1'; }, 10);
}

function checkApiKey() {
  if (!apiKey || !apiKey.startsWith('sk-')) {
    showToast('⚠️ Add your OpenAI API key in Settings!', true);
    switchTab('settings');
    return false;
  }
  return true;
}

function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.style.background = isError ? '#ff4d6d' : 'var(--mint)';
  toast.style.color = isError ? '#fff' : 'var(--deep)';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2800);
}

// ─── History ──────────────────────────────────────────────────────────────────
function saveToHistory(prompt, result, type) {
  history.unshift({
    prompt: prompt.slice(0, 80),
    result,
    type,
    date: new Date().toLocaleDateString()
  });
  if (history.length > 20) history = history.slice(0, 20);
  chrome.storage.local.set({ history });
}

function renderHistory() {
  const container = document.getElementById('historyContainer');
  if (!history.length) {
    container.innerHTML = `<div class="history-empty"><div class="big">📋</div><div>No history yet!</div><div style="margin-top:6px;font-size:12px">Your generated code will appear here.</div></div>`;
    return;
  }

  let html = '';
  history.forEach((item, i) => {
    const icon = item.type === 'fix' ? '🔧' : '✨';
    html += `<div class="history-item" data-index="${i}">
      <div class="history-prompt">${icon} ${escapeHtml(item.prompt)}</div>
      <div class="history-meta">${item.date} · ${item.type === 'fix' ? 'Bug Fix' : 'Generated'}</div>
    </div>`;
  });

  html += `<button class="btn btn-secondary clear-history" id="clearHistoryBtn">🗑️ Clear History</button>`;
  container.innerHTML = html;

  document.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', () => {
      const item = history[parseInt(el.dataset.index)];
      const type = item.type;
      switchTab(type === 'fix' ? 'fix' : 'generate');
      if (type === 'fix') {
        document.getElementById('fixProblem').value = item.prompt;
        showOutput('fix', item.result);
      } else {
        document.getElementById('generatePrompt').value = item.prompt;
        document.getElementById('charCount').textContent = item.prompt.length;
        showOutput('generate', item.result);
      }
    });
  });

  document.getElementById('clearHistoryBtn')?.addEventListener('click', () => {
    history = [];
    chrome.storage.local.set({ history });
    renderHistory();
    showToast('🗑️ History cleared');
  });
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
