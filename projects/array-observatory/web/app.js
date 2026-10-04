'use strict';

// The browser presents snapshots. All array operations happen in the Java engine.
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = {
  trace: null,
  frames: [],
  position: 0,
  timer: null,
  running: false,
  lastInput: '',
  mode: 'follow',
  sourceFile: '',
  sourceCache: new Map(),
  sourceRequest: 0,
  sourcesLoaded: false,
  sourceListPromise: null,
  stage: 0,
  explored: new Set(),
};

const scenarios = {
  mixed: { initial: '12, 27, 41', operations: 'append 8\ninsert 1 24\nremove 2\nset 0 9' },
  grow: { initial: '12, 27, 41', operations: 'append 8\nappend 63\nappend 72\nappend 91\nappend 5\nappend 36' },
  insert: { initial: '12, 27, 41', operations: 'insert 1 24\ninsert 2 36' },
  remove: { initial: '12, 27, 41, 63', operations: 'remove 1\nremove 0' },
};

const phaseTitles = {
  initial: 'Before the first instruction',
  allocation: 'Allocate a larger home',
  copy: 'Carry a value into new storage',
  shift: 'Move a value one position',
  write: 'Write the requested value',
  clear: 'Clear the unused reference',
  commit: 'Finish the operation',
};

const phaseExplanations = {
  initial: 'The backing array has room beyond its logical contents. Size counts stored values; capacity counts every allocated slot. These initial values come from the Java engine. The cost counters begin at zero after initialization.',
  allocation: 'The current array cannot hold the next value. Java allocates a replacement using your chosen growth policy. The old buffer stays visible while its existing values are copied. This increases the allocation counter by one.',
  copy: 'This is one existing value moving from the old buffer to the replacement. Its index stays the same. Each moved value adds one copy; growth does not count as an explicit user value write.',
  shift: 'An insert opens a gap by moving values toward the right, starting at the end. A remove closes a gap by moving values toward the left. Each existing value moved inside the same buffer adds one shift.',
  write: 'The requested value is now in its destination slot. This adds one user value write. For append and insert, size is updated at commit, so a written slot can briefly sit just beyond the logical size.',
  clear: 'After removal, the obsolete reference at the end is cleared to null. This prevents storage from retaining a value outside the logical contents. Clearing does not add a user value write, copy, or shift.',
  commit: 'The operation is complete. The size and contents now describe the finished result. Removing a value does not shrink this implementation’s capacity; the free slot can be reused by a later operation.',
};

const stages = [
  {
    kicker: 'STAGE 01 / STORAGE', file: 'DynamicBuffer.java',
    title: 'Separate what exists from what is available.',
    lead: 'Start with a generic Java buffer. A backing array owns the storage; a separate size tells you how much of that storage belongs to the collection.',
    goal: 'Find the backing storage, size field, constructor, and indexed access. Follow how the generic type is exposed while storage stays private.',
    invariant: 'At the end of every operation: 0 ≤ size ≤ capacity. Valid element indexes run from 0 through size − 1. Unused references are null.',
    question: 'Size is 3 and capacity is 4. How many values fit before another append needs growth?',
    choices: ['0 values', '1 value', '4 values'], answer: 1,
    feedback: 'One value fits in slot 3. After that append, size and capacity are both 4; the following append needs a larger backing array.',
  },
  {
    kicker: 'STAGE 02 / OPERATIONS', file: 'DynamicBuffer.java',
    title: 'Make space without losing the order.',
    lead: 'Append writes at the end. Insert opens a gap. Remove closes one. When the array is full, a growth policy chooses a larger home before any new value is placed.',
    goal: 'Read append, insert, remove, set, and the growth helper. Track the direction of each loop and the point where size changes.',
    invariant: 'An insertion shifts from right to left so it cannot overwrite a value it still needs. A removal shifts from left to right, then clears the obsolete tail.',
    question: 'A balanced buffer is full at capacity 6. What capacity does the next append allocate?',
    choices: ['7 slots', '9 slots', '12 slots'], answer: 1,
    feedback: 'Balanced growth adds ceil(old capacity ÷ 2). From 6, that is 6 + 3 = 9. Double growth would choose 12.',
  },
  {
    kicker: 'STAGE 03 / TRACE', file: 'DynamicBuffer.java',
    title: 'Let each mutation explain itself.',
    lead: 'Capture a snapshot after each meaningful change. Include the buffer, logical size, active indexes, accumulated costs, and the source line that produced the event.',
    goal: 'Follow the trace-emission calls and snapshot code. Check that captured arrays are independent copies, so later mutations cannot rewrite earlier frames.',
    invariant: 'A trace frame records what has actually happened. Writes, growth copies, in-place shifts, and replacement allocations are separate costs.',
    question: 'Inserting at index 1 into [12, 27, 41] shifts how many existing values?',
    choices: ['1 shift', '2 shifts', '3 shifts'], answer: 1,
    feedback: 'Two existing values move: 41 goes from index 2 to 3, then 27 goes from index 1 to 2. Writing the inserted value is counted separately.',
  },
  {
    kicker: 'STAGE 04 / CONNECT', file: 'TraceServer.java',
    title: 'Make the program observable.',
    lead: 'A small Java HTTP server accepts a sequence, runs the engine, and returns its trace. The browser lets a reader move through those frames and inspect the source.',
    goal: 'Read the trace route, input validation, JSON response, and source route in TraceServer.java. Then connect them to requestTrace and renderFrame in web/app.js.',
    invariant: 'There is one source of execution truth: Java. The browser changes the selected frame, not the collection. Invalid input returns a useful error.',
    question: 'Which part of the project performs the array operations?',
    choices: ['Java engine', 'Browser', 'Both'], answer: 0,
    feedback: 'The Java engine performs every operation. The browser sends your input and displays the snapshots returned by the server.',
  },
];

