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

function Building({ units, property, onSelect }) {
  const floors = [...new Set(units.map((unit) => unit.floor))].sort((a, b) => b - a);
  return <section className="neighborhood" aria-label={`${property.name}. Choose a window to open a unit.`}>
    <div className="world">
      <svg className="street-art" viewBox="0 0 1200 640" aria-hidden="true">
        <defs><pattern id="brick" width="48" height="24" patternUnits="userSpaceOnUse"><path d="M0 0H48M0 12H48M24 0V12M0 12V24M48 12V24" fill="none" stroke="#ba8870" strokeWidth="1" opacity=".5" /></pattern><pattern id="paving" width="80" height="20" patternUnits="userSpaceOnUse"><path d="M0 0H80M40 0V20" stroke="#b8b1a1" fill="none" /></pattern><pattern id="grain" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M1 1h1M5 5h1" stroke="#e2e6ce" opacity=".2" /></pattern></defs>
        <rect width="1200" height="640" fill="#bfcfc8" /><rect y="386" width="1200" height="140" fill="#aebba1" />
        <g fill="#e4e4d2"><path d="M81 106h35V94h42V82h54v12h35v24H81z" /><path d="M919 71h24V57h52V43h45v13h34v15h34v17H919z" /></g>
        <g fill="#97aaa3" stroke="#8a9d96" strokeWidth="2"><path d="M0 300h74v-97h118v160h52v-73h117v215H0z" /><path d="M903 272h78v-71h112v100h107v204H903z" /></g>
        <g fill="#bac9ba"><path d="M89 225h18v25H89zm42 0h18v25h-18zm0 48h18v25h-18zm-42 0h18v25H89zm188 50h17v26h-17zm37 0h17v26h-17zM998 220h18v27h-18zm42 0h18v27h-18zm-42 48h18v27h-18zm42 0h18v27h-18z" /></g>
        <path d="M0 515H1200V565H0z" fill="#cac5b4" /><path d="M0 515H1200V565H0z" fill="url(#paving)" /><path d="M0 565H1200V640H0z" fill="#767f79" /><path d="M0 566H1200" stroke="#e3dbc4" strokeWidth="7" /><path d="M0 616H1200" stroke="#c5c1a5" strokeWidth="3" strokeDasharray="42 40" />
        <path d="M350 539l505-1 58 27H430z" fill="#8d9383" opacity=".4" />
        <path d="M807 120l52 25v385l-52 12z" fill="#af775f" stroke="#615650" strokeWidth="3" /><path d="M361 126h446v413H361z" fill="#d8ae87" stroke="#615650" strokeWidth="3" /><path d="M361 126h446v413H361z" fill="url(#brick)" />
        <path d="M346 114l34-33h401l49 33v18H346z" fill="#556c63" stroke="#42574f" strokeWidth="3" /><path d="M830 114l38 21v18l-38-21z" fill="#384e47" /><path d="M346 119h484v13H346z" fill="#708276" />
        <path d="M704 53h37v36h-37z" fill="#9c6a55" stroke="#615650" strokeWidth="3" /><path d="M699 50h47v9h-47z" fill="#c09978" stroke="#615650" strokeWidth="2" />
        <path d="M364 259h440M364 385h440" stroke="#a57962" strokeWidth="5" /><path d="M364 262h440M364 388h440" stroke="#ebc69a" strokeWidth="3" />
        <path d="M350 523h468v12H350zM339 535h490v11H339z" fill="#8f9280" stroke="#696c61" strokeWidth="2" />
        <g stroke="#716954" strokeWidth="5" fill="none"><path d="M191 515V343m0 62-30-35m30 1 25-31M993 520V365m0 45 31-32m-31 1-25-38" /></g>
        <g stroke="#637f65" strokeWidth="3" fill="#82986d"><path d="M154 381h-16v-47h15v-26h24v-15h32v15h22v26h17v46h-18v19h-58v-18z" /><path d="M952 374h-12v-41h16v-24h25v-16h37v20h23v25h11v45h-21v15h-56v-24z" /></g>
        <g fill="#a1b17f"><path d="M150 335h21v-18h28v-13h-17v10h-23v18h-9z" /><path d="M955 338h22v-18h34v-14h-28v11h-19v12h-9z" /></g>
        <g stroke="#4e6258" strokeWidth="3"><path d="M277 510V364" /><path d="M266 362h23l-4-33h-15z" fill="#efda9b" /><path d="M264 328h28" /></g>
        <g stroke="#625e4d" strokeWidth="3"><path d="M906 510v-34m-77 34v-34" /><path d="M818 454h98v11h-98zm0 19h98v10h-98z" fill="#b68c60" /></g>
        <g fill="#779270"><path d="M285 514v-14h14v-10h21v12h16v-16h23v28z" /><path d="M869 517v-18h18v-10h15v10h24v18z" /></g>
        <g stroke="#6c6755" strokeWidth="3"><path d="M110 550v-77" /><path d="M70 457h116v31H70z" fill="#ece0bf" /></g>
        <text x="128" y="477" textAnchor="middle" fontFamily="monospace" fontSize="11" fill="#526258">JUNIPER LANE</text>
        <g transform="translate(1035 530)"><path d="M0 0h60v27H0z" fill="#537779" stroke="#425c5d" strokeWidth="3" /><path d="M12-14h34l12 15H4z" fill="#779c99" stroke="#425c5d" strokeWidth="3" /><path d="M15-10h12V0H9zm17 0h12l9 10H32z" fill="#c9d6c4" /><circle cx="13" cy="28" r="8" fill="#535951" /><circle cx="48" cy="28" r="8" fill="#535951" /><path d="M3 12h7m43 0h7" stroke="#e9ce8d" strokeWidth="4" /></g>
        <path d="M235 529l8-8 9 9h9l-2 10h-20l-2-7h-8m12-12v-7l7 5" fill="#785b45" stroke="#664d3c" strokeWidth="2" />
        <rect width="1200" height="640" fill="url(#grain)" pointerEvents="none" />
      </svg>
      <h1 className="house-sign">{property.name}</h1>
      <div className="facade-windows" aria-label="Apartment windows">
        {floors.flatMap((floor) => units.filter((unit) => unit.floor === floor).sort((a, b) => String(a.number).localeCompare(String(b.number))).map((unit) => <button
            key={unit.id}
            id={`unit-door-${unit.id}`}
            className={`apartment-window ${unit.lease ? 'occupied' : 'vacant'}`}
            aria-label={`Unit ${unit.number}, ${unit.lease ? unit.lease.tenant.name : 'vacant'}`}
            onClick={() => onSelect(unit.id)}
          >
            <span className="window-frame" aria-hidden="true"><i className="curtain left" /><i className="curtain right" /><i className="window-glow" /><span className="window-number">{unit.number}</span><i className="window-flower" /></span>
            <span className="nameplate">{unit.lease?.tenant.name || 'To let'}<span className="visit-arrow" aria-hidden="true">↗</span></span>
          </button>))}
      </div>
      <p className="scene-prompt">Click a window. Come on in.</p>
    </div>
    <p className="street-address">{property.address}{property.city ? ` · ${property.city}` : ''} <span>A fictional neighborhood. Make yourself at home.</span></p>
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
    <div className="paper-kicker">JUNIPER HOUSE / {lease ? 'LEASE & RECEIPTS' : 'NEW LEASE'}</div>
    <div className="section-heading"><h1 id="unit-heading" tabIndex="-1">Unit {unit.number}</h1><span className={`ledger-status ${lease ? '' : 'is-vacant'}`}>{lease ? 'Leased' : 'Available'}</span></div>
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
  const [view, setView] = useState('building');
  const [traceReturnView, setTraceReturnView] = useState('building');
  const lastFocusedView = useRef('building');
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
    let cancelled = false;
    setLoading(true); setLedger(null); setError(''); setNotice('');
    loadLedger().catch((requestError) => { if (cancelled) return; setError(requestError.message); if (requestError.trace) setRecordedTrace(requestError.trace, 'The ledger request failed'); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [month]);

  useEffect(() => {
    if (loading) return;
    if (view === 'unit') document.getElementById('unit-heading')?.focus({ preventScroll: true });
    if (view === 'trace') document.getElementById('trace-view-heading')?.focus({ preventScroll: true });
    if (view === 'building' && lastFocusedView.current !== 'building') document.getElementById(`unit-door-${selectedId}`)?.focus({ preventScroll: true });
    lastFocusedView.current = view;
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, [view, loading]);

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key !== 'Escape' || busy || event.defaultPrevented) return;
      if (view === 'building') return;
      event.preventDefault();
      setView(view === 'trace' ? traceReturnView : 'building');
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [view, traceReturnView, busy]);

  function openTrace() { setTraceReturnView(view === 'trace' ? traceReturnView : view); setView('trace'); }

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
    <header className="masthead"><button className="wordmark" aria-label="Dwello home" onClick={() => setView('building')}><HouseMark /><span>dwello<span className="wordmark-dot">.</span></span></button><span className="toolbar-place">a little place to call home</span><label className="month-picker"><span>Visit in</span><input type="month" aria-label="Ledger month" value={month} onChange={(event) => { if (event.target.value) setMonth(event.target.value); }} disabled={busy || loading} /></label><button className={`text-link ${view === 'trace' ? 'active' : ''}`} onClick={openTrace}>How it works <span aria-hidden="true">↗</span></button></header>
    <main className={`app-view view-${view}`}>
      {view !== 'building' && <div className="view-navigation"><button className="back-button" onClick={() => setView(view === 'trace' ? traceReturnView : 'building')}>← {view === 'trace' && traceReturnView === 'unit' ? `Back to unit ${selectedUnit?.number || ''}` : 'Back to the building'}</button>{view === 'unit' && <span>Take your time. The paperwork’s right here.</span>}{view === 'trace' && <h1 id="trace-view-heading" className="sr-only" tabIndex="-1">How Dwello works</h1>}</div>}
      <div className="message-area" aria-live="polite">{error && <div className="message error" role="alert"><strong>Something needs attention.</strong><p>{error}</p><button className="text-button" disabled={busy || loading} onClick={() => { setLoading(true); setError(''); loadLedger().catch((err) => setError(err.message)).finally(() => setLoading(false)); }}>Refresh ledger ↻</button></div>}{notice && <div className="message success"><span aria-hidden="true">✓</span> {notice}<button className="text-button" onClick={openTrace}>Follow this request ↗</button></div>}</div>
      {view === 'trace' ? <RequestTrace trace={trace} revision={revision} operation={operation} /> : loading ? <div className="loading-ledger" role="status"><HouseMark /><h2>Just getting the keys…</h2><p>Opening this month’s records.</p></div> : ledger?.month === month && ledger.units.length ? view === 'building' ? <Building units={ledger.units} property={ledger.property} onSelect={(id) => { setSelectedId(id); setNotice(''); setView('unit'); }} /> : selectedUnit && <div className="paper-desk"><UnitLedger unit={selectedUnit} month={month} onLease={(body) => mutate('/api/leases', body, 'A tenant and lease are now on the books.')} onPayment={(body) => mutate('/api/payments', body, 'Payment recorded. The balance is up to date.')} busy={busy || needsRefresh} /><span className="paper-edge" aria-hidden="true" /></div> : <div className="loading-ledger"><h2>{ledger ? 'No units in this property yet.' : 'The ledger is waiting.'}</h2><p>{ledger ? 'Add property and unit seed records to explore the building.' : 'The local API and PostgreSQL database need to be running.'}</p></div>}
    </main>
  </>;
}
