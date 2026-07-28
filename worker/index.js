const FEEDS = [
  {
    id: "industry",
    label: "行业头条",
    query: '(pharma OR biotech OR biopharma OR pharmaceutical) when:2d',
  },
  {
    id: "regulatory",
    label: "监管与审批",
    query: '(FDA OR EMA OR MHRA OR PMDA OR NMPA) (drug OR medicine OR biologic OR vaccine) (approval OR safety OR review) when:7d',
  },
  {
    id: "clinical",
    label: "临床进展",
    query: '(pharma OR biotech) ("phase 3" OR "phase III" OR topline OR "clinical trial results") when:7d',
  },
  {
    id: "deals",
    label: "授权与交易",
    query: '(pharma OR biotech) (licensing OR acquisition OR merger OR partnership OR collaboration) when:7d',
  },
  {
    id: "manufacturing",
    label: "制造与供应链",
    query: '(pharmaceutical OR biologic) (manufacturing OR CDMO OR "supply chain" OR shortage) when:7d',
  },
  {
    id: "china",
    label: "中国市场",
    query: '(China OR Chinese) (pharma OR biotech OR biopharma OR "drug approval") when:7d',
  },
  {
    id: "china-policy",
    label: "中国政策与审批",
    query: '(site:nmpa.gov.cn OR site:cde.org.cn OR site:nhsa.gov.cn OR site:gov.cn) (药品 OR 医药 OR 生物医药 OR 医保) when:14d',
    locale: { hl: "zh-CN", gl: "CN", ceid: "CN:zh-Hans" },
  },
  {
    id: "company-disclosure",
    label: "上市公司与年报",
    query: '(site:cninfo.com.cn OR site:sse.com.cn OR site:hkexnews.hk) (医药 OR 制药 OR 生物科技) (年报 OR 半年报 OR 业绩 OR 公告) when:30d',
    locale: { hl: "zh-CN", gl: "CN", ceid: "CN:zh-Hans" },
    limit: 16,
  },
  {
    id: "market-data",
    label: "公开市场与销售数据",
    query: '(米内网 OR 药智网 OR 中康CMH OR 医药数据库 OR 医药市场数据) (销售 OR 市场规模 OR 医院终端 OR 零售药店) when:30d',
    locale: { hl: "zh-CN", gl: "CN", ceid: "CN:zh-Hans" },
  },
  {
    id: "wechat",
    label: "微信公众号线索",
    query: 'site:mp.weixin.qq.com (医药 OR 创新药 OR 生物科技 OR 医保 OR 药品审批) when:14d',
    locale: { hl: "zh-CN", gl: "CN", ceid: "CN:zh-Hans" },
  },
  {
    id: "science",
    label: "前沿研发",
    query: '(drug discovery OR gene therapy OR cell therapy OR antibody OR ADC OR RNA) biotech when:7d',
  },
];

const ESCAPES = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&nbsp;": " ",
};

function decodeHtml(value = "") {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/g, (match) => ESCAPES[match] ?? match)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(xml, name) {
  const match = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"));
  return decodeHtml(match?.[1] ?? "");
}

function parseRss(xml, feed) {
  const items = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    const rawTitle = tag(item, "title");
    const source = tag(item, "source") || rawTitle.split(" - ").at(-1) || "公开来源";
    const title = rawTitle.endsWith(` - ${source}`)
      ? rawTitle.slice(0, -(` - ${source}`).length)
      : rawTitle;
    const pubDate = tag(item, "pubDate");
    const timestamp = Number.isFinite(Date.parse(pubDate)) ? Date.parse(pubDate) : Date.now();
    items.push({
      id: `${feed.id}:${title}:${timestamp}`,
      category: feed.id,
      categoryLabel: feed.label,
      title,
      source,
      link: tag(item, "link"),
      summary: tag(item, "description").slice(0, 260),
      pubDate: new Date(timestamp).toISOString(),
    });
  }
  return items.slice(0, feed.limit ?? 12);
}