function currentInput() {
  return {
    initial: $('#initial').value,
    operations: $('#operations').value,
    growth: $('input[name="growth"]:checked').value,
  };
}

function inputSignature(input = currentInput()) {
  return JSON.stringify(input);
}

function operationLines() {
  return $('#operations').value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function setConnection(online) {
  $('#connection-dot').classList.toggle('online', online);
  $('#connection-dot').classList.toggle('offline', !online);
  $('#connection-text').textContent = online ? 'Java engine connected' : 'Java engine unavailable';
}

function setError(message) {
  $('#error-message').textContent = message;
  $('#error-message').hidden = !message;
}

function updateDraft() {
  const count = operationLines().length;
  $('#operation-count').textContent = `${count} operation${count === 1 ? '' : 's'}`;
  if (state.running) return;
  if (state.trace && inputSignature() !== state.lastInput) {
    $('#run-status').textContent = 'Edited sequence · run again to update the trace.';
    $('#queue-status').textContent = 'Previous run';
  } else if (state.trace) {
    $('#run-status').textContent = `${state.trace.operations.length} operations · ${state.trace.steps.length} Java execution frames`;
    $('#queue-status').textContent = 'Current run';
  } else {
    $('#run-status').textContent = 'Ready for your experiment.';
  }
}

async function readJson(response) {
  const body = await response.text();
  try {
    return JSON.parse(body);
  } catch {
    throw new Error('The local server did not return a valid response. Start the project’s Java server, then try again.');
  }
}

async function requestTrace() {
  if (state.running) return;
  stopPlayback();
  setError('');
  const input = currentInput();
  state.running = true;
  $('#run').disabled = true;
  $('#menu-run').disabled = true;
  $('#run').textContent = 'Running in Java…';
  $('#run-status').textContent = 'Executing your sequence and capturing each mutation…';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/trace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams(input),
      signal: controller.signal,
    });
    const data = await readJson(response);
    setConnection(true);
    if (!response.ok) throw new Error(data.error || `The Java engine returned error ${response.status}.`);
    if (!data.initial || !Array.isArray(data.steps) || !Array.isArray(data.operations)) {
      throw new Error('The server returned an incomplete trace. Restart the Java server and try again.');
    }
    state.trace = data;
    state.lastInput = inputSignature(input);
    state.frames = [{
      ...data.initial,
      phase: 'initial',
      operationIndex: -1,
      operation: '',
      activeIndices: [],
      oldSlots: null,
      metrics: { writes: 0, copies: 0, shifts: 0, allocations: 0 },
      message: `The Java engine initialized ${data.initial.size} value${data.initial.size === 1 ? '' : 's'} in ${data.initial.capacity} available slots.`,
      source: null,
    }, ...data.steps];
    state.position = 0;
    $('#memory-empty').hidden = true;
    $('#array-container').hidden = false;
    $('#timeline').max = String(state.frames.length - 1);
    renderQueue();
    renderFrame();
  } catch (error) {
    const networkFailure = error.name === 'TypeError' || error.name === 'AbortError';
    if (networkFailure) setConnection(false);
    let message = networkFailure
      ? 'The Java engine is not responding. Start the local server with ./run.sh, open its local address, and try Run in Java again.'
      : error.message;
    if (state.trace) message += ' The last successful trace is still visible.';
    setError(message);
    if (!state.trace) {
      $('#memory-empty p').textContent = 'The observatory is waiting for Java.';
      $('#memory-empty small').textContent = 'Your sequence is ready. Start the server, then run it again.';
    }
  } finally {
    clearTimeout(timeout);
    state.running = false;
    $('#run').disabled = false;
    $('#menu-run').disabled = false;
    $('#run').replaceChildren(document.createTextNode('Run in Java '));
    const arrow = document.createElement('span');
    arrow.textContent = '▶';
    arrow.setAttribute('aria-hidden', 'true');
    $('#run').append(arrow);
    updateDraft();
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
    const string = empty ? '·' : String(value);
    content.className = `slot-value${string.length > 6 ? ' long-value' : string.length > 3 ? ' medium-value' : ''}`;
    content.textContent = string;
    const label = document.createElement('span');
    label.className = 'slot-index';
    label.textContent = String(index).padStart(2, '0');
    label.setAttribute('aria-hidden', 'true');
    slot.append(content, label);
    container.append(slot);
  });
  return container;
}

