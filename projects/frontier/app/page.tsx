"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Mode = "keyword" | "semantic";
type Lab = {
  id: string; name: string; institution: string; discipline: string;
  summary: string; topics: string[]; location: string; focus: string;
  methods: string[]; provenance: { kind: string; note: string; source: string };
  score: number; matched_terms: string[];
};
type TraceStep = { step: number; title: string; description: string; file: string; lineStart: number; lineEnd: number; snippet: string };
type SearchResult = { query: string; mode: Mode; discipline: string; total: number; results: Lab[]; trace: TraceStep[]; embedding: { model: string; dimensions: number; available: boolean } };
type Health = { status: string; database: string; semantic: { available: boolean; model: string; dimensions: number }; dataset: { count: number; fictional: boolean } };
type SearchState = { query: string; mode: Mode; discipline: string };

const EXAMPLES = ["robots that learn from people", "climate resilient cities", "privacy in machine learning"];

function readLocation(): SearchState {
  const params = new URLSearchParams(window.location.search);
  return { query: params.get("q") ?? "", mode: params.get("mode") === "semantic" ? "semantic" : "keyword", discipline: params.get("discipline") ?? "" };
}

async function responseJson<T>(response: Response): Promise<T> {
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = value?.detail;
    throw new Error(typeof detail === "string" ? detail : response.status === 422 ? "Please shorten your question or choose a valid search option." : `The research service could not respond (${response.status}). Please try again.`);
  }
  if (!value) throw new Error("The research service returned an empty response. Please try again.");
  return value as T;
}

