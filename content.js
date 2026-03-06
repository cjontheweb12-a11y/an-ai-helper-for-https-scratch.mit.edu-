// ScratchAI Content Script — Runs on scratch.mit.edu
// Injects an AI panel that generates & adds real code to the Scratch editor

(function () {
  'use strict';

  let apiKey = 'TGPhKZsHMGgFbmlS';
  let model = 'gpt-4o';
  let panel = null;
  let isOpen = false;

  chrome.storage.local.get(['apiKey', 'model'], res => {
    apiKey = res.apiKey || '';
    model = res.model || 'gpt-4o';
  });

  // ── Get the Scratch VM from React internals ───────────────────────────────────
  function getScratchVM() {
    try {
      const app = document.getElementById('app');
      if (!app) return null;

      // Method 1: __reactContainer$ path (React 18+)
      const containerKey = Object.keys(app).find(k => k.startsWith('__reactContainer$'));
      if (containerKey) {
        let node = app[containerKey];
        let i = 0;
        while (node && i++ < 500) {
          try {
            const vm = node?.pendingProps?.store?.getState()?.scratchGui?.vm;
            if (vm && typeof vm.toJSON === 'function') return vm;
          } catch (e) {}
          try {
            const vm = node?.memoizedProps?.store?.getState()?.scratchGui?.vm;
            if (vm && typeof vm.toJSON === 'function') return vm;
          } catch (e) {}
          node = node.child || node.sibling || (node.return && node.return.sibling);
        }
      }

      // Method 2: __reactFiber$ path
      const fiberKey = Object.keys(app).find(k => k.startsWith('__reactFiber$'));
      if (fiberKey) {
        let node = app[fiberKey];
        let i = 0;
        while (node && i++ < 500) {
          try {
            const vm = node?.pendingProps?.store?.getState()?.scratchGui?.vm;
            if (vm && typeof vm.toJSON === 'function') return vm;
          } catch (e) {}
          node = node.child || node.sibling || (node.return && node.return.sibling);
        }
      }

      // Method 3: updateQueue deps path
      try {
        const k = Object.keys(app)[0];
        const vm = app[k]?.child?.updateQueue?.lastEffect?.deps?.[1]?.scratchGui?.vm;
        if (vm && typeof vm.toJSON === 'function') return vm;
      } catch (e) {}

      return null;
    } catch (e) { return null; }
  }

  // ── Inject generated SB3 blocks into the live Scratch editor ─────────────────
  async function injectBlocksIntoScratch(sb3Json) {
    const vm = getScratchVM();
    if (!vm) throw new Error('Cannot connect to Scratch editor. Make sure a project is open in editor mode.');

    const currentProject = JSON.parse(vm.toJSON());

    // Pull blocks/variables from the generated JSON's sprite target
    const srcTarget = sb3Json.targets?.find(t => !t.isStage) || sb3Json.targets?.[0] || {};
    const newBlocks = srcTarget.blocks || {};
    const newVars = srcTarget.variables || {};
    const newLists = srcTarget.lists || {};

    // Find destination sprite (first non-stage target)
    const destTarget = currentProject.targets.find(t => !t.isStage) || currentProject.targets[0];
    const stage = currentProject.targets.find(t => t.isStage);

    // Calculate Y offset so new blocks don't overlap existing ones
    let maxY = 200;
    Object.values(destTarget.blocks || {}).forEach(b => {
      if (b.topLevel && typeof b.y === 'number') maxY = Math.max(maxY, b.y + 200);
    });

    // Offset top-level blocks
    let col = 0;
    Object.values(newBlocks).forEach(block => {
      if (block.topLevel) {
        block.x = 20 + (col % 3) * 340;
        block.y = maxY + Math.floor(col / 3) * 320;
        col++;
      }
    });

    // Merge everything
    destTarget.blocks = Object.assign({}, destTarget.blocks, newBlocks);
    if (stage) {
      stage.variables = Object.assign({}, stage.variables, newVars);
      stage.lists = Object.assign({}, stage.lists, newLists);
    }

    await vm.loadProject(JSON.stringify(currentProject));
  }

  // ── System prompt for SB3 JSON generation ────────────────────────────────────
  function buildSB3SystemPrompt() {
    return `You are ScratchAI. Generate valid Scratch 3.0 sb3 JSON to inject into a live project.

Respond with ONLY a JSON object — no markdown, no backticks, no explanation.

Required top-level structure:
{
  "targets": [
    { "isStage": true, "name": "Stage", "variables": {}, "lists": {}, "broadcasts": {}, "blocks": {}, "comments": {}, "currentCostume": 0, "costumes": [{"name":"backdrop1","dataFormat":"svg","assetId":"cd21514d0531fdffb22204e0ec5ed84a","md5ext":"cd21514d0531fdffb22204e0ec5ed84a.svg","rotationCenterX":240,"rotationCenterY":180}], "sounds": [], "volume": 100, "layerOrder": 0, "tempo": 60, "videoTransparency": 50, "videoState": "on", "textToSpeechLanguage": null },
    { "isStage": false, "name": "Sprite1", "variables": {}, "lists": {}, "broadcasts": {}, "blocks": {}, "comments": {}, "currentCostume": 0, "costumes": [{"name":"costume1","dataFormat":"svg","assetId":"bcf454acf82e4504149f7ffe07081dbc","md5ext":"bcf454acf82e4504149f7ffe07081dbc.svg","rotationCenterX":48,"rotationCenterY":50}], "sounds": [], "volume": 100, "layerOrder": 1, "visible": true, "x": 0, "y": 0, "size": 100, "direction": 90, "draggable": false, "rotationStyle": "all around" }
  ],
  "monitors": [], "extensions": [], "meta": {"semver":"3.0.0","vm":"0.2.0","agent":""}
}

CRITICAL RULES:
- Put all code blocks in targets[1].blocks (the sprite, NOT the stage)
- If using variables, declare them in targets[0].variables (stage): { "uid123": ["score", 0] }
  AND reference same uid in blocks: fields: { "VARIABLE": ["score", "uid123"] }
- Each block needs a unique ID string (e.g. "blk_a1b2", use random alphanumeric)
- Hat blocks (top-level) need: "topLevel": true, "parent": null, "x": 50, "y": 50
- "next": "BLOCK_ID" or null; "parent": "BLOCK_ID" or null
- Shadow/input blocks: "shadow": true, "topLevel": false

Common opcodes and their structure:

event_whenflagclicked:
{ "opcode":"event_whenflagclicked", "next":null, "parent":null, "inputs":{}, "fields":{}, "shadow":false, "topLevel":true, "x":50, "y":50 }

control_forever (loop body in SUBSTACK input):
{ "opcode":"control_forever", "inputs":{ "SUBSTACK":[2,"FIRST_INNER_BLOCK_ID"] }, "fields":{}, "shadow":false, "topLevel":false }

control_repeat (TIMES is shadow math_number):
{ "opcode":"control_repeat", "inputs":{ "TIMES":[1,"SHADOW_ID"], "SUBSTACK":[2,"FIRST_BLOCK_ID"] }, "fields":{}, "shadow":false, "topLevel":false }
Shadow: { "opcode":"math_number", "inputs":{}, "fields":{ "NUM":["10",null] }, "shadow":true, "topLevel":false }

control_if:
{ "opcode":"control_if", "inputs":{ "CONDITION":[2,"BOOL_BLOCK_ID"], "SUBSTACK":[2,"INNER_BLOCK_ID"] }, "fields":{}, "shadow":false, "topLevel":false }

motion_movesteps (STEPS is shadow math_number):
{ "opcode":"motion_movesteps", "inputs":{ "STEPS":[1,"SHADOW_ID"] }, "fields":{}, "shadow":false, "topLevel":false }

motion_ifonedgebounce:
{ "opcode":"motion_ifonedgebounce", "inputs":{}, "fields":{}, "shadow":false, "topLevel":false }

motion_gotoxy (X and Y are shadow math_number blocks):
{ "opcode":"motion_gotoxy", "inputs":{ "X":[1,"SH_X"], "Y":[1,"SH_Y"] }, "fields":{} }

motion_setrotationstyle:
{ "opcode":"motion_setrotationstyle", "inputs":{}, "fields":{ "STYLE":["left-right",null] } }

motion_changexby / motion_changeyby:
{ "opcode":"motion_changexby", "inputs":{ "DX":[1,"SHADOW_ID"] }, "fields":{} }

looks_sayforsecs (MESSAGE is shadow text, SECS is shadow math_number):
{ "opcode":"looks_sayforsecs", "inputs":{ "MESSAGE":[1,"SH_MSG"], "SECS":[1,"SH_SECS"] }, "fields":{} }
Text shadow: { "opcode":"text", "inputs":{}, "fields":{ "TEXT":["Hello!",null] }, "shadow":true, "topLevel":false }

looks_say: { "opcode":"looks_say", "inputs":{ "MESSAGE":[1,"SH_MSG"] }, "fields":{} }

looks_nextcostume: { "opcode":"looks_nextcostume", "inputs":{}, "fields":{} }

control_wait: { "opcode":"control_wait", "inputs":{ "DURATION":[1,"SHADOW_ID"] }, "fields":{} }

sensing_keypressed (KEY_OPTION is shadow sensing_keyoptions):
{ "opcode":"sensing_keypressed", "inputs":{ "KEY_OPTION":[1,"SH_KEY"] }, "fields":{} }
Key shadow: { "opcode":"sensing_keyoptions", "inputs":{}, "fields":{ "KEY_OPTION":["space",null] }, "shadow":true, "topLevel":false }
Valid key values: "space", "left arrow", "right arrow", "up arrow", "down arrow", "a"-"z", "0"-"9"

event_whenkeypressed: { "opcode":"event_whenkeypressed", "inputs":{}, "fields":{ "KEY_OPTION":["space",null] }, "topLevel":true, "x":50, "y":50 }

data_setvariableto: { "opcode":"data_setvariableto", "inputs":{ "VALUE":[1,"SH_VAL"] }, "fields":{ "VARIABLE":["score","VARID"] } }
data_changevariableby: { "opcode":"data_changevariableby", "inputs":{ "VALUE":[1,"SH_VAL"] }, "fields":{ "VARIABLE":["score","VARID"] } }

operator_equals: { "opcode":"operator_equals", "inputs":{ "OPERAND1":[1,"SH1"], "OPERAND2":[1,"SH2"] }, "fields":{} }

math_number shadow: { "opcode":"math_number", "inputs":{}, "fields":{ "NUM":["10",null] }, "shadow":true, "topLevel":false }
text shadow: { "opcode":"text", "inputs":{}, "fields":{ "TEXT":["Hello",null] }, "shadow":true, "topLevel":false }

Generate complete, working block chains for the requested feature.`;
  }

  // ── ChatGPT calls ─────────────────────────────────────────────────────────────
  async function callGPTForSB3(description) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: buildSB3SystemPrompt() },
          { role: 'user', content: `Generate sb3 JSON for: "${description}"\nRespond with ONLY valid JSON. No markdown, no backticks.` }
        ],
        max_tokens: 3500,
        temperature: 0.2
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (res.status === 401) throw new Error('Invalid API key! Set it in the ScratchAI popup.');
      throw new Error(err?.error?.message || `OpenAI error ${res.status}`);
    }
    const data = await res.json();
    let raw = data.choices?.[0]?.message?.content || '';
    raw = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
    try {
      return JSON.parse(raw);
    } catch (e) {
      throw new Error('AI returned malformed JSON. Try a simpler description like "move with arrow keys".');
    }
  }

  async function callGPTText(userMsg) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: 'You are a helpful Scratch coding assistant. Be concise and practical.' },
          { role: 'user', content: userMsg }
        ],
        max_tokens: 800, temperature: 0.7
      })
    });
    if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
    const data = await res.json();
    return data.choices?.[0]?.message?.content || 'No response.';
  }

  // ── Quick templates ───────────────────────────────────────────────────────────
  const QUICK_TEMPLATES = [
    { label: '⌨️ Arrow key movement', desc: 'sprite moves with arrow keys in a forever loop: if left arrow key pressed change x by -10, if right arrow pressed change x by 10, if up arrow pressed change y by 10, if down arrow pressed change y by -10' },
    { label: '🏆 Score counter', desc: 'when green flag clicked set variable score to 0. When this sprite clicked change score by 1.' },
    { label: '🦘 Jump on space', desc: 'when space key pressed: change y by 80, wait 0.3 seconds, change y by -80' },
    { label: '🔁 Bounce forever', desc: 'when green flag clicked: set rotation style left-right, forever: move 5 steps, if on edge bounce' },
    { label: '🎲 Random teleport', desc: 'when green flag clicked: forever: go to x random -200 to 200 y random -150 to 150, wait 1 second' },
    { label: '⏱️ Countdown timer', desc: 'when green flag clicked: set variable timer to 10, repeat 10 times: wait 1 second, change timer by -1, then say Time is up!' },
    { label: '🎭 Animate costumes', desc: 'when green flag clicked: forever: next costume, wait 0.1 seconds' },
    { label: '💬 Say hello on click', desc: 'when this sprite clicked: say Hello! for 2 seconds' },
  ];

  // ── Init & DOM ────────────────────────────────────────────────────────────────
  function isEditor() {
    return /\/projects\/\d/.test(window.location.pathname) ||
      window.location.pathname.includes('/editor') ||
      window.location.search.includes('editor');
  }

  function init() {
    if (!isEditor()) return;
    if (!document.getElementById('scratchai-fab')) injectFAB();
  }

  function injectFAB() {
    const fab = document.createElement('div');
    fab.id = 'scratchai-fab';
    fab.innerHTML = `<span>🤖</span><span class="scratchai-fab-label">ScratchAI</span>`;
    document.body.appendChild(fab);
    fab.addEventListener('click', togglePanel);
  }

  function togglePanel() { isOpen ? closePanel() : openPanel(); }

  function openPanel() {
    if (panel) panel.remove();
    isOpen = true;

    panel = document.createElement('div');
    panel.id = 'scratchai-panel';
    panel.innerHTML = `
      <div class="sai-header" id="saiDragHandle">
        <span class="sai-title">🤖 ScratchAI</span>
        <div style="display:flex;align-items:center;gap:8px">
          <span id="saiVmDot" title="VM status" style="font-size:18px;line-height:1">●</span>
          <button class="sai-close" id="saiClose">✕</button>
        </div>
      </div>
      <div class="sai-tabs">
        <button class="sai-tab sai-tab-active" data-tab="inject">⚡ Inject</button>
        <button class="sai-tab" data-tab="quick">🚀 Quick</button>
        <button class="sai-tab" data-tab="ask">💬 Ask</button>
      </div>

      <div class="sai-pane" id="sai-pane-inject">
        <div class="sai-tip">Describe what you want → AI generates real Scratch blocks and <strong>adds them directly into your project!</strong></div>
        <textarea id="saiInjectPrompt" placeholder="e.g. make the sprite move left and right with arrow keys and bounce off edges..." rows="4"></textarea>
        <div style="font-size:11px;color:#8892c8;text-align:right;margin:-6px 0 10px">Ctrl+Enter to generate</div>
        <button class="sai-btn sai-btn-glow" id="saiInjectBtn">⚡ Generate & Inject into Scratch</button>
        <div class="sai-loader" id="saiInjectLoader"><div class="sai-dot"></div><div class="sai-dot"></div><div class="sai-dot"></div><span id="saiInjectLoaderTxt" style="font-size:12px;color:#8892c8;margin-left:4px">Generating...</span></div>
        <div class="sai-result" id="saiInjectResult"></div>
      </div>

      <div class="sai-pane sai-pane-hidden" id="sai-pane-quick">
        <div class="sai-tip">One tap to inject common patterns straight into your project!</div>
        <div class="sai-quick-grid" id="saiQuickGrid">
          ${QUICK_TEMPLATES.map((t, i) => `<button class="sai-quick-btn" data-idx="${i}">${t.label}</button>`).join('')}
        </div>
        <div class="sai-loader" id="saiQuickLoader"><div class="sai-dot"></div><div class="sai-dot"></div><div class="sai-dot"></div><span style="font-size:12px;color:#8892c8;margin-left:4px">Injecting blocks...</span></div>
        <div class="sai-result" id="saiQuickResult"></div>
      </div>

      <div class="sai-pane sai-pane-hidden" id="sai-pane-ask">
        <textarea id="saiQuestion" placeholder="Ask anything about Scratch...&#10;e.g. How do I detect collisions?" rows="4"></textarea>
        <button class="sai-btn" id="saiAskBtn">Ask ChatGPT 💬</button>
        <div class="sai-loader" id="saiAskLoader"><div class="sai-dot"></div><div class="sai-dot"></div><div class="sai-dot"></div></div>
        <div class="sai-result" id="saiAskResult"></div>
      </div>
    `;
    document.body.appendChild(panel);

    // VM status dot
    const dot = document.getElementById('saiVmDot');
    dot.style.color = getScratchVM() ? '#52e0a0' : '#ff6680';
    dot.title = getScratchVM() ? '✅ Connected to Scratch VM' : '⚠️ VM not found — open a project';

    document.getElementById('saiClose').addEventListener('click', closePanel);

    panel.querySelectorAll('.sai-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        panel.querySelectorAll('.sai-tab').forEach(t => t.classList.remove('sai-tab-active'));
        tab.classList.add('sai-tab-active');
        panel.querySelectorAll('.sai-pane').forEach(p => p.classList.add('sai-pane-hidden'));
        document.getElementById(`sai-pane-${tab.dataset.tab}`).classList.remove('sai-pane-hidden');
      });
    });

    document.getElementById('saiInjectBtn').addEventListener('click', handleInject);
    document.getElementById('saiInjectPrompt').addEventListener('keydown', e => { if (e.key === 'Enter' && e.ctrlKey) handleInject(); });
    document.getElementById('saiAskBtn').addEventListener('click', handleAsk);
    document.getElementById('saiQuickGrid').querySelectorAll('.sai-quick-btn').forEach(btn => {
      btn.addEventListener('click', () => handleQuickInject(parseInt(btn.dataset.idx)));
    });

    makeDraggable(panel, document.getElementById('saiDragHandle'));
  }

  function closePanel() { panel?.remove(); panel = null; isOpen = false; }

  async function handleInject() {
    const prompt = document.getElementById('saiInjectPrompt').value.trim();
    if (!prompt) return;
    if (!checkKey()) return;

    const btn = document.getElementById('saiInjectBtn');
    btn.disabled = true;
    showLoader('saiInjectLoader', true, 'Asking ChatGPT...');
    hideResult('saiInjectResult');

    try {
      const sb3 = await callGPTForSB3(prompt);
      showLoader('saiInjectLoader', true, 'Injecting into Scratch...');
      await injectBlocksIntoScratch(sb3);
      // Refresh VM dot
      document.getElementById('saiVmDot').style.color = '#52e0a0';
      showResult('saiInjectResult', '✅ Blocks injected! Switch to the Code tab in Scratch to see them.', 'success');
    } catch (e) {
      showResult('saiInjectResult', '❌ ' + e.message, 'error');
    } finally {
      showLoader('saiInjectLoader', false);
      btn.disabled = false;
    }
  }

  async function handleQuickInject(idx) {
    if (!checkKey()) return;
    const tpl = QUICK_TEMPLATES[idx];
    const btns = document.getElementById('saiQuickGrid').querySelectorAll('.sai-quick-btn');
    btns.forEach(b => b.disabled = true);
    showLoader('saiQuickLoader', true);
    hideResult('saiQuickResult');

    try {
      const sb3 = await callGPTForSB3(tpl.desc);
      await injectBlocksIntoScratch(sb3);
      showResult('saiQuickResult', `✅ "${tpl.label}" injected! Check the Code tab.`, 'success');
    } catch (e) {
      showResult('saiQuickResult', '❌ ' + e.message, 'error');
    } finally {
      showLoader('saiQuickLoader', false);
      btns.forEach(b => b.disabled = false);
    }
  }

  async function handleAsk() {
    const q = document.getElementById('saiQuestion').value.trim();
    if (!q) return;
    if (!checkKey()) return;

    const btn = document.getElementById('saiAskBtn');
    btn.disabled = true;
    showLoader('saiAskLoader', true);
    hideResult('saiAskResult');

    try {
      const txt = await callGPTText(q);
      showResult('saiAskResult', txt, 'text');
    } catch (e) {
      showResult('saiAskResult', '❌ ' + e.message, 'error');
    } finally {
      showLoader('saiAskLoader', false);
      btn.disabled = false;
    }
  }

  function showLoader(id, on, txt) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = on ? 'flex' : 'none';
    const t = document.getElementById(id + 'Txt') || el.querySelector('span:last-child');
    if (t && txt) t.textContent = txt;
  }

  function hideResult(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }

  function showResult(id, msg, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = 'block';
    el.className = 'sai-result sai-result-' + type;
    el.textContent = msg;
  }

  function checkKey() {
    chrome.storage.local.get(['apiKey', 'model'], res => {
      if (res.apiKey) apiKey = res.apiKey;
      if (res.model) model = res.model;
    });
    if (!apiKey || !apiKey.startsWith('sk-')) {
      alert('ScratchAI: Please add your OpenAI API key!\nClick the 🤖 ScratchAI icon in your browser toolbar → Settings tab.');
      return false;
    }
    return true;
  }

  function makeDraggable(el, handle) {
    let sx, sy, sl, st;
    handle.style.cursor = 'grab';
    handle.addEventListener('mousedown', e => {
      if (e.target.classList.contains('sai-close')) return;
      sx = e.clientX; sy = e.clientY;
      const r = el.getBoundingClientRect(); sl = r.left; st = r.top;
      handle.style.cursor = 'grabbing';
      const move = e => { el.style.cssText += `;left:${sl+e.clientX-sx}px;top:${st+e.clientY-sy}px;right:auto;bottom:auto`; };
      const up = () => { handle.style.cursor = 'grab'; document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 1500));
  } else {
    setTimeout(init, 1500);
  }

  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => {
        document.getElementById('scratchai-fab')?.remove();
        closePanel();
        if (isEditor()) injectFAB();
      }, 2000);
    }
  }).observe(document, { subtree: true, childList: true });

})();