function renderFrame() {
  const frame = state.frames[state.position];
  if (!frame) return;
  $('#array-container').replaceChildren(makeSlots(frame.slots, frame.activeIndices || []));
  const oldSlots = frame.oldSlots;
  $('#old-buffer').hidden = !Array.isArray(oldSlots);
  if (Array.isArray(oldSlots)) $('#old-slots').replaceWith(Object.assign(makeSlots(oldSlots, [], true), { id: 'old-slots' }));
  $('#used-label').textContent = String(frame.size);
  $('#capacity-label').textContent = String(frame.capacity);
  const percentage = frame.capacity ? Math.round(frame.size / frame.capacity * 100) : 0;
  $('#capacity-fill').style.width = `${percentage}%`;
  $('#capacity-meter').setAttribute('aria-valuenow', String(percentage));
  $('#capacity-meter').setAttribute('aria-valuetext', `Logical size ${frame.size}, capacity ${frame.capacity} slots`);
  const phase = frame.phase || 'commit';
  const nextFrame = state.frames[state.position + 1];
  const growthCommit = phase === 'commit' && nextFrame?.operationIndex === frame.operationIndex;
  const pending = frame.slots.some((value, index) => index >= frame.size && value !== null);
  $('#capacity-caption').textContent = Array.isArray(oldSlots)
    ? 'During growth, logical size includes values still in the previous buffer.'
    : phase === 'clear'
      ? 'The vacated slot is clear. Logical size will update in the next commit frame.'
      : pending
        ? 'A value is visible beyond size; logical size will update at commit.'
        : `${frame.capacity - frame.size} slot${frame.capacity - frame.size === 1 ? '' : 's'} available · capacity stays allocated after removal.`;
  $('#phase-tag').textContent = phase === 'initial' ? 'Initial state' : phase[0].toUpperCase() + phase.slice(1);
  $('#phase-tag').className = `phase-tag${phase === 'initial' ? '' : ['allocation', 'copy'].includes(phase) ? ' is-growth' : ' is-active'}`;
  $('#step-counter').textContent = `${String(state.position).padStart(2, '0')} / ${String(state.frames.length - 1).padStart(2, '0')}`;
  $('#step-title').textContent = growthCommit ? 'Finish growing; continue the operation' : phaseTitles[phase] || 'Observe the next mutation';
  $('#operation-label').textContent = frame.operation || 'initial values';
  $('#step-message').textContent = frame.message;
  $('#step-explanation').textContent = growthCommit
    ? 'The existing values are now in the larger buffer, and the old buffer is released. The requested operation is still in progress: it can now shift or write its value into the new storage.'
    : phaseExplanations[phase] || 'This snapshot records the Java program immediately after this change.';
  $('#timeline').value = String(state.position);
  $('#timeline').disabled = state.frames.length <= 1;
  $('#timeline').setAttribute('aria-valuetext', `Step ${state.position} of ${state.frames.length - 1}: ${frame.message}`);
  $('#previous').disabled = state.position === 0;
  $('#next').disabled = state.position === state.frames.length - 1;
  $('#play').disabled = state.frames.length <= 1;
  $('#menu-first').disabled = state.position === 0;
  $('#menu-last').disabled = state.position === state.frames.length - 1;
  $('#desktop-status').textContent = `Frame ${state.position}/${state.frames.length - 1}   |   ${frame.operation || 'Initial state'}`;
  ['writes', 'copies', 'shifts', 'allocations'].forEach((metric) => {
    $(`#metric-${metric}`).textContent = String(frame.metrics?.[metric] || 0);
  });
  const source = frame.source;
  const hasSource = Boolean(source?.file && Number.isInteger(source.line) && source.line > 0);
  $('#source-jump').disabled = !hasSource;
  $('#menu-source').disabled = !hasSource;
  $('#source-reference').textContent = hasSource ? `${source.file}:${source.line} · read this step in the source` : 'Choose an execution step to reveal its source';
  $('#reveal-line').disabled = !hasSource;
  $('#source-context-message').textContent = hasSource ? `${frame.message} ${source.file}, line ${source.line}.` : 'Select a mutation in the trace to connect it to a line in the Java implementation.';
  $$('#operation-queue li').forEach((item, index) => {
    const current = index === frame.operationIndex;
    const completed = index < frame.operationIndex || (current && phase === 'commit' && !growthCommit);
    item.classList.toggle('current', current);
    item.classList.toggle('completed', completed);
    item.querySelector('.queue-state').textContent = current ? (growthCommit ? 'grown' : phase === 'commit' ? 'complete' : phase) : completed ? '✓' : 'waiting';
  });
  highlightSource(false);
}

