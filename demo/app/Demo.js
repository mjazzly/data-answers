"use client";
import { useEffect, useRef, useState } from "react";

const MAX = 200;

// ---------- formatting, as output-03.html writes it ----------
const commas = (s) => { const [i, d] = String(s).split("."); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (d != null ? "." + d : ""); };
const fmt = (v, unit) => (v == null ? "none" : unit === "%" ? <>{commas(v)}<small>%</small></> : commas(v));
const pct = (v) => (v == null ? "none" : <>{commas(v)}<small>%</small></>);
const filtersText = (f) => { const e = Object.entries(f || {}); return e.length ? e.map(([k, vs]) => `${k} is ${[].concat(vs).join(" or ")}`).join("; ") : "none"; };
const GATE = { G1: "refused, gate G1", G2: "stopped, gate G2", G3: "refused, gate G3", G4: "refused, gate G4", G5: "stopped, gate G5", G6: "refused, gate G6", rule: "refused by a rule" };
const money = (n) => (n > 0 && n < 0.01 ? "under US$0.01" : `US$${(n || 0).toFixed(2)}`);
const fmtDate = (iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" });

const NOTICE = {
  closed: "Free text is resting for now. The eight questions above still answer straight away.",
  budget: "Free text is resting for the rest of the month. The eight questions above still answer straight away.",
  daily_cap: (s) => `Today's ${s?.daily_cap ?? 150} free-text questions have all been asked. Free text opens again at 8:00 AM Kuala Lumpur time; the eight questions above still answer straight away.`,
  ip_cap: (s) => `This connection has asked its ${s?.ip_cap ?? 10} questions for today. The eight questions above still answer straight away.`,
  bot: "This request looked automated, so it was not sent. The eight questions above still answer straight away.",
  too_long: `Keep the question to ${MAX} characters.`,
  empty: "Type a question about the orders table first.",
  error: "The answer did not come back. Ask again, or pick one of the eight questions above.",
};
const noticeText = (why, s) => { const n = NOTICE[why] || NOTICE.error; return typeof n === "function" ? n(s) : n; };

function Answer({ it }) {
  if (it.kind !== "answer") {
    return (
      <div className="ans panel refused">
        <p className="ans-top"><span className="mono">{it.reason}</span><span className="st refused">{GATE[it.gate] || "refused"}</span></p>
        <p className="said">{it.message}</p>
        <dl className="facts">
          {it.nearest && <div><dt>Nearest metric</dt><dd><b className="mono">{it.nearest}</b>{it.nearest_definition}</dd></div>}
        </dl>
        {it.kind === "stop" && <p className="ask-again">The question is back in the box: change the part named above and ask again.</p>}
      </div>
    );
  }
  const compare = it.tool === "compare_periods";
  const dims = it.dimensions || [];
  const period = compare ? `${it.period_a} against ${it.period_b}` : it.previous_period ? `${it.period}, against ${it.previous_period}` : it.period;
  return (
    <div className="ans panel">
      <p className="ans-top"><span className="mono">{it.answer_id}</span><span className="st">{it.tool}</span></p>
      {it.value != null && <p className="figure-n">{fmt(it.value, it.unit)}</p>}
      {it.rows && !compare && (
        <table className="groups"><thead><tr><th scope="col">{dims.join(" | ")}</th><th scope="col" className="num">{it.metric}</th></tr></thead>
          <tbody>{it.rows.map((r) => <tr key={r.group}><td>{r.group}</td><td className="num">{fmt(r.value, it.unit)}</td></tr>)}</tbody></table>
      )}
      {it.rows && compare && (
        <div className="scroll"><table className="groups"><thead><tr><th scope="col">{dims[0]}</th><th scope="col" className="num">{it.period_a}</th><th scope="col" className="num">{it.period_b}</th><th scope="col" className="num">change</th><th scope="col" className="num">change %</th></tr></thead>
          <tbody>{it.rows.map((r) => <tr key={r.group}><td>{r.group}</td><td className="num">{fmt(r.value_a, it.unit)}</td><td className="num">{fmt(r.value_b, it.unit)}</td><td className="num">{r.change == null ? "none" : commas(r.change)}</td><td className="num">{pct(r.change_pct)}</td></tr>)}</tbody></table></div>
      )}
      <dl className="facts">
        <div><dt>Metric</dt><dd><b className="mono">{it.metric}</b>{it.definition}</dd></div>
        <div><dt>Period</dt><dd>{period}{it.period_note ? `, ${it.period_note}` : ""}</dd></div>
        <div><dt>Filters</dt><dd>{filtersText(it.filters)}</dd></div>
        {it.correction_note && <div><dt>Correction</dt><dd>{it.correction_note}</dd></div>}
        {compare && <div><dt>Change</dt><dd>{it.unit === "%" ? "in percentage points" : "in the metric's own unit"}; change % is the change as a share of {it.period_a}; highest first</dd></div>}
        <div><dt>Computed over</dt><dd>{commas(it.rows_over)} of {commas(it.data_rows)} rows, data version {it.data_version}</dd></div>
      </dl>
      <p className="sql">{[].concat(it.sql).join("\n\n")}</p>
    </div>
  );
}

export default function Demo({ presets }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);   // { question, items, source: "preset" | "live", run_id, model, when }
  const [notice, setNotice] = useState(null);
  const [stats, setStats] = useState(null);
  const box = useRef(null);
  const out = useRef(null);

  useEffect(() => { fetch("/api/stats").then((r) => (r.ok ? r.json() : null)).then((s) => s && setStats(s)).catch(() => {}); }, []);
  const open = !stats || stats.free_text === "on";
  const show = () => setTimeout(() => out.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);

  function pick(p) {
    setQ(p.question); setNotice(null);
    setResult({ question: p.question, items: p.items, source: "preset", run_id: p.run_id, model: presets.model, when: presets.recorded_at });
    show();
  }

  async function ask(e) {
    e.preventDefault();
    const question = q.replace(/\s+/g, " ").trim();
    if (!question) { setNotice("empty"); return; }
    if (question.length > MAX) { setNotice("too_long"); return; }
    setBusy(true); setNotice(null); setResult(null);
    try {
      const r = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question }) });
      const j = await r.json().catch(() => ({ ok: false, why: "error" }));
      if (j.stats) setStats(j.stats);
      if (!j.ok) { setNotice(j.why || "error"); return; }
      setResult({ question, items: j.items, source: "live", run_id: j.run_id, model: j.model, cost: j.cost_usd });
      if (j.items.some((it) => it.kind === "stop")) setQ(question); else setQ("");
      show();
    } catch { setNotice("error"); }
    finally { setBusy(false); }
  }

  const why = notice || (stats && stats.free_text !== "on" ? (stats.free_text === "off" ? "closed" : stats.free_text) : null);

  return (
    <>
      <section id="ask">
        <h2><span className="badge"><svg className="ic" aria-hidden="true"><use href="#ic-message" /></svg></span>Ask about the orders</h2>
        <form className="panel askbox" onSubmit={ask}>
          <label htmlFor="q" className="side-head">Your question</label>
          <textarea id="q" ref={box} value={q} maxLength={MAX} rows={2} disabled={!open || busy}
            placeholder="For example: revenue by channel in Q4 2025"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form.requestSubmit(); } }} />
          <div className="ask-row">
            <span className="mono count">{q.length} / {MAX}</span>
            <button type="submit" disabled={!open || busy}>{busy ? "Working it out" : "Ask"}</button>
          </div>
          {why && <p className="notice" role="status"><span className="badge badge-s amber"><svg className="ic" aria-hidden="true"><use href="#ic-stop" /></svg></span><span>{noticeText(why, stats)}</span></p>}
        </form>

        <p className="side-head presets-head"><span className="badge badge-s"><svg className="ic" aria-hidden="true"><use href="#ic-list" /></svg></span><span>Or pick one, <b>answered at once</b> from a recorded run</span></p>
        <div className="presets">
          {presets.items.map((p) => (
            <button key={p.question} type="button" className={`preset${result?.question === p.question && result.source === "preset" ? " on" : ""}`} onClick={() => pick(p)}>
              <span>{p.label}</span>{p.items[0]?.kind !== "answer" && <span className="gate-mark">gate</span>}
            </button>
          ))}
        </div>
      </section>

      <section id="answer" ref={out} aria-live="polite">
        {result && (
          <>
            <h2><span className="badge"><svg className="ic" aria-hidden="true"><use href="#ic-database" /></svg></span>What came back</h2>
            <p className="asked"><span className="mono">Asked</span>{result.question}</p>
            <p className="out-run"><svg className="ic" aria-hidden="true"><use href="#ic-circle-check" /></svg>
              <span>{result.source === "preset"
                ? <>Recorded answer, run <b>{result.run_id}</b>, {result.model}, {fmtDate(result.when)}</>
                : <>Answered now, run <b>{result.run_id}</b>, {result.model}, US${result.cost.toFixed(4)}</>}</span></p>
            <div className="answers">{result.items.map((it, i) => <Answer key={i} it={it} />)}</div>
          </>
        )}
      </section>

      <p className="out-run tally"><svg className="ic" aria-hidden="true"><use href="#ic-hash" /></svg>
        <span>{stats ? <><b>{stats.questions}</b> of {stats.daily_cap} free-text questions asked today, <b>{money(stats.cost_month_usd)}</b> spent this month</> : "Counting today's questions"}</span></p>
    </>
  );
}
