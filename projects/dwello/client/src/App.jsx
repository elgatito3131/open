import React, { useEffect, useRef, useState } from 'react';

const INITIAL_MONTH = '2026-10';
const money = (cents) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format((cents || 0) / 100);
const dateLabel = (date) => date ? new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const monthLabel = (month) => new Date(`${month}-01T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const pretty = (value) => typeof value === 'string' ? value : JSON.stringify(value, null, 2);
const CLIENT_REQUEST_SOURCE = { file: 'client/src/App.jsx', marker: 'client-request' };
const CLIENT_UPDATE_SOURCE = { file: 'client/src/App.jsx', marker: 'client-update' };

// These are observed client events, added to the trace returned by the server.
// Reading or replaying a trace never sends the mutation again.
// trace:client-request:start
async function request(method, path, body) {
  const requestStep = { label: 'React sends a request', layer: 'React', detail: `${method} ${path}`, source: CLIENT_REQUEST_SOURCE, result: body || 'Read the current ledger.' };
  let response, payload;
  try {
    response = await fetch(path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    payload = await response.json();
  } catch {
    const message = method === 'GET' ? 'Could not read the ledger. Check that the local API is running, then refresh.' : 'Could not confirm the result. Refresh the ledger before retrying.';
    const error = new Error(message);
    error.uncertain = method !== 'GET';
    error.trace = [requestStep, { label: 'Response not confirmed', layer: 'React', detail: message, source: CLIENT_REQUEST_SOURCE }];
    throw error;
  }
  const trace = [requestStep, ...(payload.trace || [])];
  if (!response.ok) {
    const error = new Error(payload.error?.message || `Request failed (${response.status}).`);
    error.trace = trace;
    throw error;
  }
  return { ...payload, trace };
}
// trace:client-request:end

function HouseMark() {
  return <svg viewBox="0 0 36 36" aria-hidden="true"><path d="M3 17 18 4l15 13M8 14v17h20V14M15 31V20h6v11" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" /><path d="M25 5v6" stroke="currentColor" strokeWidth="2.6" /></svg>;
}

function Building({ units, selectedId, onSelect }) {
  const floors = [...new Set(units.map((unit) => unit.floor))].sort((a, b) => b - a);
  const occupied = units.filter((unit) => unit.lease).length;
  return <section className="building-section" aria-labelledby="building-heading">
    <div className="section-heading"><span className="section-number">01</span><h2 id="building-heading">The building</h2><span className="quiet">{occupied} of {units.length} occupied</span></div>
    <p className="section-description">Choose a unit. Its people and paperwork live next door.</p>
    <div className="building" aria-label="Units by floor">
      <div className="roof"><span>JUNIPER HOUSE</span><span className="roof-chimney" /></div>
      <div className="building-floors">
        {floors.map((floor) => <div className="building-floor" key={floor}>
          <span className="floor-label" aria-hidden="true">{String(floor).padStart(2, '0')}</span>
          {units.filter((unit) => unit.floor === floor).sort((a, b) => String(a.number).localeCompare(String(b.number))).map((unit) => <button
            key={unit.id}
            className={`unit ${unit.lease ? 'occupied' : 'vacant'} ${selectedId === unit.id ? 'selected' : ''}`}
            aria-pressed={selectedId === unit.id}
            aria-label={`Unit ${unit.number}, ${unit.lease ? unit.lease.tenant.name : 'vacant'}`}
            onClick={() => onSelect(unit.id)}
          >
            <span className="unit-topline"><strong>{unit.number}</strong><span className="unit-status">{unit.lease ? 'At home' : 'Available'}</span></span>
            <span className="room-picture" aria-hidden="true"><span className="room-window"><i /><i /><i /><i /></span><span className="room-door"><i /></span><span className="room-plant"><i /></span></span>
            <span className="unit-person">{unit.lease?.tenant.name || 'A new beginning'}</span>
            <span className="unit-meta">{unit.bedrooms} {unit.bedrooms === 1 ? 'bedroom' : 'bedrooms'} · {money(unit.lease?.monthlyRentCents ?? unit.monthlyRentCents)} / mo</span>
          </button>)}
        </div>)}
      </div>
      <div className="building-foundation"><span>← Click a door to open its ledger</span><span>EST. 2026</span></div>
    </div>
    <div className="building-key"><span><i className="key-occupied" /> Occupied</span><span><i className="key-vacant" /> Available</span><span><i className="key-selected" /> Selected</span></div>
  </section>;
}

function LeaseForm({ unit, month, onSubmit, busy }) {
  const [startDate, setStartDate] = useState(`${month}-01`);
  return <form className="ledger-form" onSubmit={(event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    onSubmit({ unitId: unit.id, name: values.get('name').trim(), email: values.get('email').trim(), startDate: values.get('startDate'), endDate: values.get('endDate'), monthlyRentCents: Math.round(Number(values.get('rent')) * 100) });
  }}>
    <div className="vacant-note"><span className="handwritten">Room for someone new.</span><p>Add a fictional tenant to create a lease. Both records are saved together.</p></div>
    <label>Tenant’s name<input name="name" autoComplete="off" required maxLength="100" placeholder="e.g. Maya Reed" disabled={busy} /></label>
    <label>Email address<input name="email" type="email" autoComplete="off" required maxLength="254" placeholder="maya@example.test" disabled={busy} /></label>
    <div className="form-pair">
      <label>Lease starts<input name="startDate" type="date" required value={startDate} onChange={(event) => setStartDate(event.target.value)} disabled={busy} /></label>
      <label>Lease ends<input name="endDate" type="date" required min={startDate} defaultValue={`${Number(month.slice(0, 4)) + 1}-09-30`} disabled={busy} /></label>
    </div>
    <label>Monthly rent <span className="field-unit">USD</span><input name="rent" type="number" required min="0.01" max="100000" step="0.01" defaultValue={(unit.monthlyRentCents / 100).toFixed(2)} disabled={busy} /></label>
    <button className="button primary" type="submit" disabled={busy}>{busy ? 'Saving lease…' : 'Create tenant + lease'}<span aria-hidden="true">↗</span></button>
    <p className="form-footnote">Whole-month leases · start on the first, end on the last day. End date included.</p>
  </form>;
}

function PaymentForm({ lease, month, onSubmit, busy }) {
  return <form className="payment-form" onSubmit={async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const saved = await onSubmit({ leaseId: lease.id, month, amountCents: Math.round(Number(values.get('amount')) * 100), paidOn: values.get('paidOn'), method: values.get('method'), note: values.get('note').trim() });
    if (saved) form.reset();
  }}>
    <h4>Record a payment</h4>
    <div className="form-pair"><label>Amount <span className="field-unit">USD</span><input name="amount" type="number" min="0.01" max="100000" step="0.01" placeholder="0.00" required disabled={busy} /></label><label>Paid on<input name="paidOn" type="date" required defaultValue={`${month}-04`} disabled={busy} /></label></div>
    <div className="form-pair"><label>Method<select name="method" defaultValue="bank" disabled={busy}><option value="bank">Bank transfer</option><option value="cash">Cash</option><option value="check">Check</option></select></label><label>Note <span className="optional">optional</span><input name="note" maxLength="200" placeholder="e.g. October rent" disabled={busy} /></label></div>
    <button className="button primary" type="submit" disabled={busy}>{busy ? 'Recording…' : 'Record payment'}<span aria-hidden="true">↗</span></button>
    <p className="form-footnote">This records a payment. It does not transfer money.</p>
  </form>;
}

function UnitLedger({ unit, month, onLease, onPayment, busy }) {
  const lease = unit.lease;
  return <section className="unit-ledger" aria-labelledby="unit-heading">
    <div className="section-heading"><span className="section-number">02</span><h2 id="unit-heading">Unit {unit.number}</h2><span className={`ledger-status ${lease ? '' : 'is-vacant'}`}>{lease ? 'Leased' : 'Available'}</span></div>
    {lease ? <>
      <div className="tenant-heading"><div className="tenant-initial" aria-hidden="true">{lease.tenant.name.charAt(0)}</div><div><h3>{lease.tenant.name}</h3><p>{lease.tenant.email}</p></div></div>
      <dl className="lease-facts"><div><dt>Lease term</dt><dd>{dateLabel(lease.startDate)} — {dateLabel(lease.endDate)}</dd></div><div><dt>Monthly rent</dt><dd>{money(lease.monthlyRentCents)}</dd></div></dl>
      <div className="payment-summary"><span>{monthLabel(month)}</span><div><span>Received <strong>{money(lease.paidCents)}</strong></span><span>{lease.balanceCents < 0 ? 'Credit' : 'Balance'} <strong className={lease.balanceCents <= 0 ? 'paid' : ''}>{money(Math.abs(lease.balanceCents))}</strong></span></div></div>
      <div className="payments"><h4>Payment ledger <span>{lease.payments.length} {lease.payments.length === 1 ? 'entry' : 'entries'}</span></h4>
        {lease.payments.length ? <div className="table-scroll"><table><caption className="sr-only">Payments for {monthLabel(month)}</caption><thead><tr><th>Date</th><th>Method / note</th><th>Amount</th></tr></thead><tbody>{lease.payments.map((payment) => <tr key={payment.id}><td>{dateLabel(payment.paidOn)}</td><td>{payment.method === 'bank' ? 'Bank transfer' : payment.method}<small>{payment.note || '—'}</small></td><td>{money(payment.amountCents)}</td></tr>)}</tbody></table></div> : <p className="empty-ledger">No payments recorded for this month.</p>}
      </div>
      <PaymentForm key={`${lease.id}-${month}`} lease={lease} month={month} onSubmit={onPayment} busy={busy} />
    </> : <LeaseForm key={`${unit.id}-${month}`} unit={unit} month={month} onSubmit={onLease} busy={busy} />}
  </section>;
}

function RequestTrace({ trace, revision, operation }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [source, setSource] = useState(null);
  const [sourceError, setSourceError] = useState('');
  const step = trace[index];
  useEffect(() => { setIndex(0); setPlaying(false); }, [revision]);
  useEffect(() => {
    if (!playing) return undefined;
    if (index >= trace.length - 1) { setPlaying(false); return undefined; }
    const timer = window.setTimeout(() => setIndex((value) => value + 1), 1500);
    return () => window.clearTimeout(timer);
  }, [playing, index, trace.length]);
  useEffect(() => {
    if (!showSource || !step?.source?.file) return undefined;
    const controller = new AbortController();
    setSource(null); setSourceError('');
    fetch(`/api/source?file=${encodeURIComponent(step.source.file)}`, { signal: controller.signal }).then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || 'Could not load this source file.');
      setSource(payload);
    }).catch((error) => { if (error.name !== 'AbortError') setSourceError(error.message); });
    return () => controller.abort();
  }, [showSource, step?.source?.file]);
  const sourceLines = source?.content?.split('\n') || [];
  const markerStart = step?.source?.marker ? sourceLines.findIndex((line) => line.trim() === `// trace:${step.source.marker}:start`) : -1;
  const markerEnd = step?.source?.marker ? sourceLines.findIndex((line) => line.trim() === `// trace:${step.source.marker}:end`) : -1;
  const sourceRange = markerStart >= 0 && markerEnd > markerStart ? { startLine: markerStart + 2, endLine: markerEnd } : step?.source?.startLine ? step.source : null;
  const first = Math.max(0, (sourceRange?.startLine || 1) - 4);
  const last = Math.min(sourceLines.length, (sourceRange?.endLine || first + 18) + 3);
  return <section className="request-trace" id="how-it-works" aria-labelledby="trace-heading">
    <div className="trace-topline"><div><span className="eyebrow">OPEN THE WALLS</span><h2 id="trace-heading">Follow the request.</h2><p>React → Node.js → PostgreSQL → back to your ledger.</p></div><span className="trace-stamp">REAL REQUEST<br />REAL SOURCE</span></div>
    <div className="trace-toolbar"><div className="trace-controls"><button className="button play" disabled={!trace.length} onClick={() => { if (index === trace.length - 1) setIndex(0); setPlaying(!playing); }}>{playing ? 'Ⅱ Pause' : '▶ Play'}</button><button className="button" disabled={index === 0} onClick={() => { setPlaying(false); setIndex(index - 1); }}>← Back</button><button className="button" disabled={!trace.length || index === trace.length - 1} onClick={() => { setPlaying(false); setIndex(index + 1); }}>Next →</button><button className="button" disabled={!trace.length} onClick={() => { setPlaying(false); setIndex(0); }}>Reset</button></div><button className={`button source-toggle ${showSource ? 'active' : ''}`} aria-pressed={showSource} onClick={() => setShowSource(!showSource)}>{showSource ? 'Hide source' : 'Show source'} <span aria-hidden="true">{'{ }'}</span></button></div>
    <p className="trace-caption"><span className="request-dot" />{operation || 'Waiting for the first request'}<span>Replay shows recorded steps; it never saves twice.</span></p>
    {step ? <div className={`trace-body ${showSource ? 'with-source' : ''}`}>
      <div className="trace-explanation"><ol className="trace-steps" aria-label="Request steps">{trace.map((item, itemIndex) => <li key={`${revision}-${itemIndex}`}><button aria-current={index === itemIndex ? 'step' : undefined} onClick={() => { setPlaying(false); setIndex(itemIndex); }}><span>{String(itemIndex + 1).padStart(2, '0')}</span><span>{item.label}<small>{item.layer}</small></span>{index === itemIndex && <b aria-hidden="true">←</b>}</button></li>)}</ol><div className="step-detail" aria-live="polite"><span className="step-layer">{step.layer} · Step {index + 1} / {trace.length}</span><h3>{step.label}</h3><p>{typeof step.detail === 'string' ? step.detail : pretty(step.detail)}</p>{step.sql && <><span className="code-label">Query</span><pre className="sql-preview">{step.sql}</pre></>}{step.parameters && <details><summary>Bound values</summary><pre>{pretty(step.parameters)}</pre></details>}{step.result !== undefined && <details><summary>Observed result</summary><pre>{pretty(step.result)}</pre></details>}</div></div>
      {showSource && <div className="source-pane"><div className="source-heading"><span>{step.source?.file || 'No source reference'}</span>{sourceRange && <span>L{sourceRange.startLine}–{sourceRange.endLine}</span>}</div>{sourceError ? <p role="alert" className="source-message">{sourceError}</p> : !step.source ? <p className="source-message">This step does not have a source reference.</p> : source ? <pre className="source-code" tabIndex="0" aria-label={`Source code from ${source.file}`}>{sourceLines.slice(first, last).map((line, lineIndex) => { const number = first + lineIndex + 1; return <span key={number} className={sourceRange && number >= sourceRange.startLine && number <= sourceRange.endLine ? 'line-highlight' : ''}><i aria-hidden="true">{number}</i><code>{line || ' '}</code>{'\n'}</span>; })}</pre> : <p className="source-message">Opening source…</p>}</div>}
    </div> : <p className="trace-waiting">Open the ledger, create a lease, or record a payment to follow its real request.</p>}
  </section>;
}

