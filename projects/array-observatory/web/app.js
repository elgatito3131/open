'use strict';

// Java performs every array operation. This page only displays its snapshots.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = {
  trace: null, frames: [], position: 0, timer: null,
  running: false, requestId: 0, controller: null, intent: 0,
  codeOpen: false, source: null, sourcePromise: null,
};

const phaseTitles = {
  initial: 'Before the first instruction',
  allocation: 'Make room for more values',
  copy: 'Copy a value into the new array',
  shift: 'Move a value one position',
  write: 'Write the new value',
  clear: 'Clear the unused slot',
  commit: 'Finish the operation',
};
const phaseNotes = {
  initial: 'Size counts the values. Capacity counts all available slots.',
  allocation: 'A full array grows to twice its capacity. The old array stays visible while its values are copied.',
  copy: 'The value keeps its index as it moves from the old array to the new one.',
  shift: 'Insert shifts values right to open a gap. Remove shifts them left to close one.',
  write: 'For append and insert, size updates in the next step.',
  clear: 'Java clears the reference so the unused slot no longer holds a value.',
  commit: 'The edit is complete. Removing a value leaves the allocated capacity unchanged.',
};

function currentInput() {
  return { initial: $('#initial').value, operations: $('#operations').value, growth: 'double' };
}
function operationLines() {
  return $('#operations').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
function setConnection(online) {
  $('#connection-dot').classList.toggle('online', online);
  $('#connection-dot').classList.toggle('offline', !online);
  $('#connection-text').textContent = online ? 'Java connected' : 'Java unavailable';
}
function setError(message) {
  $('#error-message').textContent = message;
  $('#error-message').hidden = !message;
}
function updateControls() {
  const emptyTrace = state.trace && state.frames.length <= 1;
  $('#play').disabled = state.running || Boolean(emptyTrace);
  $('#next').disabled = state.running || Boolean(state.trace && state.position >= state.frames.length - 1);
  $('#previous').disabled = state.running || state.position === 0;
  $('#play').textContent = state.timer ? 'Pause' : 'Play';
  $('#play').setAttribute('aria-label', state.timer ? 'Pause' : 'Play');
  $('#desktop-status').textContent = state.running ? 'Preparing…' : state.trace
    ? `Step ${state.position} of ${state.frames.length - 1}` : 'Ready';
}
function stopPlayback() {
  clearInterval(state.timer);
  state.timer = null;
  updateControls();
}
function cancelRequest() {
  state.requestId++;
  state.controller?.abort();
  state.controller = null;
  state.running = false;
}
function renderQueue() {
  const operations = state.trace ? state.trace.operations : operationLines();
  $('#queue-empty').hidden = operations.length > 0;
  $('#queue-empty').textContent = 'No instructions yet. Add one above to change the array.';
  const fragment = document.createDocumentFragment();
  operations.forEach((operation, index) => {
    const item = document.createElement('li');
    const number = document.createElement('span');
    number.className = 'queue-index';
    number.textContent = String(index + 1).padStart(2, '0');
    const text = document.createElement('span');
    text.className = 'queue-operation';
    text.textContent = operation;
    const status = document.createElement('span');
    status.className = 'queue-state';
    status.textContent = 'waiting';
    item.append(number, text, status);
    fragment.append(item);
  });
  $('#operation-queue').replaceChildren(fragment);
}
function showPending() {
  $('#array-container').hidden = true;
  $('#old-buffer').hidden = true;
  $('#memory-empty').hidden = false;
  $('#memory-empty').textContent = 'Press Play or Next to see your array.';
  $('#used-label').textContent = '—';
  $('#capacity-label').textContent = '—';
  $('#capacity-caption').textContent = 'Your initial values are used when you begin.';
  $('#phase-tag').textContent = 'Ready';
  $('#step-counter').textContent = '0 / 0';
  $('#step-title').textContent = 'Ready to begin';
  $('#operation-label').textContent = '';
  $('#step-message').textContent = 'Play follows the instructions automatically. Next shows one step at a time.';
  $('#step-explanation').textContent = 'Reset returns to your initial values and keeps your instructions.';
  $('#run-status').textContent = 'Press Play or Next to begin.';
  updateSourceReference();
  highlightSource();
  updateControls();
}
function editSequence() {
  state.intent++;
  stopPlayback();
  cancelRequest();
  state.trace = null;
  state.frames = [];
  state.position = 0;
  setError('');
  renderQueue();
  showPending();
}
async function readJson(response) {
  try { return JSON.parse(await response.text()); }
  catch { throw new Error('Java returned an unreadable response. Restart the local app and try again.'); }
}
async function prepareTrace() {
  if (state.trace) return true;
  const requestId = ++state.requestId;
  const controller = new AbortController();
  state.controller = controller;
  state.running = true;
  setError('');
  $('#run-status').textContent = 'Preparing your instructions…';
  updateControls();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams(currentInput()),
      signal: controller.signal,
    });
    const data = await readJson(response);
    if (requestId !== state.requestId) return false;
    setConnection(true);
    if (!response.ok) throw new Error(data.error || 'Check your initial values and instructions.');
    if (!data.initial || !Array.isArray(data.steps) || !Array.isArray(data.operations)) {
      throw new Error('Java returned an incomplete trace. Restart the local app and try again.');
    }
    state.trace = data;
    state.frames = [{ ...data.initial, phase: 'initial', operationIndex: -1, operation: '',
      activeIndices: [], oldSlots: null, source: null,
      message: `${data.initial.size} value${data.initial.size === 1 ? '' : 's'} in an array with ${data.initial.capacity} slots.`,
    }, ...data.steps];
    state.position = 0;
    $('#run-status').textContent = data.operations.length
      ? `${data.operations.length} instruction${data.operations.length === 1 ? '' : 's'} · ready to play`
      : 'Initial values only. Add an instruction to change them.';
    renderQueue();
    renderFrame();
    return true;
  } catch (error) {
    if (requestId !== state.requestId) return false;
    const offline = error.name === 'TypeError' || error.name === 'AbortError';
    if (offline) setConnection(false);
    setError(offline ? 'Java is not responding. Start the local app, then press Play or Next again.' : error.message);
    $('#run-status').textContent = 'Could not prepare the sequence.';
    return false;
  } finally {
    clearTimeout(timeout);
    if (requestId === state.requestId) {
      state.running = false;
      state.controller = null;
      updateControls();
    }
  }
}
function makeSlots(slots, activeIndices = [], old = false) {
  const container = document.createElement('div');
  container.className = `array-slots${old ? ' old-slots' : ''}`;
  container.style.setProperty('--slot-columns', Math.min(Math.max(slots.length, 1), 8));
  container.setAttribute('role', 'list');
  container.setAttribute('aria-label', old ? 'Previous backing array' : 'Current backing array');
  slots.forEach((value, index) => {
    const empty = value === null || value === undefined;
    const active = activeIndices.includes(index);
    const slot = document.createElement('div');
    slot.className = `array-slot${empty ? ' empty' : ''}${active ? ' active' : ''}`;
    slot.setAttribute('role', 'listitem');
    slot.setAttribute('aria-label', `Index ${index}: ${empty ? 'empty' : value}${active ? ', active this step' : ''}`);
    const content = document.createElement('span');
    const text = empty ? '·' : String(value);
    content.className = `slot-value${text.length > 6 ? ' long-value' : text.length > 3 ? ' medium-value' : ''}`;
    content.textContent = text;
    const label = document.createElement('span');
    label.className = 'slot-index';
    label.textContent = String(index);
    label.setAttribute('aria-hidden', 'true');
    slot.append(content, label);
    container.append(slot);
  });
  return container;
}
function renderFrame() {
  const frame = state.frames[state.position];
  if (!frame) return;
  $('#memory-empty').hidden = true;
  $('#array-container').hidden = false;
  $('#array-container').replaceChildren(makeSlots(frame.slots, frame.activeIndices));
  $('#old-buffer').hidden = !Array.isArray(frame.oldSlots);
  if (Array.isArray(frame.oldSlots)) $('#old-slots').replaceWith(Object.assign(makeSlots(frame.oldSlots, [], true), { id: 'old-slots' }));
  $('#used-label').textContent = String(frame.size);
  $('#capacity-label').textContent = String(frame.capacity);
  const phase = frame.phase;
  const growthCommit = phase === 'commit' && state.frames[state.position + 1]?.operationIndex === frame.operationIndex;
  const pending = frame.slots.some((value, index) => index >= frame.size && value !== null);
  $('#capacity-caption').textContent = Array.isArray(frame.oldSlots)
    ? 'Some values are still being copied from the previous array.'
    : phase === 'clear' ? 'The slot is clear; size updates next.'
      : pending ? 'The array is changing; size updates when this instruction finishes.' : `${frame.capacity - frame.size} unused slot${frame.capacity - frame.size === 1 ? '' : 's'}.`;
  $('#phase-tag').textContent = phase === 'initial' ? 'Initial state' : phase[0].toUpperCase() + phase.slice(1);
  $('#step-counter').textContent = `${state.position} / ${state.frames.length - 1}`;
  $('#step-title').textContent = growthCommit ? 'The larger array is ready' : phaseTitles[phase] || 'Next step';
  $('#operation-label').textContent = frame.operation || '';
  $('#step-message').textContent = frame.message;
  $('#step-explanation').textContent = growthCommit
    ? 'The values have been copied. The current instruction can now continue.'
    : phase === 'write' && frame.operation.startsWith('set ') ? 'Replacing a value changes neither size nor capacity.'
      : phaseNotes[phase] || '';
  $$('#operation-queue li').forEach((item, index) => {
    const current = index === frame.operationIndex;
    const completed = index < frame.operationIndex || (current && phase === 'commit' && !growthCommit);
    item.classList.toggle('current', current);
    item.classList.toggle('completed', completed);
    if (current) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
    item.querySelector('.queue-state').textContent = current ? (completed ? 'done' : growthCommit ? 'growing' : phase) : completed ? '✓' : 'waiting';
  });
  updateControls();
  updateSourceReference();
  highlightSource(state.codeOpen);
}
function stepTo(position) {
  state.position = Math.max(0, Math.min(position, state.frames.length - 1));
  renderFrame();
}
async function next() {
  const intent = ++state.intent;
  stopPlayback();
  if (await prepareTrace() && intent === state.intent) stepTo(state.position + 1);
}
async function play() {
  const intent = ++state.intent;
  if (state.timer) { stopPlayback(); return; }
  if (!await prepareTrace() || intent !== state.intent || state.frames.length <= 1) return;
  if (state.position >= state.frames.length - 1) stepTo(0);
  stepTo(state.position + 1);
  if (state.position >= state.frames.length - 1) return;
  state.timer = setInterval(() => {
    stepTo(state.position + 1);
    if (state.position >= state.frames.length - 1) stopPlayback();
  }, 900);
  updateControls();
}
async function reset() {
  const intent = ++state.intent;
  stopPlayback();
  cancelRequest();
  setError('');
  if (await prepareTrace() && intent === state.intent) stepTo(0);
}
function updateSourceReference() {
  const source = state.frames[state.position]?.source;
  $('#source-reference').textContent = source ? `Line ${source.line} · ${state.frames[state.position].operation}`
    : 'The highlighted line follows each step.';
}
function highlightSource(reveal = false) {
  $$('.source-line.active-line').forEach((line) => { line.classList.remove('active-line'); line.removeAttribute('aria-current'); });
  const source = state.frames[state.position]?.source;
  if (source?.file !== 'DynamicBuffer.java') return;
  const line = $(`.source-line[data-line="${Number(source.line)}"]`);
  if (!line) return;
  line.classList.add('active-line');
  line.setAttribute('aria-current', 'true');
  if (reveal) {
    const viewer = $('#source-code');
    viewer.scrollTop += line.getBoundingClientRect().top - viewer.getBoundingClientRect().top - viewer.clientHeight / 3;
  }
}
async function showSource() {
  if (state.source) { highlightSource(true); return; }
  if (state.sourcePromise) return state.sourcePromise;
  $('#source-error').hidden = true;
  state.sourcePromise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/source?file=DynamicBuffer.java', { signal: controller.signal });
      const data = await readJson(response);
      if (!response.ok || typeof data.content !== 'string') throw new Error('Source unavailable.');
      state.source = data.content;
      const lines = data.content.split('\n');
      $('#source-filename').textContent = 'DynamicBuffer.java';
      $('#source-lines').textContent = `${lines.length} lines · Java`;
      const fragment = document.createDocumentFragment();
      lines.forEach((text, index) => {
        const row = document.createElement('div');
        row.className = `source-line${/^(\/\/|\/\*|\*|\*\/)/.test(text.trim()) ? ' comment' : ''}`;
        row.dataset.line = String(index + 1);
        const number = document.createElement('span');
        number.className = 'line-number';
        number.textContent = String(index + 1);
        number.setAttribute('aria-hidden', 'true');
        const code = document.createElement('code');
        code.className = 'line-content';
        code.textContent = text || ' ';
        row.append(number, code);
        fragment.append(row);
      });
      $('#source-code').replaceChildren(fragment);
      highlightSource(state.codeOpen);
    } catch {
      $('#source-error').textContent = 'Could not load Java source. Check the local app, then hide and show code to retry.';
      $('#source-error').hidden = false;
    } finally {
      clearTimeout(timeout);
      state.sourcePromise = null;
    }
  })();
  return state.sourcePromise;
}
function toggleCode() {
  state.codeOpen = !state.codeOpen;
  $('#code-panel').hidden = !state.codeOpen;
  $('#workspace').classList.toggle('show-code', state.codeOpen);
  $('#toggle-code').textContent = state.codeOpen ? 'Hide code' : 'Show code';
  $('#toggle-code').setAttribute('aria-expanded', String(state.codeOpen));
  if (state.codeOpen) showSource();
}

$('#initial').addEventListener('input', editSequence);
$('#operations').addEventListener('input', editSequence);
$('#play').addEventListener('click', play);
$('#next').addEventListener('click', next);
$('#previous').addEventListener('click', () => { state.intent++; stopPlayback(); stepTo(state.position - 1); });
$('#reset').addEventListener('click', reset);
$('#toggle-code').addEventListener('click', toggleCode);
$('#title-help').addEventListener('click', () => { state.intent++; stopPlayback(); $('#about-dialog').showModal(); });
$('#close-about').addEventListener('click', () => $('#about-dialog').close());
document.addEventListener('visibilitychange', () => { if (document.hidden) { state.intent++; stopPlayback(); } });
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') { state.intent++; stopPlayback(); } });
renderQueue();
showPending();
prepareTrace();
