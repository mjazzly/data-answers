// Reads a period the way a person writes one and returns the months it covers, or a gate.
// The data holds one calendar year, so a bare month or quarter resolves to that year and the block
// says so. A relative period (last quarter, recently, this year) has no reference date here and
// stops at Gate 2. A period outside the data stops at Gate 6 (there is nothing to compute).
const MON = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
const RELATIVE = /\b(last|this|these|recent|recently|previous|prior|past|current|latest|next|upcoming|ytd|year to date|so far|to date|today|now|yesterday|lately|trailing|rolling)\b/i;

export function makePeriods(months) {
  const YEAR = months[0].slice(0, 4);
  const mm = (m) => `${YEAR}-${String(m).padStart(2, "0")}`;
  const range = (a, b) => months.filter((x) => x >= mm(a) && x <= mm(b));
  const ok = (label, ms, implied) => ({ ok: true, label, months: ms, implied_year: implied ? YEAR : undefined });

  function parse(raw) {
    if (raw == null || String(raw).trim() === "") return { ok: false, gate: "G2", reason: "ambiguous_period", message: `No period was given. Which period: a year (${YEAR}), a month (${YEAR}-03 or March ${YEAR}), a quarter (${YEAR}-Q3), a half (${YEAR}-H1) or a month range (${YEAR}-01 to ${YEAR}-06)?` };
    const t = String(raw).trim().replace(/\s+/g, " ");
    if (RELATIVE.test(t)) return { ok: false, gate: "G2", reason: "ambiguous_period", message: `"${t}" is relative and this system has no reference date, so it cannot say which period that is. Which period is meant: a year (${YEAR}), a month (${YEAR}-03), a quarter (${YEAR}-Q3), a half (${YEAR}-H1) or a month range (${YEAR}-01 to ${YEAR}-06)?` };
    const s = t.toLowerCase().replace(/,/g, "").replace(/\b(the|of|in|for|whole|full|entire|year)\b/g, "").replace(/\s+/g, " ").trim();
    let m;
    const yearCheck = (y) => (y && y !== YEAR ? { ok: false, gate: "G6", reason: "outside_data", message: `The data covers ${months[0]} to ${months[months.length - 1]} only; there is nothing to compute for ${y}, and this system does not estimate.` } : null);
    if ((m = /^(\d{4})$/.exec(s))) return yearCheck(m[1]) || ok(YEAR, months);
    if ((m = /^(\d{4})-(\d{1,2})$/.exec(s))) return yearCheck(m[1]) || monthOk(+m[2]);
    if ((m = /^(\d{4})[- ]?q([1-4])$/.exec(s))) return yearCheck(m[1]) || ok(`${YEAR}-Q${m[2]}`, range(m[2] * 3 - 2, m[2] * 3));
    if ((m = /^q([1-4])[- ]?(\d{4})$/.exec(s))) return yearCheck(m[2]) || ok(`${YEAR}-Q${m[1]}`, range(m[1] * 3 - 2, m[1] * 3));
    if ((m = /^q([1-4])$/.exec(s))) return ok(`${YEAR}-Q${m[1]}`, range(m[1] * 3 - 2, m[1] * 3), true);
    if ((m = /^(\d{4})[- ]?h([12])$/.exec(s))) return yearCheck(m[1]) || half(m[2]);
    if ((m = /^h([12])[- ]?(\d{4})$/.exec(s))) return yearCheck(m[2]) || half(m[1]);
    if ((m = /^h([12])$/.exec(s))) return half(m[1], true);
    if ((m = /^(first|second|1st|2nd) half ?(\d{4})?$/.exec(s))) return yearCheck(m[2]) || half(/first|1st/.test(m[1]) ? 1 : 2, !m[2]);
    if ((m = /^([a-z]+) ?(\d{4})?$/.exec(s)) && MON[m[1]]) return yearCheck(m[2]) || monthOk(MON[m[1]], !m[2]);
    if ((m = /^(\d{4}) ([a-z]+)$/.exec(s)) && MON[m[2]]) return yearCheck(m[1]) || monthOk(MON[m[2]]);
    if ((m = /^(\d{4})-(\d{2}) (?:to|-|through|until) (\d{4})-(\d{2})$/.exec(s))) return yearCheck(m[1]) || yearCheck(m[3]) || rangeOk(+m[2], +m[4]);
    if ((m = /^([a-z]+) ?(\d{4})? (?:to|-|through|until) ([a-z]+) ?(\d{4})?$/.exec(s)) && MON[m[1]] && MON[m[3]]) return yearCheck(m[2]) || yearCheck(m[4]) || rangeOk(MON[m[1]], MON[m[3]], !m[2] && !m[4]);
    if (/\d{4}/.test(s) && !s.includes(YEAR)) return yearCheck(/\d{4}/.exec(s)[0]);
    return { ok: false, gate: "G2", reason: "ambiguous_period", message: `"${t}" could not be read as a period. Which period is meant: a year (${YEAR}), a month (${YEAR}-03), a quarter (${YEAR}-Q3), a half (${YEAR}-H1) or a month range (${YEAR}-01 to ${YEAR}-06)?` };
  }
  function monthOk(n, implied) { if (n < 1 || n > 12) return { ok: false, gate: "G2", reason: "ambiguous_period", message: `Month ${n} does not exist.` }; return ok(mm(n), [mm(n)], implied); }
  function half(h, implied) { return ok(`${YEAR}-H${h}`, range(h * 6 - 5, h * 6), implied); }
  function rangeOk(a, b, implied) { if (a > b) [a, b] = [b, a]; return a === b ? monthOk(a, implied) : ok(`${mm(a)} to ${mm(b)}`, range(a, b), implied); }
  return { parse, months, year: YEAR, previousMonth: (label) => { const i = months.indexOf(label); return i > 0 ? months[i - 1] : null; }, previousQuarter: (label) => { const n = +label.slice(-1); return n > 1 ? `${YEAR}-Q${n - 1}` : null; } };
}
