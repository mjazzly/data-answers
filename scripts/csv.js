// The one CSV writer for every file the build writes: the generator's clean files, the raw export and
// the export from the tested tables, so quoting and line ends can never differ between them.
// A field is quoted when it holds a comma, a quote or a space; no field ever holds a quote.
export const q = (s) => (/[", ]/.test(s) ? `"${s}"` : s);
export const csvText = (head, rows) => [head, ...rows].map((r) => r.map((v) => q(String(v))).join(",")).join("\n") + "\n";
