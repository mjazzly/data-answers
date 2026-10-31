import "./site.css";
import "./demo.css";
import { SPRITE } from "./sprite.js";

const SITE = "https://mjazzly.github.io";
const DESC = "Ask a question about a year of synthetic orders and see the number with its metric, definition, filters and the rows it was computed over.";

export const metadata = {
  title: "Data answers, try it | Megat Jazly",
  description: DESC,
  openGraph: { type: "website", siteName: "Megat Jazly", title: "Data answers, try it | Megat Jazly", description: DESC, images: [{ url: `${SITE}/preview.png`, width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image" },
  icons: { icon: [{ url: `${SITE}/favicon.svg`, type: "image/svg+xml" }, { url: `${SITE}/favicon-32.png`, sizes: "32x32" }], apple: `${SITE}/apple-touch-icon.png` },
};

const NAV = [["built.html", "Built"], ["aiwork.html", "AI Work"], ["casefiles.html", "Case Files"], ["index.html", "Systems"], ["operator.html", "Operator"], ["models.html", "Models"], ["knowledge.html", "Knowledge"], ["chapters.html", "Chapters"]];

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>
        <div dangerouslySetInnerHTML={{ __html: SPRITE }} />
        <nav className="top"><div className="wrap">
          <a className="brand" href={`${SITE}/index.html`}><span className="seam silver" aria-hidden="true"></span><span className="brand-name">Megat Jazly</span><span className="seam" aria-hidden="true"></span></a>
          <div className="links">
            {NAV.map(([href, name]) => <a key={href} href={`${SITE}/${href}`} className={name === "AI Work" ? "active" : undefined}>{name}</a>)}
          </div>
        </div></nav>
        <div className="wrap">
          {children}
          <footer>
            <div className="end">
              <p>Thanks for reading. Say hello anytime.</p>
              <ul className="icon-links">
                <li><a href="mailto:megatjazly@gmail.com" aria-label="Email" title="Email"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="5.5" width="18" height="13" rx="2" /><path d="M3.5 7l8.5 6 8.5-6" /></svg></a></li>
                <li><a target="_blank" href="https://linkedin.com/in/megatjazly" rel="me noopener" aria-label="LinkedIn" title="LinkedIn"><svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><path d="M0 1.146C0 .513.526 0 1.175 0h13.65C15.474 0 16 .513 16 1.146v13.708c0 .633-.526 1.146-1.175 1.146H1.175C.526 16 0 15.487 0 14.854zm4.943 12.248V6.169H2.542v7.225zm-1.2-8.212c.837 0 1.358-.554 1.358-1.248-.015-.709-.52-1.248-1.342-1.248S2.4 3.226 2.4 3.934c0 .694.521 1.248 1.327 1.248zm4.908 8.212V9.359c0-.216.016-.432.08-.586.173-.431.568-.878 1.232-.878.869 0 1.216.662 1.216 1.634v3.865h2.401V9.25c0-2.22-1.184-3.252-2.764-3.252-1.274 0-1.845.7-2.165 1.193v.025h-.016l.016-.025V6.169h-2.4c.03.678 0 7.225 0 7.225z" /></svg></a></li>
                <li><a target="_blank" href="https://github.com/mjazzly" rel="me noopener" aria-label="GitHub" title="GitHub"><svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8" /></svg></a></li>
              </ul>
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