export default function App() {
  const [month, setMonth] = useState(INITIAL_MONTH);
  const [ledger, setLedger] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [trace, setTrace] = useState([]);
  const [revision, setRevision] = useState(0);
  const [operation, setOperation] = useState('');
  const loadSequence = useRef(0);
  const setRecordedTrace = (steps, label) => { setTrace(steps); setRevision((value) => value + 1); setOperation(label); };

  // trace:client-update:start
  async function loadLedger({ preserveTrace = false } = {}) {
    const sequence = ++loadSequence.current;
    const payload = await request('GET', `/api/ledger?month=${month}`);
    if (sequence !== loadSequence.current) return;
    setLedger(payload.data);
    setNeedsRefresh(false);
    setSelectedId((current) => payload.data.units.some((unit) => unit.id === current) ? current : (payload.data.units.find((unit) => unit.number === '101') || payload.data.units[0])?.id);
    if (!preserveTrace) setRecordedTrace([...payload.trace, { label: 'React displays the ledger', layer: 'React', detail: `${payload.data.units.length} units loaded from PostgreSQL. Choose one to inspect its lease.`, source: CLIENT_UPDATE_SOURCE }], `GET /api/ledger · ${monthLabel(month)}`);
  }
  // trace:client-update:end

  useEffect(() => {
    setLoading(true); setLedger(null); setError(''); setNotice('');
    loadLedger().catch((requestError) => { setError(requestError.message); if (requestError.trace) setRecordedTrace(requestError.trace, 'The ledger request failed'); }).finally(() => setLoading(false));
  }, [month]);

  async function mutate(path, body, successMessage) {
    setBusy(true); setError(''); setNotice('');
    let saved = false;
    try {
      const result = await request('POST', path, body);
      saved = true;
      setRecordedTrace(result.trace, `POST ${path} · saved`);
      try {
        await loadLedger({ preserveTrace: true });
        setRecordedTrace([...result.trace, { label: 'React refreshes this ledger', layer: 'React', detail: 'The write succeeded. A fresh GET /api/ledger returned the persisted records, and React updated the building and unit details.', source: CLIENT_UPDATE_SOURCE, result: result.data }], `POST ${path} · saved`);
        setNotice(successMessage);
      } catch (refreshError) {
        setNeedsRefresh(true);
        setError(`Saved successfully, but the ledger could not refresh: ${refreshError.message} Use Refresh ledger before entering another record.`);
      }
    } catch (requestError) {
      setError(requestError.message);
      if (requestError.uncertain) setNeedsRefresh(true);
      if (requestError.trace) setRecordedTrace(requestError.trace, `POST ${path} · ${requestError.uncertain ? 'outcome unknown' : 'not saved'}`);
    } finally { setBusy(false); }
    return saved;
  }

  const selectedUnit = ledger?.units.find((unit) => unit.id === selectedId);
  return <>
    <header className="masthead"><a href="#" className="wordmark" aria-label="Dwello home"><HouseMark /><span>dwello<span className="wordmark-dot">.</span></span></a><span className="masthead-label">THE PROPERTY LEDGER</span><a className="text-link" href="#how-it-works">How it works <span aria-hidden="true">↘</span></a></header>
    <main>
      <section className="introduction"><div><p className="eyebrow">A HOME FOR EVERY LITTLE DETAIL</p><h1>Good homes.<br /><em>Clear records.</em></h1></div><div className="intro-note"><span className="note-number">№ 001</span><p>A small building, its people,<br />and the records that connect them.</p><span className="demo-label">Fictional records · Original learning rebuild</span></div></section>
      <div className="property-bar"><div><span className="property-marker" aria-hidden="true">⌂</span><div><h2>{ledger?.property.name || 'Juniper House'}</h2><p>{ledger ? `${ledger.property.address}${ledger.property.city ? ` · ${ledger.property.city}` : ''}` : 'Opening the property ledger…'}</p></div></div><label className="month-picker">Ledger month<input type="month" aria-label="Ledger month" value={month} onChange={(event) => { if (event.target.value) setMonth(event.target.value); }} disabled={busy || loading} /></label></div>
      <div className="message-area" aria-live="polite">{error && <div className="message error" role="alert"><strong>Something needs attention.</strong><p>{error}</p><button className="text-button" disabled={busy || loading} onClick={() => { setLoading(true); setError(''); loadLedger().catch((err) => setError(err.message)).finally(() => setLoading(false)); }}>Refresh ledger ↻</button></div>}{notice && <div className="message success"><span aria-hidden="true">✓</span> {notice}<a href="#how-it-works">Follow this request ↘</a></div>}</div>
      {loading ? <div className="loading-ledger" role="status"><HouseMark /><h2>Opening the ledger…</h2><p>Reading the latest records from PostgreSQL.</p></div> : ledger?.month === month && ledger.units.length ? <div className="ledger-spread" id="building"><Building units={ledger.units} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setNotice(''); }} />{selectedUnit && <UnitLedger unit={selectedUnit} month={month} onLease={(body) => mutate('/api/leases', body, 'A tenant and lease are now on the books.')} onPayment={(body) => mutate('/api/payments', body, 'Payment recorded. The balance is up to date.')} busy={busy || needsRefresh} />}</div> : <div className="loading-ledger"><h2>{ledger ? 'No units in this property yet.' : 'The ledger is waiting.'}</h2><p>{ledger ? 'Add property and unit seed records to explore the building.' : 'The local API and PostgreSQL database need to be running.'}</p></div>}
      <RequestTrace trace={trace} revision={revision} operation={operation} />
    </main>
    <footer><a className="footer-brand" href="#">dwello.</a><p>Built to live in. Open to learn from.</p><span>REACT / NODE.JS / POSTGRESQL</span></footer>
  </>;
}
