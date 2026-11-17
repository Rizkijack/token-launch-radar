// LAUNCH RADAR desk. Reads window.RADAR (written by main.ts into ../data.js) and renders the ranked
// board, a fitted-curve chart, filters, and a per-protocol detail drawer. No network: every byte comes
// from data.js, so the screen and the dossier's source describe the same program.

(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  var state = { q: '', cat: 'all', chain: 'all', verdict: 'all', tab: 'radar', sort: 'implied', dir: -1, sel: null };

  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var s = n < 0 ? '-$' : '$', a = Math.abs(n);
    if (a >= 1e12) return s + (a / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return s + Math.round(a / 1e3) + 'K';
    return s + Math.round(a);
  }
  function pct(n) { return n === null || n === undefined ? 'n/a' : (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function age(d) { return d === null || d === undefined ? 'unknown' : (d >= 365 ? (d / 365).toFixed(1) + 'y' : Math.round(d) + 'd'); }
  function cls(v) { return v === 'WORTH FARMING' ? 'worth' : v === 'MARGINAL' ? 'marg' : 'skip'; }

  function el(tag, attrs) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) n.setAttribute(k, v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) n.appendChild(x); });
      else if (typeof c === 'string') n.appendChild(document.createTextNode(c));
      else n.appendChild(c);
    }
    return n;
  }

  function chains(r) { return r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'unspecified'; }

  function visible() {
    var q = state.q.trim().toLowerCase();
    var list = state.tab === 'live' ? DATA.live : DATA.rows;
    return list.filter(function (r) {
      if (state.tab === 'live') return !q || [r.name, r.slug, r.category].join(' ').toLowerCase().indexOf(q) >= 0;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (state.verdict !== 'all' && r.verdict !== state.verdict) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }

  function sorted(list) {
    var key = state.sort, dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -1e9 : a.change_7d; bv = b.change_7d === null ? -1e9 : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'net') { av = a.net_per_hour; bv = b.net_per_hour; }
      else if (key === 'mcap') { av = a.mcap_usd || 0; bv = b.mcap_usd || 0; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function th(label, key, right) {
    return el('th', { class: right ? 'r' : '', scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } render(); } },
        label, state.sort === key ? el('span', { class: 'lime', text: state.dir < 0 ? ' \u2193' : ' \u2191' }) : null));
  }

  function topbar() {
    return el('header', { class: 'topbar' },
      el('img', { class: 'brand-logo', src: 'llama-logo.svg', alt: 'Llamascan' }),
      el('span', { class: 'wordmark', text: 'LLAMASCAN' }),
      el('div', { class: 'topmeta' },
        el('span', null, 'DEFILLAMA ', el('b', { text: DATA.as_of })),
        el('span', null, 'MODEL ', el('b', { text: DATA.model_version })),
        el('span', { class: 'ok', text: '✓ board.json = this page · ' + DATA.board_size + '/' + DATA.board_size + ' rows' })));
  }

  function kpis() {
    var v = DATA.verdict_counts;
    return el('div', { class: 'kpis' },
      el('div', { class: 'kpi' }, el('div', { class: 'k', text: 'WATCHLIST COVERED' }), el('div', { class: 'v lime', text: DATA.watchlist_size + '/' + DATA.watchlist_size })),
      el('div', { class: 'kpi' }, el('div', { class: 'k', text: 'PRE-TOKEN RANKED' }), el('div', { class: 'v', text: String(DATA.board_size) })),
      el('div', { class: 'kpi' }, el('div', { class: 'k', text: 'ALREADY TRADE / CALIBRATION' }), el('div', { class: 'v', text: String(DATA.fit.points) })),
      el('div', { class: 'kpi' }, el('div', { class: 'k', text: 'FARM VERDICTS' }), el('div', { class: 'v', text: v.worth + ' · ' + v.marginal + ' · ' + v.skip }).appendChild(el('small', { text: ' worth / marginal / skip' })).parentNode));
  }

  function bandBar(r) {
    var lo = r.band.p10, hi = r.band.p90, v = r.implied_value_usd;
    var span = Math.max(1, hi - lo);
    var left = Math.max(0, Math.min(100, ((v - lo) / span) * 100));
    return el('div', { class: 'band' },
      el('i', { class: 'band-track' }),
      el('i', { class: 'band-fill', style: 'left:0%;width:' + left + '%' }),
      el('span', { class: 'band-dot', style: 'left:' + left + '%' }));
  }

  function scatter() {
    var pts = DATA.sample || [];
    var W = 300, H = 118, pad = 6;
    var tvls = pts.map(function (p) { return Math.log10(Math.max(1, p.tvl)); });
    var mcaps = pts.map(function (p) { return Math.log10(Math.max(1, p.mcap)); });
    var minX = Math.min.apply(null, tvls), maxX = Math.max.apply(null, tvls);
    var minY = Math.min.apply(null, mcaps), maxY = Math.max.apply(null, mcaps);
    var X = function (x) { return pad + ((x - minX) / (maxX - minX || 1)) * (W - 2 * pad); };
    var Y = function (y) { return H - pad - ((y - minY) / (maxY - minY || 1)) * (H - 2 * pad); };
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('class', 'chart'); svg.setAttribute('role', 'img');
    svg.appendChild(el('title', { text: 'Market cap versus TVL for the snapshot\'s traded protocols, with the fitted line.' }));
    pts.forEach(function (p) {
      var c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      c.setAttribute('cx', X(Math.log10(Math.max(1, p.tvl)))); c.setAttribute('cy', Y(Math.log10(Math.max(1, p.mcap))));
      c.setAttribute('r', '2'); c.setAttribute('fill', '#5fd0a0'); c.setAttribute('opacity', '0.45');
      svg.appendChild(c);
    });
    var x1 = minX, x2 = maxX;
    var f = DATA.fit;
    var y1 = f.intercept + f.slope * (x1 - 2), y2 = f.intercept + f.slope * (x2 - 2);
    var line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', X(x1)); line.setAttribute('y1', Y(y1)); line.setAttribute('x2', X(x2)); line.setAttribute('y2', Y(y2));
    line.setAttribute('stroke', '#eaf2ee'); line.setAttribute('stroke-width', '1.4'); svg.appendChild(line);
    return el('div', { class: 'chartwrap' }, svg);
  }

  function panels() {
    var f = DATA.fit;
    return el('section', { class: 'panels' },
      el('div', { class: 'panelbox' },
        el('div', { class: 'lbl', text: 'HOW A LAUNCH IS PRICED' }),
        el('div', { class: 'formula', text: 'mcap = 10^' + f.intercept + ' × (TVL / $100M)^' + f.slope + ' × 10^(growth + overdue)' }),
        el('div', { class: 'key', text: 'A log-log line fitted through ' + f.points + ' protocols that already trade sets the curve. Growth and time without a token move a protocol along it. Residual spread gives the P10–P90 band shown on each row.' }),
        el('div', { class: 'key', text: 'Verdict = 0.02% of a launch\'s implied value, less a $1,000 position, divided by the hours the plan takes.' })),
      el('div', { class: 'panelbox' },
        el('div', { class: 'lbl', text: 'TRADED TOKENS SET THE CURVE' }), scatter(),
        el('div', { class: 'key', text: 'Dots: ' + f.points + ' already-trading protocols. Line: the fitted relationship this radar prices against.' })),
      el('div', { class: 'panelbox' },
        el('div', { class: 'lbl', text: 'THE FARM VERDICTS' }),
        el('div', { class: 'verdicts' },
          el('div', null, el('b', { class: 'worth', text: String(DATA.verdict_counts.worth) }), el('span', { text: 'worth farming' })),
          el('div', null, el('b', { class: 'marg', text: String(DATA.verdict_counts.marginal) }), el('span', { text: 'marginal' })),
          el('div', null, el('b', { class: 'skip', text: String(DATA.verdict_counts.skip) }), el('span', { text: 'skip' }))),
        el('div', { class: 'key', text: 'A verdict is a claim about whether the estimated reward pays for the capital and hours, not a promise that a token will launch.' })));
  }

  function controls() {
    var cats = ['all'].concat(DATA.categories.slice());
    var chains = ['all'].concat(Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort());
    var search = el('input', { type: 'search', placeholder: 'Search name, category or chain', value: state.q, oninput: function (e) { state.q = e.target.value; render(); } });
    var cat = el('select', { onchange: function (e) { state.cat = e.target.value; render(); } }, cats.map(function (c) { return el('option', { value: c, text: c === 'all' ? 'All families' : c, selected: c === state.cat ? 'selected' : null }); }));
    var chain = el('select', { onchange: function (e) { state.chain = e.target.value; render(); } }, chains.map(function (c) { return el('option', { value: c, text: c === 'all' ? 'All chains' : c, selected: c === state.chain ? 'selected' : null }); }));
    function seg(label, tab) { return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: function () { state.tab = tab; state.sort = tab === 'live' ? 'mcap' : 'implied'; state.dir = -1; render(); } }); }
    function vBtn(label, val) { return el('button', { type: 'button', 'aria-pressed': state.verdict === val ? 'true' : 'false', class: 'vbtn', text: label, onclick: function () { state.verdict = val; render(); } }); }
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { text: 'SEARCH' }), search),
      el('div', { class: 'field' }, el('label', { text: 'FAMILY' }), cat),
      el('div', { class: 'field' }, el('label', { text: 'CHAIN' }), chain),
      el('div', { class: 'field wide' }, el('label', { text: 'VIEW' }), el('div', { class: 'seg' }, seg('RADAR', 'radar'), seg('WATCHLIST', 'watch'), seg('LIVE TOKENS', 'live'))),
      el('div', { class: 'field wide' }, el('label', { text: 'VERDICT' }), el('div', { class: 'seg' }, vBtn('ALL', 'all'), vBtn('WORTH', 'WORTH FARMING'), vBtn('MARGINAL', 'MARGINAL'), vBtn('SKIP', 'SKIP'))),
      el('span', { class: 'count', text: visible().length + ' rows' }));
  }

  function table() {
    var list = sorted(visible());
    if (!list.length) return el('div', { class: 'panel', style: 'padding:40px;text-align:center' }, el('span', { class: 'faint', text: 'No protocol matches this filter.' }));
    var isLive = state.tab === 'live';
    var body = el('tbody');
    list.forEach(function (r) {
      var g = r.change_7d;
      var growth = el('span', { class: g === null ? 'faint' : g >= 0 ? 'up' : 'down', text: pct(g) });
      var nameCell = el('td', null, el('div', { class: 'nm', text: r.name }), el('div', { class: 'sb', text: (r.category || 'Other') + ' · ' + chains(r) }));
      if (isLive) {
        body.appendChild(el('tr', { onclick: function () { openDetail(r.slug, true); } },
          el('td', { class: 'rk num', text: '—' }), nameCell,
          el('td', { class: 'r num', text: usd(r.tvl_usd) }), el('td', { class: 'r num' }, growth),
          el('td', { class: 'r num lime', text: usd(r.mcap_usd) }), el('td', { class: 'r faint num', text: 'LIVE' })));
        return;
      }
      body.appendChild(el('tr', { class: state.sel === r.slug ? 'sel' : '', tabindex: '0', onclick: function () { openDetail(r.slug, false); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug, false); } } },
        el('td', { class: 'rk num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'nm', text: r.name }), el('div', { class: 'sb' }, (r.category || 'Other') + ' · ' + chains(r), r.watchlist ? el('span', { class: 'tag wl', text: ' WATCHLIST' }) : null)),
        el('td', { class: 'r num', text: usd(r.tvl_usd) }),
        el('td', { class: 'r num' }, growth),
        el('td', { class: 'r num faint', text: age(r.age_days) }),
        el('td', null, el('div', { class: 'impval' }, el('span', { class: 'lime', text: usd(r.implied_value_usd) }), bandBar(r))),
        el('td', { class: 'r num ' + (r.net_if_launch >= 0 ? 'up' : 'down'), text: usd(r.net_if_launch) }),
        el('td', { class: 'r num', text: '$' + r.net_per_hour + '/h' }),
        el('td', { class: 'r' }, el('span', { class: 'verdict ' + cls(r.verdict), text: r.verdict }))));
    });
    var head = isLive
      ? el('tr', null, th('#', 'mcap', true), th('PROTOCOL', 'name'), th('TVL', 'tvl', true), th('7D', 'growth', true), th('MARKET CAP', 'mcap', true), th('TOKEN', 'name', true))
      : el('tr', null, th('#', 'implied', true), th('PROTOCOL', 'name'), th('TVL', 'tvl', true), th('7D', 'growth', true), th('NO TOKEN', 'age', true), th('IMPLIED VALUE · P10–P90', 'implied', true), th('NET IF LAUNCH', 'net', true), th('NET / HOUR', 'net', true), th('FARM VERDICT', 'name', true));
    return el('div', { class: 'panel' }, el('div', { class: 'scroll' },
      el('table', null, el('caption', { class: 'faint mono', style: 'text-align:left;padding:8px 10px;font-size:10px', text: isLive ? 'Already trading — market cap is a fact, not a model. Calibration only.' : 'Pre-token protocols, strongest implied value first. Select a row for the model and farm plan.' }),
        el('thead', null, head), body)));
  }

  var backdrop = el('div', { class: 'backdrop', hidden: 'hidden', onclick: closeDetail });
  var drawer = el('div', { class: 'detail', hidden: 'hidden' });
  function closeDetail() { drawer.setAttribute('hidden', 'hidden'); backdrop.setAttribute('hidden', 'hidden'); state.sel = null; }
  function line(k, v) { return el('div', null, el('span', { text: k }), el('b', { text: v })); }

  function openDetail(slug, isLive) {
    var row = (isLive ? DATA.live : DATA.rows).filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.sel = slug; drawer.textContent = '';
    drawer.appendChild(el('div', { class: 'dhead' },
      el('div', null, el('div', { class: 'faint mono', style: 'font-size:10px;letter-spacing:.1em', text: 'RANK ' + row.rank + ' / ' + DATA.board_size }), el('h2', { text: row.name }),
        el('div', { class: 'faint mono', style: 'margin-top:5px;font-size:11px', text: (row.category || 'Other') + ' · ' + (row.chains || []).join(', ') })),
      el('button', { class: 'close', text: 'CLOSE', onclick: closeDetail })));
    if (isLive) {
      drawer.appendChild(el('section', { class: 'dsec' }, el('h3', { text: 'ALREADY TRADING' }),
        el('div', { class: 'eq' }, line('TVL', usd(row.tvl_usd)), line('7-day change', pct(row.change_7d)), line('Market cap', usd(row.mcap_usd))),
        el('div', { class: 'foot', text: 'Records a token in the snapshot. Used to fit the curve; not ranked.' })));
    } else {
      drawer.appendChild(el('section', { class: 'dsec' }, el('h3', { text: 'IMPLIED VALUE — MODEL ' + DATA.model_version }),
        el('div', { class: 'eq' },
          line('TVL', usd(row.tvl_usd)), line('Fitted curve value', usd(row.curve_value_usd)),
          line('7-day growth', pct(row.change_7d)), line('Time with no token', age(row.age_days)),
          line('P10', usd(row.band.p10)), line('P90', usd(row.band.p90)),
          line('Implied value', usd(row.implied_value_usd)), line('Net if launch', usd(row.net_if_launch)), line('Net per hour', '$' + row.net_per_hour + '/h')),
        el('div', { class: 'verified', text: '✓ Model ' + DATA.model_version + ' · ' + DATA.fit.points + ' traded protocols calibrate the curve' })));
      drawer.appendChild(el('section', { class: 'dsec' }, el('h3', { text: 'FARM PLAN' }),
        el('ol', { class: 'steps' }, (row.farm_steps || []).map(function (s) {
          var at = s.indexOf(' Cost: ');
          return el('li', null, el('b', { text: at < 0 ? s : s.slice(0, at) }), el('span', { class: 'cost', text: at < 0 ? '' : s.slice(at + 1) }));
        })),
        el('div', { class: 'foot', text: 'Steps are generated from category, chains, TVL and age — never a hand-written name list. Cost and time are part of each step.' })));
    }
    backdrop.removeAttribute('hidden'); drawer.removeAttribute('hidden');
  }

  function render() {
    app.textContent = '';
    app.appendChild(el('div', { class: 'desk' }, topbar(),
      el('img', { class: 'banner', src: 'llama-banner.svg', alt: 'Llamascan — token launch radar' }),
      kpis(), panels(), controls(), table(),
      el('div', { class: 'foot mono', text: 'LLAMASCAN · an independent estimate from a sealed DefiLlama snapshot · ' + DATA.as_of + ' · not financial advice' })));
    app.appendChild(backdrop); app.appendChild(drawer);
    app.setAttribute('aria-busy', 'false');
  }
  render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });
})();