function renderQueue() {
  $('#queue-empty').hidden = state.trace.operations.length > 0;
  $('#queue-empty').textContent = 'No operations: the initial state is the complete trace.';
  const fragment = document.createDocumentFragment();
  state.trace.operations.forEach((operation, index) => {
    const item = document.createElement('li');
    const number = document.createElement('span');
    number.className = 'queue-index';
    number.textContent = String(index + 1).padStart(2, '0');
    const text = document.createElement('span');
    text.textContent = operation;
    const status = document.createElement('span');
    status.className = 'queue-state';
    status.textContent = 'waiting';
    item.append(number, text, status);
    fragment.append(item);
  });
  $('#operation-queue').replaceChildren(fragment);
}

function stopPlayback() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  $('#play').replaceChildren();
  const icon = document.createElement('span');
  icon.textContent = '▶';
  icon.setAttribute('aria-hidden', 'true');
  $('#play').append(icon, document.createTextNode(' Play trace'));
}

function stepTo(position) {
  state.position = Math.max(0, Math.min(position, state.frames.length - 1));
  renderFrame();
}

function togglePlayback() {
  if (state.frames.length <= 1) return;
  if (state.timer) return stopPlayback();
  if (state.position >= state.frames.length - 1) stepTo(0);
  $('#play').textContent = 'Ⅱ Pause';
  state.timer = setInterval(() => {
    stepTo(state.position + 1);
    if (state.position >= state.frames.length - 1) stopPlayback();
  }, 900);
}