export default function Frontier() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("keyword");
  const [discipline, setDiscipline] = useState("");
  const [disciplines, setDisciplines] = useState<string[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState("");
  const [result, setResult] = useState<SearchResult | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showTrace, setShowTrace] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [source, setSource] = useState<{ file: string; source: string } | null>(null);
  const [sourceError, setSourceError] = useState("");
  const [sourceLoading, setSourceLoading] = useState(false);
  const [showFullSource, setShowFullSource] = useState(false);
  const request = useRef<AbortController | null>(null);
  const requestNumber = useRef(0);
  const searchInput = useRef<HTMLInputElement>(null);
  const traceRef = useRef<HTMLElement>(null);

  const runSearch = useCallback(async (state: SearchState, push = true) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const sequence = ++requestNumber.current;
    setQuery(state.query); setMode(state.mode); setDiscipline(state.discipline);
    setLoading(true); setError(""); setPlaying(false); setStep(0);
    const params = new URLSearchParams();
    if (state.query.trim()) params.set("q", state.query.trim());
    if (state.mode !== "keyword") params.set("mode", state.mode);
    if (state.discipline) params.set("discipline", state.discipline);
    const path = `${window.location.pathname}${params.size ? `?${params}` : ""}`;
    if (push && path !== `${window.location.pathname}${window.location.search}`) window.history.pushState(null, "", path);
    params.set("mode", state.mode); params.set("limit", "12");
    try {
      const data = await fetch(`/api/labs?${params}`, { signal: controller.signal }).then(responseJson<SearchResult>);
      if (sequence !== requestNumber.current || controller.signal.aborted) return;
      setResult(data);
      setSelectedId(previous => data.results.some(lab => lab.id === previous) ? previous : data.results[0]?.id ?? "");
    } catch (failure) {
      if (sequence !== requestNumber.current || controller.signal.aborted) return;
      setResult(null); setSelectedId("");
      setError(failure instanceof Error ? failure.message : "The search service is unavailable. Please try again.");
    } finally {
      if (sequence === requestNumber.current && !controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void runSearch(readLocation(), false);
    fetch("/api/health", { signal: controller.signal }).then(responseJson<Health>).then(setHealth).catch(failure => {
      if (!controller.signal.aborted) setHealthError(failure instanceof Error ? failure.message : "Service status unavailable");
    });
    fetch("/api/disciplines", { signal: controller.signal }).then(responseJson<{ disciplines: string[] }>).then(data => setDisciplines(data.disciplines)).catch(() => {});
    const onBack = () => void runSearch(readLocation(), false);
    window.addEventListener("popstate", onBack);
    return () => { controller.abort(); request.current?.abort(); window.removeEventListener("popstate", onBack); };
  }, [runSearch]);

  useEffect(() => {
    if (!playing || !result?.trace.length) return;
    if (step >= result.trace.length - 1) { setPlaying(false); return; }
    const timer = window.setTimeout(() => setStep(value => value + 1), 1800);
    return () => window.clearTimeout(timer);
  }, [playing, step, result]);

  const activeStep = result?.trace[step];
  useEffect(() => {
    setShowFullSource(false); setSource(null); setSourceError("");
    if (!showCode || !activeStep?.file) { setSourceLoading(false); return; }
    const controller = new AbortController();
    setSourceLoading(true);
    fetch(`/api/source?file=${encodeURIComponent(activeStep.file)}`, { signal: controller.signal }).then(responseJson<{ file: string; language: string; source: string }>).then(setSource).catch(failure => {
      if (!controller.signal.aborted) setSourceError(failure instanceof Error ? failure.message : "Source could not be loaded.");
    }).finally(() => { if (!controller.signal.aborted) setSourceLoading(false); });
    return () => controller.abort();
  }, [showCode, activeStep?.file]);

  const selected = result?.results.find(lab => lab.id === selectedId);
  const maxScore = Math.max(1, ...(result?.results.map(lab => lab.score) ?? []));
  const hasQuery = Boolean(result?.query.trim());
  const search = (next: Partial<SearchState> = {}) => void runSearch({ query, mode, discipline, ...next });
  const openTrace = () => {
    if (showTrace) { setShowTrace(false); setPlaying(false); return; }
    setShowTrace(true);
    window.setTimeout(() => traceRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" }), 20);
  };

  return <>
    <a className="skip-link" href="#research-index">Skip to research index</a>
    <div className="page-shell">
      <header className="masthead">
        <a className="wordmark" href="/" aria-label="Frontier home"><span className="frontier-mark" aria-hidden="true">f.</span>frontier<span className="wordmark-dot">01</span></a>
        <div className="edition"><span>AN OPEN RESEARCH DIRECTORY</span><span>FIELD EDITION <b>001</b></span></div>
        <span className="fiction-label"><span aria-hidden="true">◌</span> Fictional labs, real search</span>
      </header>

      <main>
        <section className="introduction" aria-labelledby="page-title">
          <div><p className="eyebrow">FOLLOW YOUR CURIOSITY</p><h1 id="page-title">Find the people<br />behind the <em>question.</em></h1></div>
          <p className="intro-note">Research starts with a good question. <br />Explore an original catalog of fictional labs. <br />Then look inside the search that connects them.</p>
        </section>

        <section className="search-section" aria-label="Search research labs">
          <form onSubmit={event => { event.preventDefault(); search(); }}>
            <label className="sr-only" htmlFor="research-question">Your research question</label>
            <div className="question-box"><span className="search-symbol" aria-hidden="true">↗</span><input ref={searchInput} id="research-question" value={query} onChange={event => setQuery(event.target.value)} maxLength={500} autoComplete="off" placeholder="What are you curious about?" /><button className="search-button" type="submit">Search <span aria-hidden="true">↗</span></button></div>
            <div className="search-options">
              <fieldset className="mode-selector"><legend className="sr-only">Search method</legend>{(["keyword", "semantic"] as Mode[]).map(value => <label key={value} className={mode === value ? "mode-option active" : "mode-option"}><input type="radio" name="mode" value={value} checked={mode === value} onChange={() => search({ mode: value })} /><span>{value === "keyword" ? "Keyword" : "Semantic"}</span></label>)}</fieldset>
              <label className="discipline-select"><span className="sr-only">Filter by discipline</span><select value={discipline} onChange={event => search({ discipline: event.target.value })}><option value="">All disciplines</option>{disciplines.map(value => <option key={value} value={value}>{value}</option>)}{discipline && !disciplines.includes(discipline) && <option value={discipline}>{discipline}</option>}</select></label>
              <span className="mode-explainer">{mode === "keyword" ? "Match words in the catalog." : "Compare meaning using local embeddings."}</span>
            </div>
          </form>
          <div className="example-row"><span>TRY A QUESTION</span>{EXAMPLES.map(example => <button type="button" key={example} onClick={() => search({ query: example })}>{example} <span aria-hidden="true">↗</span></button>)}</div>
          {mode === "semantic" && health && !health.semantic.available && <p className="semantic-notice" role="status">Semantic search is not ready. The local embedding model needs to be prepared; keyword search is available.</p>}
        </section>

        <section id="research-index" className="research-index" aria-labelledby="index-heading" aria-busy={loading}>
          <div className="index-heading"><div><span className="section-number">01 /</span><h2 id="index-heading">{hasQuery ? "Research connections" : "The research index"}</h2><span className="result-count" aria-live="polite">{loading ? "Searching…" : result ? `${result.total} ${result.total === 1 ? "lab" : "labs"}${result.total > result.results.length ? ` · showing ${result.results.length}` : ""}` : "Search unavailable"}</span></div><button className="text-button trace-toggle" type="button" onClick={openTrace} disabled={loading || !result?.trace.length} aria-expanded={showTrace} aria-controls="search-trace">{showTrace ? "Close search walkthrough" : "Follow search"}<span aria-hidden="true"> ↘</span></button></div>
          {error ? <div className="state-message error-state" role="alert"><span className="state-symbol" aria-hidden="true">!</span><h3>We couldn’t complete that search.</h3><p>{error}</p><div><button className="solid-button" onClick={() => search()}>Try again</button>{mode === "semantic" && <button className="outline-button" onClick={() => search({ mode: "keyword" })}>Use keyword search</button>}</div><p className="state-footnote">Frontier needs its local research service running on port 4203.</p></div> : loading ? <div className="loading-state" role="status"><span className="loading-line" /><p>Looking through the research index…</p><span className="loading-line short" /></div> : result && result.results.length === 0 ? <div className="state-message"><span className="state-symbol" aria-hidden="true">∅</span><h3>No labs matched this search.</h3><p>Try fewer words, a broader topic, or another discipline.</p><button className="solid-button" onClick={() => search({ query: "", discipline: "" })}>Browse the whole index</button></div> : <div className="index-layout">
            <div className="result-list"><div className="column-labels"><span>{hasQuery ? `RANKED BY ${result?.mode === "semantic" ? "MEANING" : "KEYWORD MATCH"}` : "BROWSE ALPHABETICALLY"}</span><span>{hasQuery ? result?.mode === "semantic" ? "COSINE · −1 TO 1" : "WEIGHTED MATCHES" : "SELECT A LAB →"}</span></div>
              {result?.results.map((lab, index) => <button key={lab.id} className={`lab-row${selected?.id === lab.id ? " selected" : ""}`} onClick={() => setSelectedId(lab.id)} aria-pressed={selected?.id === lab.id} aria-label={`View ${lab.name}`}>
                <span className="lab-number">{String(index + 1).padStart(2, "0")}</span><span className="lab-row-content"><span className="lab-discipline">{lab.discipline}</span><span className="lab-name">{lab.name}</span><span className="lab-summary">{lab.summary}</span><span className="lab-meta">{lab.institution} <span aria-hidden="true">·</span> {lab.location}</span>{hasQuery && lab.matched_terms?.length > 0 && <span className="matched-terms">Matches: {lab.matched_terms.join(", ")}</span>}</span>
                <span className="lab-score">{hasQuery ? <><span className="score-number">{result?.mode === "semantic" ? lab.score.toFixed(3) : lab.score}</span><span className={`score-track ${result?.mode === "semantic" ? "cosine" : ""}`} aria-hidden="true">{result?.mode === "semantic" ? <span className="cosine-point" style={{ left: `${Math.max(0, Math.min(100, (lab.score + 1) * 50))}%` }} /> : <span className="score-fill" style={{ width: `${lab.score / maxScore * 100}%` }} />}</span></> : <span className="row-arrow" aria-hidden="true">↗</span>}</span>
              </button>)}
              {hasQuery && <p className="ranking-note">{result?.mode === "semantic" ? "Cosine similarity compares the direction of query and lab vectors. It is a similarity score, not a probability or an endorsement." : "Weighted keyword scores count matches in lab fields. Bars are relative to the highest score in these results."}</p>}
            </div>
            <aside className="lab-profile" aria-labelledby="profile-name" aria-live="polite">{selected && <><div className="profile-topline"><span>LAB FILE / {String((result?.results.indexOf(selected) ?? 0) + 1).padStart(2, "0")}</span><span className="profile-stamp">FICTIONAL</span></div><p className="profile-discipline">{selected.discipline}</p><h3 id="profile-name">{selected.name}</h3><p className="profile-institution">{selected.institution}<br />{selected.location}</p><hr /><p className="profile-label">THE QUESTION THEY EXPLORE</p><p className="profile-focus">{selected.focus || selected.summary}</p><p className="profile-label">RESEARCH THREADS</p><ul className="topics">{selected.topics.map(topic => <li key={topic}>{topic}</li>)}</ul><p className="profile-label">AT THE WORKBENCH</p><ul className="methods">{selected.methods.map(method => <li key={method}>{method}</li>)}</ul><div className="provenance-note"><span aria-hidden="true">↳</span><p>{selected.provenance.note}<br /><span>Record: {selected.id}</span></p></div></>}</aside>
          </div>}
        </section>

        {showTrace && result && <section ref={traceRef} id="search-trace" className="trace-section" aria-labelledby="trace-title"><div className="trace-heading"><div><span className="section-number">02 /</span><h2 id="trace-title">Inside this search</h2></div><span className="trace-badge">ACTUAL BACKEND TRACE</span></div><p className="trace-intro">Follow the operations recorded for {result.query ? <q>{result.query}</q> : "this catalog browse"}. Each step links to the Python that ran.</p><div className="trace-controls"><button onClick={() => { setStep(0); setPlaying(false); }} disabled={step === 0 && !playing}>Reset</button><button onClick={() => { setPlaying(false); setStep(value => Math.max(0, value - 1)); }} disabled={step === 0}>← Back</button><button className="play-button" onClick={() => { if (!playing && step >= result.trace.length - 1) setStep(0); setPlaying(value => !value); }} disabled={!result.trace.length}>{playing ? "Ⅱ Pause" : "▶ Play"}</button><button onClick={() => { setPlaying(false); setStep(value => Math.min(result.trace.length - 1, value + 1)); }} disabled={step >= result.trace.length - 1}>Next →</button><span className="trace-position">{step + 1} / {result.trace.length}</span><button className="code-toggle" onClick={() => setShowCode(value => !value)} aria-expanded={showCode} aria-controls="trace-source">{showCode ? "Hide code" : "Show code"} <span aria-hidden="true">{`{ }`}</span></button></div><div className={`trace-body${showCode ? " with-code" : ""}`}><div className="operation-panel"><ol className="operation-list" aria-label="Search operations">{result.trace.map((operation, index) => <li key={`${operation.step}-${operation.title}`}><button className={step === index ? "current" : ""} onClick={() => { setStep(index); setPlaying(false); }} aria-current={step === index ? "step" : undefined}><span>{String(index + 1).padStart(2, "0")}</span>{operation.title}<span className="step-indicator" aria-hidden="true">{step === index ? "←" : index < step ? "✓" : "·"}</span></button></li>)}</ol>{activeStep && <div className="operation-detail" aria-live="polite"><p className="eyebrow">STEP {String(step + 1).padStart(2, "0")}</p><h3>{activeStep.title}</h3><p>{activeStep.description}</p><p className="source-location">{activeStep.file}:{activeStep.lineStart}–{activeStep.lineEnd}</p></div>}</div>{showCode && activeStep && <div id="trace-source" className="source-panel"><div className="source-heading"><span>{activeStep.file}</span><button onClick={() => setShowFullSource(value => !value)} disabled={!source || sourceLoading}>{showFullSource ? "Relevant lines" : "Full file"}</button></div><p className="source-caption">{showFullSource ? "Current backend source · read only" : `Executed operation · lines ${activeStep.lineStart}–${activeStep.lineEnd}`}</p>{sourceError && <p className="source-error" role="status">{sourceError} The recorded snippet is shown below.</p>}<pre tabIndex={0} aria-label={`Python source for ${activeStep.title}`}><code>{(showFullSource && source ? source.source : activeStep.snippet).split("\n").map((line, index) => <span className="code-line" key={index}><span className="line-number" aria-hidden="true">{showFullSource ? index + 1 : activeStep.lineStart + index}</span>{line || " "}</span>)}</code></pre></div>}</div><p className="trace-caption">Playback moves through a completed request. It does not send another search or change the database.</p></section>}
      </main>

      <footer className="footer"><div><span className="footer-brand">frontier.</span><p>A question is a place to begin.</p></div><div className="service-status"><span className={`status-dot${health ? " online" : healthError ? " offline" : ""}`} aria-hidden="true" /><span>{health ? `${health.dataset.count} fictional labs · ${health.semantic.available ? `semantic model ready · ${health.semantic.dimensions} dimensions` : "keyword search · semantic model not ready"}` : healthError ? "Research service unavailable" : "Checking research service…"}</span>{health?.semantic.model && <small>{health.semantic.model}</small>}</div><span className="footer-edition">OPEN / 2026<br />NEXT.JS + PYTHON + POSTGRESQL</span></footer>
    </div>
  </>;
}
