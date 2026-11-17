// Llamascan dashboard. Reads window.RADAR, written by main.ts into ../data.js, and renders five
// static pages from it. No network: every figure on screen comes from the sealed snapshot model.

(function () {
  'use strict';
  var D = window.RADAR;
  var LOGOS = window.LLAMASCAN_LOGOS || { protocols: {}, chains: {} };
  var page = document.body.getAttribute('data-page') || 'index';
  var root = document.getElementById('main');
  if (!root) return;
  if (!D) { root.innerHTML = '<div class="state"><b>Data not loaded</b>Open this page from the dashboard folder with data.js beside it.</div>'; return; }

  function usd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var s = n < 0 ? '-$' : '$', a = Math.abs(n);
    if (a >= 1e12) return s + (a / 1e12).toFixed(2) + 'T';
    if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(1) + 'M';
    if (a >= 1e3) return s + Math.round(a / 1e3) + 'K';
    return s + Math.round(a);
  }
  function pct(n) { return n === null || n === undefined ? 'n/a' : n.toFixed(2) + '%'; }
  function age(d) { return d === null || d === undefined ? 'unknown' : d >= 365 ? (d / 365).toFixed(1) + 'y' : Math.round(d) + 'd'; }
  function cls(v) { return v === 'WORTH FARMING' ? 'worth' : v === 'SKIP' ? 'skip' : 'marg'; }
  function sig(v) { return v === 'WORTH FARMING' ? 0.18 : v === 'MARGINAL' ? 0.09 : 0.045; }

  function el(tag, attrs) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === 'text') n.textContent = v;
      else if (k === 'class') n.className = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) n.appendChild(x); });
      else if (typeof c === 'string' || typeof c === 'number') n.appendChild(document.createTextNode(String(c)));
      else n.appendChild(c);
    }
    return n;
  }
  function mount(id) { var e = document.getElementById(id); if (e) e.textContent = ''; return e; }
  function add(id) {
    return function () {
      var e = document.getElementById(id);
      if (e) Array.prototype.forEach.call(arguments, function (n) { if (n) e.appendChild(n); });
    };
  }

  function logoFor(kind, key) {
    var f = LOGOS[kind] && LOGOS[kind][key];
    if (!f) return null;
    return el('img', { src: 'logos/' + f, alt: '', width: '24', height: '24', 'aria-hidden': 'true' });
  }
  function chainIcon(name) {
    var f = LOGOS.chains && LOGOS.chains[name];
    return f ? el('img', { class: 'mini', src: 'logos/' + f, alt: '', width: '22', height: '22', 'aria-hidden': 'true' }) : null;
  }
  function chains(r) { return r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'unspecified'; }
  function detailHref(r) { return 'protocol.html?slug=' + encodeURIComponent(r.slug); }

  function protoCell(r) {
    var logo = logoFor('protocols', r.slug);
    var sub = (r.category || 'Uncategorized') + '  ' + chains(r);
    var label = el('span', { class: 'nm' }, r.name);
    if (r.watchlist) label.appendChild(el('span', { class: 'tag watch', text: 'WATCHLIST' }));
    return el('td', null, el('div', { class: 'proto' }, logo, el('span', null, label, el('span', { class: 'sub', text: sub }))));
  }
  function bandBar(r) {
    var lo = r.band.p10, hi = r.band.p90, span = Math.max(1, hi - lo);
    var l = Math.max(0, Math.min(100, ((r.band.p25 - lo) / span) * 100));
    var w = Math.max(1, Math.min(100 - l, ((r.band.p75 - r.band.p25) / span) * 100));
    var d = Math.max(0, Math.min(100, ((r.implied_value_usd - lo) / span) * 100));
    return el('div', { class: 'band' },
      el('span', { class: 'track' },
        el('i', { class: 'fill', style: 'left:' + l + '%;width:' + w + '%' }),
        el('i', { class: 'dot', style: 'left:' + d + '%' })),
      el('span', { class: 'v', text: usd(r.implied_value_usd) }));
  }

  function scatter() {
    var pts = D.sample || [], W = 420, H = 168, pad = 12;
    var xs = pts.map(function (p) { return Math.log10(Math.max(1, p.tvl)); });
    var ys = pts.map(function (p) { return Math.log10(Math.max(1, p.mcap)); });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    function X(x) { return pad + ((x - minX) / (maxX - minX || 1)) * (W - 2 * pad); }
    function Y(y) { return H - pad - ((y - minY) / (maxY - minY || 1)) * (H - 2 * pad); }
    var ns = 'http://www.w3.org/2000/svg';
    function svgEl(t, a) { var n = document.createElementNS(ns, t); Object.keys(a).forEach(function (k) { n.setAttribute(k, a[k]); }); return n; }
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart', role: 'img', 'aria-label': 'Market cap against TVL for the protocols that already trade, with the fitted line' });
    svg.appendChild(svgEl('path', { d: 'M' + pad + ' ' + (H - pad) + 'H' + (W - pad), stroke: '#d6d6d6', fill: 'none' }));
    svg.appendChild(svgEl('path', { d: 'M' + pad + ' ' + pad + 'V' + (H - pad), stroke: '#d6d6d6', fill: 'none' }));
    pts.forEach(function (p) {
      svg.appendChild(svgEl('circle', { cx: X(Math.log10(Math.max(1, p.tvl))), cy: Y(Math.log10(Math.max(1, p.mcap))), r: 2, fill: '#0a0a0a', opacity: 0.42 }));
    });
    var f = D.fit;
    // The fit is on log10(TVL / 1e8) and log10(mcap / 1e6). In raw log dollars:
    // log10(mcap) = intercept + slope * (log10(TVL) - 8) + 6.
    function fitY(x) { return f.intercept + f.slope * (x - 8) + 6; }
    svg.appendChild(svgEl('path', { d: 'M' + X(minX) + ' ' + Y(fitY(minX)) + 'L' + X(maxX) + ' ' + Y(fitY(maxX)), stroke: '#0a0a0a', 'stroke-width': 1.5, fill: 'none' }));
    svg.appendChild(svgEl('text', { x: pad + 4, y: H - 4, fill: '#5f6368', 'font-size': 9, 'font-family': 'monospace' }).appendChild(document.createTextNode('log TVL')).parentNode);
    svg.appendChild(svgEl('text', { x: pad + 4, y: 18, fill: '#5f6368', 'font-size': 9, 'font-family': 'monospace' }).appendChild(document.createTextNode('log market cap')).parentNode);
    return svg;
  }

  function state(title, text, href, linkText) {
    return el('div', { class: 'state' }, el('b', { text: title }), el('span', { text: text }),
      href ? ' ' : null, href ? el('a', { href: href, text: linkText }) : null);
  }

  function renderBoard() {
    var v = D.verdict_counts;
    add('kpis')(
      el('div', { class: 'kpi' }, el('div', { class: 'k', text: 'WATCHLIST COVERED' }), el('div', { class: 'v', text: D.watchlist_size + ' / ' + D.watchlist_size })),
      el('div', { class: 'kpi' }, el('div', { class: 'k', text: 'PRE-TOKEN RANKED' }), el('div', { class: 'v', text: String(D.board_size) }), el('div', { class: 's', text: D.early_size + ' below the floor' })),
      el('div', { class: 'kpi' }, el('div', { class: 'k', text: 'CURVE CALIBRATION' }), el('div', { class: 'v', text: String(D.fit.points) }), el('div', { class: 's', text: 'protocols that already trade' })),
      el('div', { class: 'kpi' }, el('div', { class: 'k', text: 'FARM VERDICTS' }), el('div', { class: 'v', text: v.worth + ' / ' + v.marginal + ' / ' + v.skip }), el('div', { class: 's', text: 'worth / marginal / skip' }))
    );
    add('duo')(
      el('section', { class: 'panel' }, el('div', { class: 'lbl', text: '01  HOW A LAUNCH IS PRICED' }),
        el('div', { class: 'formula', text: 'mcap = 10^a x (TVL / $100M)^b x 10^(growth + overdue)' }),
        el('div', { class: 'note', text: 'A log-log line fitted through ' + D.fit.points + ' protocols that already trade sets a = ' + D.fit.intercept + ' and b = ' + D.fit.slope + '. Seven-day TVL growth and the time a protocol has run with no recorded token move it along that line. The spread of the fit gives the P10 to P90 band on every row.' }),
        el('div', { class: 'note', text: 'Verdict = (' + (D.model.airdrop_share * 100).toFixed(2) + '% of implied value - $' + D.model.position_usd + ' position) / hours of work. An explicit assumption, not a promise of a launch.' })),
      el('section', { class: 'panel' }, el('div', { class: 'lbl', text: '02  THE CURVE THIS RADAR PRICES AGAINST' }), scatter(),
        el('div', { class: 'note', text: 'Each dot is a real protocol with a recorded token. The line is the fitted relationship. Pre-token protocols are priced by where they would sit on it.' }))
    );

    var params = new URLSearchParams(location.search);
    var st = {
      q: params.get('q') || '', cat: params.get('family') || 'all', chain: params.get('chain') || 'all',
      view: params.get('view') || 'radar', verdict: params.get('verdict') || 'all', sort: 'implied', dir: -1
    };
    var cats = ['all'].concat(D.categories);
    var chainNames = ['all'].concat(D.chain_counts.map(function (x) { return x.chain; }));
    function list() {
      var rows = st.view === 'live' ? D.live : st.view === 'watch' ? D.watch_rows : D.rows;
      var q = st.q.trim().toLowerCase();
      return rows.filter(function (r) {
        if (st.view === 'live') return !q || [r.name, r.slug, r.category].join(' ').toLowerCase().indexOf(q) >= 0;
        if (st.cat !== 'all' && r.category !== st.cat) return false;
        if (st.chain !== 'all' && (r.chains || []).indexOf(st.chain) < 0) return false;
        if (st.verdict !== 'all' && r.verdict !== st.verdict) return false;
        return !q || [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
      }).sort(function (a, b) {
        var key = st.sort, av, bv;
        if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
        else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
        else if (key === 'growth') { av = a.change_7d === null ? -1e9 : a.change_7d; bv = b.change_7d === null ? -1e9 : b.change_7d; }
        else if (key === 'implied') { av = a.implied_value_usd || a.mcap_usd || 0; bv = b.implied_value_usd || b.mcap_usd || 0; }
        else { av = a.net_per_hour || 0; bv = b.net_per_hour || 0; }
        if (av < bv) return -st.dir; if (av > bv) return st.dir;
        return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
      });
    }
    function th(label, key, right) {
      return el('th', { class: right ? 'r' : '', scope: 'col' }, el('button', { type: 'button', onclick: function () {
        if (st.sort === key) st.dir = -st.dir; else { st.sort = key; st.dir = -1; }
        paint();
      } }, label, st.sort === key ? (st.dir < 0 ? '  v' : '  ^') : ''));
    }
    function seg(label, val) { return el('button', { type: 'button', 'aria-pressed': st.view === val ? 'true' : 'false', text: label, onclick: function () { st.view = val; st.sort = val === 'live' ? 'implied' : 'implied'; paint(); } }); }
    function vbtn(label, val) { return el('button', { type: 'button', 'aria-pressed': st.verdict === val ? 'true' : 'false', text: label, onclick: function () { st.verdict = val; paint(); } }); }
    function paint() {
      var host = mount('ctls');
      var search = el('input', { type: 'search', placeholder: 'Search name, family or chain', value: st.q, oninput: function (e) { st.q = e.target.value; paintTable(); } });
      var cat = el('select', { 'aria-label': 'Protocol family', onchange: function (e) { st.cat = e.target.value; paintTable(); } },
        cats.map(function (c) { return el('option', { value: c, selected: c === st.cat ? true : null, text: c === 'all' ? 'All families' : c }); }));
      var chain = el('select', { 'aria-label': 'Chain', onchange: function (e) { st.chain = e.target.value; paintTable(); } },
        chainNames.map(function (c) { return el('option', { value: c, selected: c === st.chain ? true : null, text: c === 'all' ? 'All chains' : c }); }));
      host.appendChild(el('div', { class: 'field' }, el('label', { text: 'FIND' }), search));
      host.appendChild(el('div', { class: 'field' }, el('label', { text: 'FAMILY' }), cat));
      host.appendChild(el('div', { class: 'field' }, el('label', { text: 'CHAIN' }), chain));
      host.appendChild(el('div', { class: 'field' }, el('label', { text: 'VIEW' }), el('div', { class: 'seg' }, seg('RADAR', 'radar'), seg('WATCHLIST', 'watch'), seg('LIVE TOKENS', 'live'))));
      host.appendChild(el('div', { class: 'field' }, el('label', { text: 'VERDICT' }), el('div', { class: 'seg' }, vbtn('ALL', 'all'), vbtn('WORTH', 'WORTH FARMING'), vbtn('MARGINAL', 'MARGINAL'), vbtn('SKIP', 'SKIP'))));
      host.appendChild(el('div', { class: 'field' }, el('label', { text: 'MATCHES' }), el('span', { class: 'count', id: 'count', text: String(list().length) })));
      paintTable();
    }
    function paintTable() {
      var host = mount('board');
      var c = document.getElementById('count'); if (c) c.textContent = String(list().length);
      var rows = list(), live = st.view === 'live';
      if (!rows.length) { host.appendChild(state('No matches', 'Clear a filter or search for another protocol to see the board again.')); return; }
      var body = el('tbody');
      rows.forEach(function (r) {
        var tr = el('tr');
        var nameCell = el('td', null, el('a', { href: detailHref(r) }, protoCell(r)));
        if (live) {
          tr.appendChild(el('td', { class: 'rk', text: '-' }));
          tr.appendChild(nameCell);
          tr.appendChild(el('td', { class: 'r', text: usd(r.tvl_usd) }));
          tr.appendChild(el('td', { class: 'r growth ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: pct(r.change_7d) }));
          tr.appendChild(el('td', { class: 'r', text: usd(r.mcap_usd) }));
          tr.appendChild(el('td', { class: 'r meta', text: 'LIVE' }));
          body.appendChild(tr);
          return;
        }
        tr.appendChild(el('td', { class: 'rk' + (r.rank === 1 ? ' top' : ''), text: String(r.rank) }));
        tr.appendChild(nameCell);
        tr.appendChild(el('td', { class: 'r', text: usd(r.tvl_usd) }));
        tr.appendChild(el('td', { class: 'r growth ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'up' : 'down'), text: pct(r.change_7d) }));
        tr.appendChild(el('td', { class: 'r meta', text: age(r.age_days) }));
        tr.appendChild(el('td', null, bandBar(r)));
        tr.appendChild(el('td', { class: 'r meta', text: usd(r.net_if_launch) }));
        tr.appendChild(el('td', { class: 'r' }, el('span', { class: 'verdict ' + cls(r.verdict), text: r.verdict })));
        body.appendChild(tr);
      });
      var head = live
        ? el('tr', null, th('#', 'implied', true), th('PROTOCOL', 'name'), th('TVL', 'tvl', true), th('7D', 'growth', true), th('MARKET CAP', 'implied', true), th('TOKEN', 'name', true))
        : el('tr', null, th('#', 'implied', true), th('PROTOCOL', 'name'), th('TVL', 'tvl', true), th('7D', 'growth', true), th('NO TOKEN', 'growth', true), th('IMPLIED VALUE  P10-P90', 'implied', true), th('NET IF LAUNCH', 'net', true), th('VERDICT', 'name', true));
      var cap = live ? 'Already trading. Market cap is a fact from the snapshot, used to fit the curve and not part of the ranking.'
        : 'Pre-token protocols, strongest implied value first. Select a protocol for its model and farm plan.';
      host.appendChild(el('div', { class: 'scroll' }, el('table', null, el('caption', { text: cap }), el('thead', null, head), body)));
    }
    paint();
  }

  function valueBand(r) {
    var W = 620, H = 92, lo = r.band.p10, hi = r.band.p90, span = Math.max(1, hi - lo);
    function X(v) { return 16 + ((v - lo) / span) * (W - 32); }
    var ns = 'http://www.w3.org/2000/svg';
    function s(t, a) { var n = document.createElementNS(ns, t); Object.keys(a).forEach(function (k) { n.setAttribute(k, a[k]); }); return n; }
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'chart', role: 'img', 'aria-label': 'Value band from P10 to P90 with the implied value marked' });
    svg.appendChild(s('path', { d: 'M16 46H' + (W - 16), stroke: '#d6d6d6', fill: 'none' }));
    svg.appendChild(s('path', { d: 'M' + X(r.band.p10) + ' 46H' + X(r.band.p90), stroke: '#0a0a0a', 'stroke-width': 3, fill: 'none' }));
    svg.appendChild(s('path', { d: 'M' + X(r.band.p25) + ' 40V52M' + X(r.band.p75) + ' 40V52', stroke: '#0a0a0a', fill: 'none' }));
    svg.appendChild(s('circle', { cx: X(r.implied_value_usd), cy: 46, r: 6, fill: '#b23a20' }));
    [[r.band.p10, 'P10'], [r.band.p90, 'P90']].forEach(function (p) {
      svg.appendChild(s('text', { x: X(p[0]), y: 76, 'text-anchor': p[1] === 'P10' ? 'start' : 'end', fill: '#5f6368', 'font-size': 10, 'font-family': 'monospace' }).appendChild(document.createTextNode(usd(p[0]) + ' ' + p[1])).parentNode);
    });
    return svg;
  }

  function renderProtocol() {
    var slug = new URLSearchParams(location.search).get('slug');
    function fail(title, text) {
      var host = mount('main');
      host.appendChild(state(title, text, 'index.html', 'Back to the board'));
    }
    if (!slug) { fail('Select a protocol', 'Choose a row on the board to see its valuation and farm plan.'); return; }
    var r = D.rows.filter(function (x) { return x.slug === slug; })[0];
    if (!r) { fail('Unknown protocol', 'No ranked protocol is recorded under that reference.'); return; }
    var crumb = document.getElementById('crumb'); if (crumb) crumb.textContent = 'Board / ' + r.name;
    var head = mount('phead');
    head.appendChild(logoFor('protocols', r.slug) || el('span', { class: 'rk', text: '#' }));
    head.appendChild(el('div', null, el('h1', { text: r.name }), el('div', { class: 'meta', text: 'Rank ' + r.rank + ' of ' + D.board_size + '  ' + (r.category || 'Uncategorized') + '  ' + chains(r) })));
    var f = mount('pfacts');
    [['TVL', usd(r.tvl_usd)], ['7-day TVL change', pct(r.change_7d)], ['First tracked', r.listed_at || 'unknown'],
     ['Time with no recorded token', age(r.age_days)], ['Fitted curve value', usd(r.curve_value_usd)],
     ['Growth effect', (r.growth_effect >= 0 ? '+' : '') + r.growth_effect], ['Overdue effect', (r.overdue_effect >= 0 ? '+' : '') + r.overdue_effect],
     ['P10', usd(r.band.p10)], ['P25', usd(r.band.p25)], ['Implied value', usd(r.implied_value_usd)],
     ['P75', usd(r.band.p75)], ['P90', usd(r.band.p90)], ['Net if launch', usd(r.net_if_launch)],
     ['Net per hour', '$' + r.net_per_hour], ['Farm verdict', r.verdict]
    ].forEach(function (x) { f.appendChild(el('tr', null, el('td', { text: x[0] }), el('td', { text: x[1] }))); });
    mount('pband').appendChild(el('div', { class: 'panel' }, el('div', { class: 'lbl', text: 'VALUE BAND  P10 TO P90' }), valueBand(r),
      el('div', { class: 'note', text: 'The spread comes from the residuals of the fitted line across ' + D.fit.points + ' protocols that trade. It is a range of estimates, not a forecast of a launch.' })));
    var steps = mount('psteps');
    r.farm_steps.forEach(function (s) {
      var t = s, cost = '', time = '';
      var a = s.indexOf(' Cost: '), b = s.indexOf('. Time: ');
      if (a >= 0 && b > a) { t = s.slice(0, a); cost = s.slice(a + 7, b); time = s.slice(b + 8).replace(/\.$/, ''); }
      steps.appendChild(el('li', null, el('span', { class: 't', text: t }), el('span', { class: 'c', text: cost }), el('span', { class: 'd', text: time })));
    });
    var rel = D.rows.filter(function (x) { return x.slug !== r.slug && x.category === r.category; }).slice(0, 5);
    var box = mount('prelated');
    if (!rel.length) box.appendChild(el('div', { class: 'note', text: 'No other ranked protocol shares this family.' }));
    else rel.forEach(function (x) {
      box.appendChild(el('div', { class: 'bar' }, el('a', { href: detailHref(x), text: x.name }), el('span', { class: 'n', text: usd(x.implied_value_usd) })));
    });
  }

  function renderMethod() {
    var fit = D.fit, m = D.model;
    var host = mount('mfit');
    [['Fitted intercept a', String(fit.intercept)], ['Fitted slope b', String(fit.slope)],
     ['Protocols used in the fit', String(fit.points)], ['Residual standard deviation', String(fit.residual_sd)],
     ['Snapshot date', D.as_of], ['Watchlist floor', usd(D.floor_usd)]
    ].forEach(function (x) { host.appendChild(el('tr', null, el('td', { text: x[0] }), el('td', { text: x[1] }))); });
    var c = mount('mconst');
    [['Growth weight', String(m.growth_weight)], ['Growth floor and cap', m.growth_floor + '% to +' + m.growth_cap + '%'],
     ['Overdue boost', String(m.overdue_boost)], ['Overdue cap', m.overdue_days_cap + ' days'],
     ['Band z for P10 and P90', String(m.z80)], ['Band z for P25 and P75', String(m.z50)],
     ['Assumed share received', (m.airdrop_share * 100).toFixed(2) + '%'], ['Assumed position', '$' + m.position_usd],
     ['Hours per weekly action', String(m.hours_per_action)]
    ].forEach(function (x) { c.appendChild(el('tr', null, el('td', { text: x[0] }), el('td', { text: x[1] }))); });
    mount('mchart').appendChild(el('div', { class: 'panel' }, el('div', { class: 'lbl', text: 'THE FITTED RELATIONSHIP' }), scatter(),
      el('div', { class: 'note', text: 'The line is fitted on log10(TVL / $100M) against log10(market cap / $1M). In raw dollars the line is mcap = 10^a x (TVL / $100M)^b x $1M.' })));
  }

  function renderCoverage() {
    var s = mount('cfacts');
    [['Snapshot date', D.as_of], ['Protocols in the snapshot', '758'], ['Protocols at or above the floor', String(D.watchlist_size)],
     ['Watchlist floor', usd(D.floor_usd)], ['Pre-token protocols ranked', String(D.board_size)],
     ['Already trading, used to fit the curve', String(D.fit.points)], ['Source', 'DefiLlama protocols endpoint']
    ].forEach(function (x) { s.appendChild(el('tr', null, el('td', { text: x[0] }), el('td', { text: x[1] }))); });
    var w = mount('cwatch');
    D.watch_rows.forEach(function (r) {
      w.appendChild(el('tr', null, el('td', null, el('a', { href: detailHref(r) }, el('span', { class: 'proto' }, logoFor('protocols', r.slug), el('span', { text: r.name })))),
        el('td', { class: 'r', text: usd(r.tvl_usd) }), el('td', { class: 'r', text: usd(r.implied_value_usd) }),
        el('td', { class: 'r' }, el('span', { class: 'verdict ' + cls(r.verdict), text: r.verdict }))));
    });
    var maxF = D.family_counts[0] ? D.family_counts[0].count : 1;
    var fam = mount('cfamily');
    D.family_counts.slice(0, 14).forEach(function (x) {
      fam.appendChild(el('div', { class: 'bar' }, el('span', { text: x.family }), el('span', { class: 'rail' }, el('i', { class: 'fill', style: 'width:' + (x.count / maxF * 100) + '%' })), el('span', { class: 'n', text: String(x.count) })));
    });
    var maxC = D.chain_counts[0] ? D.chain_counts[0].count : 1;
    var ch = mount('cchain');
    D.chain_counts.slice(0, 14).forEach(function (x) {
      var name = el('span', { text: x.chain }); var icon = chainIcon(x.chain); if (icon) name.insertBefore(icon, name.firstChild);
      ch.appendChild(el('div', { class: 'bar' }, name, el('span', { class: 'rail' }, el('i', { class: 'fill', style: 'width:' + (x.count / maxC * 100) + '%' })), el('span', { class: 'n', text: String(x.count) })));
    });
  }

  if (page === 'index') renderBoard();
  else if (page === 'protocol') renderProtocol();
  else if (page === 'method') renderMethod();
  else if (page === 'coverage') renderCoverage();
})();
