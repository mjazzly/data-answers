import fs from "node:fs";
import path from "node:path";
import Demo from "./Demo.js";

export const dynamic = "force-static";

function presets() {
  const f = path.join(process.cwd(), "presets.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : { items: [] };
}

export default function Page() {
  return (
    <>
      <header className="hero">
        <div className="eyebrow">AI Work <span className="dot">·</span> WORK-03 <span className="dot">·</span> Try it</div>
        <h1>A question, and the number behind it</h1>
        <p className="thesis">Behind this box sits <b>a year of synthetic (made-up) orders from eight branches</b>; ask about orders, revenue or returns and <b>the code answers from one of twelve defined metrics</b>, showing the definition, the filters and the rows it counted, and it <b>refuses</b> a metric nobody has defined, a named person or a forecast.</p>
        <div className="hero-links">
          <a href="https://mjazzly.github.io/aiwork.html#work-03"><svg className="ic" aria-hidden="true"><use href="#ic-list" /></svg>How data answers works</a>
          <a target="_blank" href="https://github.com/mjazzly/data-answers" rel="noopener"><svg className="ic" aria-hidden="true"><use href="#ic-code" /></svg>The code and every record</a>
        </div>
      </header>
      <Demo presets={presets()} />
    </>
  );
}