async function fetchFeed(feed) {
  const url = new URL("https://news.google.com/rss/search");
  const locale = feed.locale ?? { hl: "en-US", gl: "US", ceid: "US:en" };
  url.searchParams.set("q", feed.query);
  url.searchParams.set("hl", locale.hl);
  url.searchParams.set("gl", locale.gl);
  url.searchParams.set("ceid", locale.ceid);
  const response = await fetch(url, {
    headers: { "User-Agent": "PharmaMonitor/1.0 (+industry-intelligence-dashboard)" },
  });
  if (!response.ok) throw new Error(`${feed.id}:${response.status}`);
  return parseRss(await response.text(), feed);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=600",
    },
  });
}

async function handleNews(request) {
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const cacheKey = new Request(new URL("/api/news", request.url));
  const cached = cache ? await cache.match(cacheKey) : null;
  if (cached) return cached;

  const results = await Promise.allSettled(FEEDS.map(fetchFeed));
  const items = results
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));

  const seen = new Set();
  const deduped = items.filter((item) => {
    const key = item.title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 120);

  const failed = results
    .map((result, index) => (result.status === "rejected" ? FEEDS[index].id : null))
    .filter(Boolean);

  const response = json({
    updatedAt: new Date().toISOString(),
    items: deduped,
    failed,
    categories: FEEDS.map(({ id, label }) => ({ id, label })),
  });
  if (cache && deduped.length) await cache.put(cacheKey, response.clone());
  return response;
}

