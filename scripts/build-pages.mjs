import { mkdir, rm, writeFile } from "node:fs/promises";
import worker from "../worker/index.js";

const outputDir = new URL("../pages/", import.meta.url);
const siteOrigin = "https://tianyaya404-dotcom.github.io";
const siteBase = "/pharma-monitor/";
const socialImage = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#123f49"/><stop offset="1" stop-color="#07111b"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <circle cx="1020" cy="90" r="260" fill="none" stroke="#43d8b0" stroke-opacity=".18" stroke-width="2"/>
  <circle cx="1020" cy="90" r="185" fill="none" stroke="#43d8b0" stroke-opacity=".12" stroke-width="2"/>
  <text x="90" y="180" fill="#43d8b0" font-family="Arial,sans-serif" font-size="28" letter-spacing="5">GLOBAL LIFE SCIENCES INTELLIGENCE</text>
  <text x="90" y="310" fill="#e9f3f7" font-family="Arial,sans-serif" font-weight="700" font-size="82">Pharma Monitor</text>
  <text x="90" y="400" fill="#b7cbd5" font-family="Arial,sans-serif" font-size="38">全球医药与生物科技情报</text>
  <text x="90" y="495" fill="#8ba4b4" font-family="Arial,sans-serif" font-size="26">监管 · 临床 · 交易 · 供应链 · 中国市场</text>
</svg>`;

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

const pageResponse = await worker.fetch(
  new Request(`${siteOrigin}/`),
);
if (!pageResponse.ok) {
  throw new Error(`Unable to build page: ${pageResponse.status}`);
}

const html = (await pageResponse.text())
  .replaceAll(`${siteOrigin}/og.png`, `${siteOrigin}${siteBase}og.svg`)
  .replace(
    'fetch("/api/news",{cache:"no-store"})',
    'fetch("./news.json?ts="+Date.now(),{cache:"no-store"})',
  );

const newsResponse = await worker.fetch(
  new Request(`${siteOrigin}/api/news`),
);
if (!newsResponse.ok) {
  throw new Error(`Unable to fetch news: ${newsResponse.status}`);
}
const news = await newsResponse.text();

await Promise.all([
  writeFile(new URL("index.html", outputDir), html),
  writeFile(new URL("news.json", outputDir), news),
  writeFile(new URL(".nojekyll", outputDir), ""),
  writeFile(new URL("og.svg", outputDir), socialImage),
]);

console.log("GitHub Pages bundle created in pages/");