function setMode(mode, updateHash = true) {
  if (!['follow', 'build', 'source'].includes(mode)) mode = 'follow';
  state.mode = mode;
  stopPlayback();
  closeMenus();
  $$('.view').forEach((view) => { view.hidden = view.id !== `view-${mode}`; });
  $$('.mode-nav [data-mode]').forEach((button) => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (updateHash) history.replaceState(null, '', `#${mode}`);
  if (mode === 'source') ensureSources();
  if (mode === 'build') renderStage();
}

async function ensureSources() {
  if (state.sourceListPromise) return state.sourceListPromise;
  if (state.sourcesLoaded) {
    if (!state.sourceFile) await loadSource('DynamicBuffer.java');
    return;
  }
  state.sourceListPromise = (async () => {
    try {
      const response = await fetch('/api/sources');
      const files = await readJson(response);
      if (!response.ok || !Array.isArray(files)) throw new Error('The project source list is unavailable.');
      const fragment = document.createDocumentFragment();
      files.forEach((file) => {
        const button = document.createElement('button');
        button.className = 'file-button';
        button.type = 'button';
        button.dataset.file = file.file;
        button.append(document.createTextNode(file.file));
        const label = document.createElement('small');
        label.textContent = file.label || 'Java source';
        button.append(label);
        button.addEventListener('click', () => loadSource(file.file));
        fragment.append(button);
      });
      $('#source-files').replaceChildren(fragment);
      state.sourcesLoaded = true;
      if (!state.sourceFile && files.length) await loadSource(files[0].file);
    } catch (error) {
      showSourceError('The source files could not be loaded. Make sure the Java server is running, then reopen this view.');
    } finally {
      state.sourceListPromise = null;
    }
  })();
  return state.sourceListPromise;
}

function showSourceError(message) {
  $('#source-error').textContent = message;
  $('#source-error').hidden = !message;
  if (message && !state.sourceFile) $('#source-code').replaceChildren();
}

async function loadSource(file, reveal = false) {
  const request = ++state.sourceRequest;
  showSourceError('');
  try {
    let source = state.sourceCache.get(file);
    if (!source) {
      const response = await fetch(`/api/source?file=${encodeURIComponent(file)}`);
      source = await readJson(response);
      if (!response.ok || typeof source.content !== 'string') throw new Error(source.error || 'This source file could not be read.');
      state.sourceCache.set(file, source);
    }
    if (request !== state.sourceRequest) return;
    state.sourceFile = file;
    $('#source-filename').textContent = file;
    const lines = source.content.split('\n');
    $('#source-lines').textContent = `${lines.length} LINES · JAVA`;
    const fragment = document.createDocumentFragment();
    lines.forEach((line, index) => {
      const row = document.createElement('div');
      const trimmed = line.trim();
      row.className = `source-line${/^(\/\/|\/\*|\*|\*\/)/.test(trimmed) ? ' comment' : /^(import|package) /.test(trimmed) ? ' import' : ''}`;
      row.dataset.line = String(index + 1);
      const number = document.createElement('span');
      number.className = 'line-number';
      number.textContent = String(index + 1);
      number.setAttribute('aria-hidden', 'true');
      const code = document.createElement('code');
      code.className = 'line-content';
      code.textContent = line || ' ';
      row.append(number, code);
      fragment.append(row);
    });
    $('#source-code').replaceChildren(fragment);
    $('#source-code').scrollTop = 0;
    $$('.file-button').forEach((button) => {
      button.classList.toggle('active', button.dataset.file === file);
      button.setAttribute('aria-pressed', String(button.dataset.file === file));
    });
    highlightSource(reveal);
  } catch (error) {
    if (request === state.sourceRequest) showSourceError(error.message || 'This source file is unavailable.');
  }
}

function highlightSource(reveal) {
  const source = state.frames[state.position]?.source;
  const activeLine = source?.file === state.sourceFile ? source.line : null;
  $$('.source-line.active-line').forEach((line) => { line.classList.remove('active-line'); line.removeAttribute('aria-current'); });
  if (!activeLine) return;
  const line = $(`.source-line[data-line="${Number(activeLine)}"]`);
  if (line) {
    line.classList.add('active-line');
    line.setAttribute('aria-current', 'true');
    if (reveal) {
      const viewer = $('#source-code');
      viewer.scrollTop += line.getBoundingClientRect().top - viewer.getBoundingClientRect().top - viewer.clientHeight / 3;
    }
  }
}

async function revealFrameSource() {
  const source = state.frames[state.position]?.source;
  if (!source?.file) return;
  setMode('source');
  await ensureSources();
  await loadSource(source.file, true);
}

function diagramNode(title, note) {
  const node = document.createElement('div');
  node.className = 'diagram-node';
  node.textContent = title;
  const detail = document.createElement('small');
  detail.textContent = note;
  node.append(detail);
  return node;
}

function renderStageDiagram(index) {
  const container = $('#stage-diagram');
  container.replaceChildren();
  if (index === 0 || index === 2) {
    [12, 27, 41, null].forEach((value, slotIndex) => {
      const cell = document.createElement('div');
      cell.className = `diagram-cell${value === null ? ' vacant' : ''}`;
      cell.textContent = value === null ? '·' : String(value);
      const number = document.createElement('small');
      number.textContent = `index ${slotIndex}`;
      cell.append(number);
      container.append(cell);
    });
    const caption = document.createElement('span');
    caption.className = 'diagram-caption';
    caption.textContent = index === 0 ? 'Concept sketch: size 3 / capacity 4' : 'Predict first. Then try insert 1 24 in the execution trace.';
    container.append(caption);
  } else {
    const nodes = index === 1 ? [['4 slots', 'Starting capacity'], ['6 slots', 'Balanced growth'], ['9 slots', 'Grow again']] : [['Your sequence', 'Browser input'], ['Java engine', 'Real mutations'], ['Trace frames', 'Browser display']];
    nodes.forEach(([title, note], position) => {
      if (position) {
        const arrow = document.createElement('span');
        arrow.className = 'diagram-arrow';
        arrow.textContent = '→';
        arrow.setAttribute('aria-hidden', 'true');
        container.append(arrow);
      }
      container.append(diagramNode(title, note));
    });
  }
}

function renderStage() {
  const stage = stages[state.stage];
  state.explored.add(state.stage);
  $('#build-progress').textContent = `${state.explored.size} of 4 explored`;
  $('#build-progress-track i').style.width = `${state.explored.size * 25}%`;
  $$('.stage-button').forEach((button) => {
    const active = Number(button.dataset.stage) === state.stage;
    button.classList.toggle('active', active);
    button.classList.toggle('visited', state.explored.has(Number(button.dataset.stage)));
    if (active) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
  });
  ['kicker', 'file', 'title', 'lead', 'goal', 'invariant'].forEach((key) => { $(`#stage-${key}`).textContent = stage[key]; });
  $('#exercise-question').textContent = stage.question;
  $('#exercise-feedback').textContent = '';
  const fragment = document.createDocumentFragment();
  stage.choices.forEach((choice, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = choice;
    button.addEventListener('click', () => {
      $$('#exercise-choices button').forEach((other) => { other.classList.remove('correct', 'incorrect'); other.setAttribute('aria-pressed', 'false'); });
      const correct = index === stage.answer;
      button.classList.add(correct ? 'correct' : 'incorrect');
      button.setAttribute('aria-pressed', 'true');
      $('#exercise-feedback').textContent = `${correct ? 'Exactly. ' : 'Try the reasoning: '}${stage.feedback}`;
    });
    fragment.append(button);
  });
  $('#exercise-choices').replaceChildren(fragment);
  $('#stage-next').textContent = state.stage === stages.length - 1 ? 'Open experiment' : 'Next chapter >';
  renderStageDiagram(state.stage);
}

$$('[data-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
window.addEventListener('hashchange', () => setMode(location.hash.slice(1), false));
$('#scenario').addEventListener('change', () => {
  const scenario = scenarios[$('#scenario').value];
  $('#initial').value = scenario.initial;
  $('#operations').value = scenario.operations;
  setError('');
  updateDraft();
});
$('#initial').addEventListener('input', updateDraft);
$('#operations').addEventListener('input', updateDraft);
$$('input[name="growth"]').forEach((input) => input.addEventListener('change', updateDraft));
$('#run').addEventListener('click', () => { setMode('follow'); requestTrace(); });
$('#previous').addEventListener('click', () => { stopPlayback(); stepTo(state.position - 1); });
$('#next').addEventListener('click', () => { stopPlayback(); stepTo(state.position + 1); });
$('#timeline').addEventListener('input', () => { stopPlayback(); stepTo(Number($('#timeline').value)); });
$('#play').addEventListener('click', togglePlayback);
document.addEventListener('visibilitychange', () => { if (document.hidden) stopPlayback(); });
$('#source-jump').addEventListener('click', revealFrameSource);
$('#reveal-line').addEventListener('click', revealFrameSource);
$('#command-action').addEventListener('change', () => {
  const action = $('#command-action').value;
  $('#command-index-label').hidden = action === 'append';
  $('#command-value-label').hidden = action === 'remove';
});
$('#add-command').addEventListener('click', () => {
  const action = $('#command-action').value;
  const index = $('#command-index').value.trim();
  const value = $('#command-value').value.trim();
  if (operationLines().length >= 32) { setError('A sequence can contain up to 32 operations. Remove a line before adding another.'); return; }
  if (action !== 'append' && !/^\d+$/.test(index)) { setError('Enter a nonnegative whole number for the index.'); $('#command-index').focus(); return; }
  if (action !== 'remove' && !/^-?\d+$/.test(value)) { setError('Enter a whole number for the value.'); $('#command-value').focus(); return; }
  const parts = [action];
  if (action !== 'append') parts.push(index);
  if (action !== 'remove') parts.push(value);
  const existing = $('#operations').value.trimEnd();
  $('#operations').value = `${existing}${existing ? '\n' : ''}${parts.join(' ')}`;
  setError('');
  updateDraft();
  $('#operations').focus();
  $('#operations').scrollTop = $('#operations').scrollHeight;
});
$$('.stage-button').forEach((button) => button.addEventListener('click', () => { state.stage = Number(button.dataset.stage); renderStage(); }));
$('#stage-next').addEventListener('click', () => {
  if (state.stage === stages.length - 1) return setMode('follow');
  state.stage += 1;
  renderStage();
});
$('#stage-source').addEventListener('click', async () => {
  const file = stages[state.stage].file;
  setMode('source');
  await ensureSources();
  await loadSource(file);
});
$('#about-button').addEventListener('click', () => $('#about-dialog').showModal());
$('#close-about').addEventListener('click', () => $('#about-dialog').close());
$('#about-source').addEventListener('click', () => { $('#about-dialog').close(); setMode('source'); });
$('#about-dialog').addEventListener('click', (event) => { if (event.target === $('#about-dialog')) $('#about-dialog').close(); });

function closeMenus() {
  $$('.app-menu[open]').forEach((menu) => { menu.open = false; });
}

function loadExample() {
  const example = scenarios.mixed;
  $('#scenario').value = 'mixed';
  $('#initial').value = example.initial;
  $('#operations').value = example.operations;
  $('input[name="growth"][value="double"]').checked = true;
  setError('');
  setMode('follow');
  updateDraft();
  $('#operations').focus();
}

$('#menu-new').addEventListener('click', () => {
  $('#initial').value = '';
  $('#operations').value = '';
  setError('');
  setMode('follow');
  updateDraft();
  $('#initial').focus();
});
$('#menu-example').addEventListener('click', loadExample);
$('#toolbar-example').addEventListener('click', loadExample);
$('#menu-run').addEventListener('click', () => { setMode('follow'); requestTrace(); });
$('#menu-first').addEventListener('click', () => { setMode('follow'); stepTo(0); });
$('#menu-last').addEventListener('click', () => { setMode('follow'); stepTo(state.frames.length - 1); });
$('#menu-source').addEventListener('click', revealFrameSource);
$('#title-help').addEventListener('click', () => $('#about-dialog').showModal());
$('#window-maximize').addEventListener('click', () => {
  const maximized = $('.app-shell').classList.toggle('maximized');
  const label = maximized ? 'Restore application window' : 'Maximize application window';
  $('#window-maximize').setAttribute('aria-label', label);
  $('#window-maximize').title = label;
  $('#window-maximize').querySelector('span').textContent = maximized ? '▣' : '□';
});
$$('.app-menu').forEach((menu) => {
  menu.addEventListener('toggle', () => {
    if (menu.open) $$('.app-menu').forEach((other) => { if (other !== menu) other.open = false; });
  });
  menu.querySelectorAll('button').forEach((button) => button.addEventListener('click', closeMenus));
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.app-menu')) closeMenus();
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { closeMenus(); stopPlayback(); }
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !$('#about-dialog').open) {
    event.preventDefault();
    setMode('follow');
    requestTrace();
  }
});

$('#menu-first').disabled = true;
$('#menu-last').disabled = true;
$('#menu-source').disabled = true;

setMode(location.hash.slice(1) || 'follow', false);
updateDraft();
requestTrace();