const HTML = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="全球医药、生物科技、监管审批、临床试验与行业交易实时情报看板">
  <meta property="og:title" content="Pharma Monitor｜全球医药与生物科技情报">
  <meta property="og:description" content="聚合监管审批、临床试验、行业交易、制造供应链与中国医药市场动态。">
  <meta property="og:type" content="website">
  <meta property="og:image" content="__ORIGIN__/og.png">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:image" content="__ORIGIN__/og.png">
  <title>Pharma Monitor｜全球医药与生物科技情报</title>
  <style>
    :root{color-scheme:dark;--bg:#07111b;--panel:#0d1b27;--panel2:#112332;--line:#20384a;--text:#e9f3f7;--muted:#8ba4b4;--accent:#43d8b0;--blue:#5aa8ff;--amber:#f6bb59;--pink:#ef7cae}
    *{box-sizing:border-box}html{background:var(--bg)}body{margin:0;font:14px/1.5 Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:var(--text);background:radial-gradient(circle at 12% 0%,#123347 0,transparent 28%),var(--bg)}
    button,input{font:inherit}.shell{max-width:1500px;margin:auto;padding:22px}.topbar{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:22px}.brand{display:flex;align-items:center;gap:13px}.mark{width:42px;height:42px;display:grid;place-items:center;border:1px solid #376273;border-radius:13px;background:linear-gradient(145deg,#123f49,#0a2331);box-shadow:0 0 26px #43d8b026;font-size:22px}.eyebrow{font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}h1{font-size:21px;margin:1px 0 0}.actions{display:flex;align-items:center;gap:10px}.live{display:flex;align-items:center;gap:7px;color:#b7cbd5}.dot{width:7px;height:7px;border-radius:50%;background:var(--accent);box-shadow:0 0 12px var(--accent)}.refresh{border:1px solid #315263;background:#102532;color:var(--text);border-radius:9px;padding:8px 12px;cursor:pointer}.refresh:hover{border-color:var(--accent)}
    .hero{display:grid;grid-template-columns:1.5fr .9fr;gap:15px;margin-bottom:15px}.brief,.pulse,.metric,.news,.side{border:1px solid var(--line);background:linear-gradient(160deg,#0f2230e8,#0b1823e8);border-radius:14px}.brief{padding:23px;min-height:190px;position:relative;overflow:hidden}.brief:after{content:"";position:absolute;right:-80px;top:-90px;width:260px;height:260px;border-radius:50%;border:1px solid #43d8b01f;box-shadow:0 0 0 35px #43d8b009,0 0 0 70px #43d8b008}.kicker{color:var(--accent);font-weight:700;letter-spacing:.08em}.brief h2{font-size:30px;line-height:1.18;margin:11px 0 10px;max-width:700px}.brief p{color:#a9c0cc;margin:0;max-width:720px}.pulse{padding:18px}.pulse h3,.side h3{margin:0 0 14px;font-size:14px}.regions{display:grid;grid-template-columns:1fr 1fr;gap:9px}.region{padding:12px;border:1px solid #203e50;border-radius:10px;background:#0b1b26}.region strong{display:block;margin-bottom:4px}.region span{font-size:12px;color:var(--muted)}
    .metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:15px}.metric{padding:16px}.metric span{color:var(--muted);font-size:12px}.metric strong{display:block;font-size:26px;margin-top:5px}.metric em{font-style:normal;font-size:11px;color:var(--accent)}
    .china-data{border:1px solid #29495a;background:linear-gradient(145deg,#102633e8,#0a1722e8);border-radius:14px;padding:18px;margin-bottom:15px}.china-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin-bottom:13px}.china-head h2{font-size:17px;margin:0 0 4px}.china-head p{margin:0;color:var(--muted);font-size:12px}.china-note{color:#8ca7b5;font-size:11px;text-align:right}.data-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.data-source{appearance:none;text-align:left;color:var(--text);border:1px solid #244556;border-radius:11px;background:#0a1b26;padding:13px;cursor:pointer;transition:.15s ease}.data-source:hover{border-color:var(--accent);transform:translateY(-1px)}.data-source b{display:flex;align-items:center;justify-content:space-between;font-size:13px}.data-source strong{color:var(--accent);font-size:18px}.data-source span{display:block;color:var(--muted);font-size:11px;margin-top:5px}
    .toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:18px 0 12px}.tabs{display:flex;gap:7px;overflow:auto;padding-bottom:2px}.tab{white-space:nowrap;border:1px solid #29485a;background:#0c1b27;color:#a9bdc8;border-radius:999px;padding:7px 11px;cursor:pointer}.tab.active{background:#173c43;color:#dffbf3;border-color:#3b8876}.search{width:min(330px,40vw);border:1px solid #29485a;border-radius:9px;background:#091720;color:var(--text);padding:9px 12px;outline:none}.search:focus{border-color:var(--accent)}
    .content{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:15px}.news{padding:9px}.feed{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.card{display:block;text-decoration:none;color:inherit;padding:16px;border:1px solid #1e3747;border-radius:11px;background:#0a1822;min-height:158px;transition:.15s ease}.card:hover{transform:translateY(-1px);border-color:#3f7c81;background:#0d202b}.meta{display:flex;gap:8px;align-items:center;color:var(--muted);font-size:11px}.badge{color:#91e4cf;background:#17362f;border:1px solid #285f51;border-radius:999px;padding:2px 7px}.card h3{font-size:15px;line-height:1.4;margin:11px 0 8px}.card p{color:#8fa8b5;font-size:12px;margin:0}.empty{grid-column:1/-1;padding:45px;text-align:center;color:var(--muted)}
    .side{padding:18px;height:max-content;position:sticky;top:16px}.theme{padding:11px 0;border-bottom:1px solid #1e3544}.theme:last-child{border:0}.theme b{display:flex;justify-content:space-between}.theme span{display:block;color:var(--muted);font-size:12px;margin-top:4px}.source-list{display:grid;gap:8px;margin-top:12px}.source{display:flex;justify-content:space-between;color:#b6cad3}.ok{color:var(--accent)}.warn{color:var(--amber)}.updated{font-size:11px;color:var(--muted);margin-top:14px}.skeleton{height:158px;border-radius:11px;background:linear-gradient(90deg,#0b1923,#102632,#0b1923);background-size:220% 100%;animation:shimmer 1.4s infinite}@keyframes shimmer{to{background-position:-220% 0}}
    footer{color:#698391;text-align:center;font-size:11px;padding:22px 0 4px}
    @media(max-width:900px){.hero,.content{grid-template-columns:1fr}.metrics{grid-template-columns:1fr 1fr}.data-grid{grid-template-columns:1fr 1fr}.china-head{align-items:flex-start;flex-direction:column}.china-note{text-align:left}.side{position:static}.feed{grid-template-columns:1fr}.brief h2{font-size:25px}}@media(max-width:620px){.shell{padding:14px}.topbar,.toolbar{align-items:flex-start;flex-direction:column}.actions{width:100%;justify-content:space-between}.search{width:100%}.metrics{gap:8px}.metric strong{font-size:22px}.regions{grid-template-columns:1fr 1fr}.data-grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div class="brand"><div class="mark">🧬</div><div><div class="eyebrow">Global Life Sciences Intelligence</div><h1>Pharma Monitor</h1></div></div>
      <div class="actions"><div class="live"><span class="dot"></span>在线更新</div><button class="refresh" id="refresh">刷新情报</button></div>
    </header>
    <section class="hero">
      <div class="brief"><div class="kicker">全球医药与生物科技 Monitor</div><h2>把分散的行业变化，集中成一张可行动的情报看板</h2><p>持续追踪监管审批、临床试验读出、授权并购、制造供应链与中国医药市场动态。</p></div>
      <div class="pulse"><h3>全球市场脉搏</h3><div class="regions"><div class="region"><strong>北美</strong><span>FDA · 交易 · 临床读出</span></div><div class="region"><strong>欧洲</strong><span>EMA · 定价 · 商业化</span></div><div class="region"><strong>亚太</strong><span>PMDA · NMPA · BD合作</span></div><div class="region"><strong>全球</strong><span>供应链 · CDMO · 前沿研发</span></div></div></div>
    </section>
    <section class="metrics">
      <div class="metric"><span>最新情报</span><strong id="total">—</strong><em>当前批次</em></div>
      <div class="metric"><span>监管与审批</span><strong id="regulatoryCount">—</strong><em>近 7 天</em></div>
      <div class="metric"><span>临床进展</span><strong id="clinicalCount">—</strong><em>近 7 天</em></div>
      <div class="metric"><span>授权与交易</span><strong id="dealsCount">—</strong><em>近 7 天</em></div>
    </section>
    <section class="china-data" aria-labelledby="chinaDataTitle">
      <div class="china-head">
        <div><h2 id="chinaDataTitle">中国公开数据与销售线索</h2><p>聚合官方政策、法定披露、公开市场研究和微信公众号文章，点击入口筛选对应情报。</p></div>
        <div class="china-note">销售数据来自公开披露与研究摘要，不代表完整终端销量。</div>
      </div>
      <div class="data-grid">
        <button class="data-source" data-category="china-policy"><b>政策与审批 <strong id="china-policyCount">—</strong></b><span>国家药监局、CDE、国家医保局及政府公开信息</span></button>
        <button class="data-source" data-category="company-disclosure"><b>上市公司与年报 <strong id="company-disclosureCount">—</strong></b><span>巨潮资讯、上交所与港交所法定披露线索</span></button>
        <button class="data-source" data-category="market-data"><b>市场与销售数据 <strong id="market-dataCount">—</strong></b><span>公开市场规模、医院终端、零售及研究数据</span></button>
        <button class="data-source" data-category="wechat"><b>微信公众号 <strong id="wechatCount">—</strong></b><span>中国医药、生物科技、政策与产业文章线索</span></button>
      </div>
    </section>
    <div class="toolbar">
      <div class="tabs" id="tabs"><button class="tab active" data-category="all">全部情报</button></div>
      <input class="search" id="search" type="search" placeholder="搜索药物、公司、靶点或事件…" aria-label="搜索行业情报">
    </div>
    <section class="content">
      <div class="news"><div class="feed" id="feed"><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div></div></div>
      <aside class="side">
        <h3>重点观察框架</h3>
        <div class="theme"><b>监管催化 <span>01</span></b><span>批准、安全性、审评与政策变化</span></div>
        <div class="theme"><b>临床催化 <span>02</span></b><span>III期读出、关键终点与失败风险</span></div>
        <div class="theme"><b>产业交易 <span>03</span></b><span>License-in/out、并购与合作</span></div>
        <div class="theme"><b>供应能力 <span>04</span></b><span>短缺、产能、CDMO与质量事件</span></div>
        <h3 style="margin-top:22px">数据连接</h3>
        <div class="source-list" id="sourceStatus"><div class="source"><span>公开新闻与监管来源</span><b class="ok">连接中</b></div></div>
        <div class="updated" id="updated">正在获取最新信息…</div>
      </aside>
    </section>
    <footer>公开信息聚合，仅用于行业情报研究，不构成医疗、投资或商业决策建议。</footer>
  </main>
  <script>
    const state={items:[],category:"all",query:""};
    const feed=document.getElementById("feed");
    const esc=(s="")=>s.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    const age=(iso)=>{const m=Math.max(1,Math.round((Date.now()-Date.parse(iso))/60000));return m<60?m+" 分钟前":m<1440?Math.round(m/60)+" 小时前":Math.round(m/1440)+" 天前"};
    function render(){
      const q=state.query.toLowerCase();
      const items=state.items.filter(x=>(state.category==="all"||x.category===state.category)&&(!q||(x.title+" "+x.summary+" "+x.source).toLowerCase().includes(q)));
      feed.innerHTML=items.length?items.map(x=>'<a class="card" href="'+esc(x.link)+'" target="_blank" rel="noopener"><div class="meta"><span class="badge">'+esc(x.categoryLabel)+'</span><span>'+esc(x.source)+'</span><span>·</span><span>'+age(x.pubDate)+'</span></div><h3>'+esc(x.title)+'</h3><p>'+esc(x.summary||"点击查看原始报道与完整内容。")+'</p></a>').join(""):'<div class="empty">当前筛选条件下暂无情报。</div>';
    }
    async function load(){
      document.getElementById("refresh").disabled=true;
      try{
        const r=await fetch("/api/news",{cache:"no-store"});if(!r.ok)throw new Error("fetch");
        const data=await r.json();state.items=data.items||[];
        document.getElementById("total").textContent=state.items.length;
        for(const id of ["regulatory","clinical","deals","china-policy","company-disclosure","market-data","wechat"])document.getElementById(id+"Count").textContent=state.items.filter(x=>x.category===id).length;
        const tabs=document.getElementById("tabs");
        tabs.innerHTML='<button class="tab active" data-category="all">全部情报</button>'+data.categories.map(c=>'<button class="tab" data-category="'+c.id+'">'+esc(c.label)+'</button>').join("");
        const chooseCategory=category=>{tabs.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.category===category));state.category=category;render()};
        tabs.querySelectorAll(".tab").forEach(btn=>btn.onclick=()=>chooseCategory(btn.dataset.category));
        document.querySelectorAll(".data-source").forEach(btn=>btn.onclick=()=>{chooseCategory(btn.dataset.category);document.querySelector(".toolbar").scrollIntoView({behavior:"smooth",block:"start"})});
        document.getElementById("updated").textContent="更新时间："+new Date(data.updatedAt).toLocaleString("zh-CN");
        document.getElementById("sourceStatus").innerHTML='<div class="source"><span>全球新闻与行业媒体</span><b class="'+(data.failed.length?"warn":"ok")+'">'+(data.failed.length?"部分可用":"正常")+'</b></div><div class="source"><span>中国政策与法定披露</span><b class="ok">正常</b></div><div class="source"><span>公开市场与销售线索</span><b class="ok">正常</b></div>';
        render();
      }catch(e){
        feed.innerHTML='<div class="empty">暂时无法连接新闻源，请稍后点击“刷新情报”。</div>';
        document.getElementById("updated").textContent="数据连接暂时不可用";
      }finally{document.getElementById("refresh").disabled=false}
    }
    document.getElementById("search").addEventListener("input",e=>{state.query=e.target.value;render()});
    document.getElementById("refresh").onclick=load;
    load();
  </script>
</body>
</html>`;

const worker = {
  async fetch(request, env = {}) {
    const url = new URL(request.url);
    if (url.pathname === "/api/news") return handleNews(request);
    if (url.pathname === "/og.png" && env.ASSETS?.fetch) {
      return env.ASSETS.fetch(new Request(new URL("/og.png", request.url)));
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML.replaceAll("__ORIGIN__", url.origin), {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "public, max-age=300",
          "x-content-type-options": "nosniff",
          "referrer-policy": "strict-origin-when-cross-origin",
          "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors *",
        },
      });
    }
    return new Response("Not found", { status: 404 });
  },
};

export default worker;
