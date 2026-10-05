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
  const traceToggleRef = useRef<HTMLButtonElement>(null);

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
      setSelectedId("");
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

  const maxScore = Math.max(1, ...(result?.results.map(lab => lab.score) ?? []));
  const hasQuery = Boolean(result?.query.trim());
  const search = (next: Partial<SearchState> = {}) => void runSearch({ query, mode, discipline, ...next });
  const openTrace = () => {
    if (showTrace) { setShowTrace(false); setPlaying(false); return; }
    setShowTrace(true);
    window.setTimeout(() => traceRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" }), 20);
  };
  const closeProfile = (id: string) => {
    setSelectedId("");
    document.getElementById(`lab-title-${id}`)?.focus();
  };
  const closeTrace = () => {
    setShowTrace(false);
    setPlaying(false);
    traceToggleRef.current?.focus();
  };

  return <>
    <a className="skip-link" href="#research-index">Skip to research results</a>
    <div className={`page-shell${hasQuery || discipline ? " search-active" : ""}`}>
      <nav className="utility-links" aria-label="Page navigation"><a href="/">Research directory</a><a href="#about">About Frontier</a></nav>
      <main>
        <header className="search-home">
          <div className="search-brand"><h1><a href="/" aria-label="Frontier home"><span>F</span>rontier</a></h1><p className="tagline">A world of questions.</p></div>
          <div className="search-workspace">
          <form className="search-form" onSubmit={event => { event.preventDefault(); search(); }}>
            <label className="sr-only" htmlFor="research-question">What would you like to explore?</label>
            <div className="question-box"><input ref={searchInput} id="research-question" value={query} onChange={event => setQuery(event.target.value)} maxLength={500} autoComplete="off" placeholder="Find a lab, explore an idea" /><button className="search-button" type="submit">Search</button></div>
            <div className="search-options">
              <fieldset className="mode-selector"><legend className="sr-only">Search method</legend>{(["keyword", "semantic"] as Mode[]).map(value => <label key={value}><input type="radio" name="mode" value={value} checked={mode === value} onChange={() => search({ mode: value })} />{value === "keyword" ? "Keyword" : "Semantic"}</label>)}</fieldset>
              <label className="discipline-select"><span className="sr-only">Filter by subject</span><select value={discipline} onChange={event => search({ discipline: event.target.value })}><option value="">All subjects</option>{disciplines.map(value => <option key={value} value={value}>{value}</option>)}{discipline && !disciplines.includes(discipline) && <option value={discipline}>{discipline}</option>}</select></label>
            </div>
          </form>
          <p className="example-row"><span>Try: </span>{EXAMPLES.map((example, index) => <span key={example}>{index > 0 && <span className="separator"> · </span>}<button type="button" className="link-button" onClick={() => search({ query: example })}>{example}</button></span>)}</p>
          <p className="mode-explainer">{mode === "keyword" ? "Keyword matches words. Semantic finds similar meaning." : "Semantic compares the meaning of your question with each lab."}</p>
          {mode === "semantic" && health && !health.semantic.available && <p className="semantic-notice" role="status">The local semantic model is not ready. <button className="link-button" onClick={() => search({ mode: "keyword" })}>Use keyword search</button>.</p>}
          </div>
        </header>

        <nav className="subject-directory" aria-label="Browse by subject"><strong>Explore </strong><button className="link-button" onClick={() => search({ query: "", discipline: "" })} aria-current={!discipline && !query ? "true" : undefined}>All labs</button>{disciplines.map(value => <span key={value}><span className="subject-separator" aria-hidden="true"> </span><button className="link-button" onClick={() => search({ query: "", discipline: value })} aria-current={discipline === value && !query ? "true" : undefined}>{value}</button></span>)}</nav>

        <section id="research-index" className="research-index" aria-labelledby="index-heading" aria-busy={loading}>
          <div className="results-heading"><div><h2 id="index-heading">{hasQuery ? <>Results for “{result?.query}”</> : result?.discipline || "The research directory"}</h2><p className="catalog-note">Fictional labs. Real search.</p><p className="result-count" aria-live="polite">{loading ? "Searching the directory…" : result ? `${result.total} ${result.total === 1 ? "lab" : "labs"}${result.total > result.results.length ? ` · showing ${result.results.length}` : ""}${hasQuery ? ` · ranked by ${result.mode === "semantic" ? "semantic similarity" : "keyword match"}` : " · in alphabetical order"}` : "Search unavailable"}</p></div><button ref={traceToggleRef} className="link-button trace-toggle" type="button" onClick={openTrace} disabled={loading || !result?.trace.length} aria-expanded={showTrace} aria-controls="search-trace">{showTrace ? "Hide search walkthrough" : "How this search works"}</button></div>

          {showTrace && result && <section ref={traceRef} id="search-trace" className="trace-section" aria-labelledby="trace-title"><div className="trace-heading"><h3 id="trace-title">How this search works</h3><button className="link-button" onClick={closeTrace}>Close</button></div><p className="trace-intro">These are the operations the backend recorded for {result.query ? <q>{result.query}</q> : "this catalog browse"}. Follow each step, then open the Python behind it.</p><div className="trace-controls"><button onClick={() => { setStep(0); setPlaying(false); }} disabled={step === 0 && !playing}>Reset</button><button onClick={() => { setPlaying(false); setStep(value => Math.max(0, value - 1)); }} disabled={step === 0}>← Back</button><button className="play-button" onClick={() => { if (!playing && step >= result.trace.length - 1) setStep(0); setPlaying(value => !value); }} disabled={!result.trace.length}>{playing ? "Pause" : "▶ Play"}</button><button onClick={() => { setPlaying(false); setStep(value => Math.min(result.trace.length - 1, value + 1)); }} disabled={step >= result.trace.length - 1}>Next →</button><span className="trace-position">Step {step + 1} of {result.trace.length}</span><button className="code-toggle" onClick={() => setShowCode(value => !value)} aria-expanded={showCode} aria-controls="trace-source">{showCode ? "Hide code" : "Show code"}</button></div><div className={`trace-body${showCode ? " with-code" : ""}`}><div className="operation-panel"><ol className="operation-list" aria-label="Search operations">{result.trace.map((operation, index) => <li key={`${operation.step}-${operation.title}`}><button className={step === index ? "current" : ""} onClick={() => { setStep(index); setPlaying(false); }} aria-current={step === index ? "step" : undefined}>{operation.title}</button></li>)}</ol>{activeStep && <div className="operation-detail" aria-live="polite"><h4>{activeStep.title}</h4><p>{activeStep.description}</p><p className="source-location">{activeStep.file}:{activeStep.lineStart}–{activeStep.lineEnd}</p></div>}</div>{showCode && activeStep && <div id="trace-source" className="source-panel"><div className="source-heading"><span>{activeStep.file}</span><button className="link-button" onClick={() => setShowFullSource(value => !value)} disabled={!source || sourceLoading}>{showFullSource ? "Relevant lines" : "Full file"}</button></div><p className="source-caption">{showFullSource ? "Current backend source · read only" : `Executed operation · lines ${activeStep.lineStart}–${activeStep.lineEnd}`}</p>{sourceError && <p className="source-error" role="status">{sourceError} The recorded snippet is shown below.</p>}<pre tabIndex={0} aria-label={`Python source for ${activeStep.title}`}><code>{(showFullSource && source ? source.source : activeStep.snippet).split("\n").map((line, index) => <span className="code-line" key={index}><span className="line-number" aria-hidden="true">{showFullSource ? index + 1 : activeStep.lineStart + index}</span>{line || " "}</span>)}</code></pre></div>}</div><p className="trace-caption">Playback follows a completed request. It does not send another search or change the database.</p>{health && <p className="runtime-note">{health.database} · {health.semantic.model} · {health.semantic.dimensions} dimensions · {health.semantic.available ? "local model ready" : "model unavailable"}</p>}</section>}

          {error ? <div className="state-message error-state" role="alert"><h3>We couldn’t complete that search.</h3><p>{error}</p><div><button onClick={() => search()}>Try again</button>{mode === "semantic" && <button onClick={() => search({ mode: "keyword" })}>Use keyword search</button>}</div><p className="state-footnote">Frontier needs its local research service running on port 4203.</p></div> : loading ? <div className="loading-state" role="status"><p>Looking through the research directory…</p></div> : result && result.results.length === 0 ? <div className="state-message"><h3>No labs matched this search.</h3><p>Try fewer words, a broader topic, or another subject.</p><button onClick={() => search({ query: "", discipline: "" })}>Browse all labs</button></div> : <div className="result-list">
            {result?.results.map(lab => <article key={lab.id} className="lab-result" aria-labelledby={`lab-title-${lab.id}`}>
              <h3><button id={`lab-title-${lab.id}`} className="lab-title link-button" onClick={() => setSelectedId(selectedId === lab.id ? "" : lab.id)} aria-expanded={selectedId === lab.id} aria-controls={`profile-${lab.id}`}>{lab.name}</button></h3>
              <p className="lab-address">{lab.institution} <span aria-hidden="true">›</span> {lab.discipline} <span aria-hidden="true">›</span> {lab.location}</p>
              <p className="lab-summary">{lab.summary}</p>
              <p className="lab-topics">{lab.topics.join(" · ")}</p>
              {hasQuery && <div className="score-line"><span>{result?.mode === "semantic" ? `Similarity ${lab.score.toFixed(3)}` : `Keyword score ${lab.score}`}</span><span className={`score-track ${result?.mode === "semantic" ? "cosine" : ""}`} aria-hidden="true">{result?.mode === "semantic" ? <span className="cosine-point" style={{ left: `${Math.max(0, Math.min(100, (lab.score + 1) * 50))}%` }} /> : <span className="score-fill" style={{ width: `${lab.score / maxScore * 100}%` }} />}</span>{lab.matched_terms?.length > 0 && <span className="matched-terms">Matched: {lab.matched_terms.join(", ")}</span>}</div>}
              {selectedId === lab.id && <section id={`profile-${lab.id}`} className="inline-profile" aria-label={`About ${lab.name}`}><div className="profile-heading"><h4>About this lab</h4><button className="link-button" onClick={() => closeProfile(lab.id)}>Close profile ↑</button></div><p className="profile-focus">{lab.focus || lab.summary}</p><p><strong>Methods:</strong> {lab.methods.join("; ")}.</p><p className="provenance-note">{lab.provenance.note} <span>Record: {lab.id}.</span></p></section>}
            </article>)}
            {hasQuery && <p className="ranking-note">{result?.mode === "semantic" ? "About the scores: cosine similarity ranges from −1 to 1. It compares the direction of query and lab vectors; it is not a probability or an endorsement." : "About the scores: weighted keyword scores count matches in lab fields. Each bar is relative to the highest score in these results."}</p>}
          </div>}
        </section>
      </main>

      <footer id="about" className="footer"><p><strong>About Frontier.</strong> A learning project about finding research through language. Every lab and institution in this directory is fictional. The search, database, and code walkthrough are real.</p><p className="service-status">{health ? health.semantic.available ? "Keyword and semantic search are available." : "Keyword search is available. Semantic search is not ready." : healthError ? "Research service unavailable." : "Checking the research service…"}</p><p className="footer-links"><a href="#research-question">Back to search ↑</a><span>Frontier · Open · 2026</span></p></footer>
    </div>
  </>;
}
