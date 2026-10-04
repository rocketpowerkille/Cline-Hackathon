export const visualizerPage = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Warden — Demo Studio</title><link rel="stylesheet" href="/style.css"><script src="/app.js" defer></script></head>
<body>
<header><a class="brand" href="/" aria-label="Warden Demo Studio"><span class="logo">W</span> WARDEN <span class="brand-sub">DEMO STUDIO</span></a><div class="header-right"><a href="/capabilities" style="color:var(--lime);font-size:11px">All capabilities ↗</a><span class="verified" id="verification">LOADING EVIDENCE</span><button id="cinema">Recording mode</button><button id="fullscreen">Fullscreen</button></div></header>
<main>
<section class="intro"><div><p class="eyebrow">LOCAL AGENT DETECTION & RESPONSE</p><h1>The attack remembers.<br><span>So does Warden.</span></h1><p class="subtitle">One poisoned issue. Two agents. A credential at risk.</p></div><aside class="context"><span class="tiny">ASSESSMENT CONTEXT</span><h2>OpenDots</h2><p>Persistent AI coworkers with their own computers.</p><span class="context-tag">CHECKOUT LEFT UNCHANGED</span><p class="context-note">This animation replays the separate, executed Warden offline demo — not a live OpenDots exploit.</p></aside></section>
<nav class="chapters" aria-label="Replay chapters"><button data-chapter="unprotected" class="selected"><span>01</span> Without Warden</button><button data-chapter="protected"><span>02</span> With Warden</button><button data-chapter="recovery"><span>03</span> Response & recovery</button><button id="assessment-toggle" aria-expanded="false">OpenDots findings ↗</button></nav>
<section id="assessment" hidden><div><p class="eyebrow">PRIOR READ-ONLY ASSESSMENT · NOT A LIVE FEED</p><h2>Good application boundaries. An observation gap.</h2><p>In-memory probes rejected forged tokens, hostile origins, traversal, private browser addresses, disabled shell use, and owner-only controls.</p></div><div><h3>Missing result hooks</h3><p>The inspected installation lacked Cline PostToolUse and Cursor result-observation hooks. A trusted opaque script was permitted; after poisoned-output observation, the same command was blocked in an isolated test.</p><p class="warning">Editor hooks do not automatically protect the Dots' runtime tools. Mock recovery is not real provider rotation.</p></div></section>
<section class="stage" aria-label="Animated attack chain"><div class="stage-heading"><span id="chapter-label">01 / WITHOUT WARDEN</span><span id="boundary">UNPROTECTED PATH</span></div>
<div class="flow"><article data-node="issue"><span class="node-icon">↳</span><span class="node-label">UNTRUSTED INPUT</span><h3>Poisoned issue</h3><p>Hidden setup instructions</p><span class="node-state">Waiting</span></article><span class="connector">→</span><article data-node="cursor"><span class="node-icon">⌘</span><span class="node-label">AGENT / DAY 1</span><h3>Cursor</h3><p>Reads and persists</p><span class="node-state">Waiting</span></article><span class="connector">→</span><article data-node="files"><span class="node-icon">≡</span><span class="node-label">PERSISTENT STATE</span><h3>AGENTS.md</h3><p>+ scripts/setup.sh</p><span class="node-state">Waiting</span></article><span class="connector">→</span><article data-node="cline"><span class="node-icon">&gt;_</span><span class="node-label">AGENT / DAY 2</span><h3>Cline</h3><p>Trust crosses sessions</p><span class="node-state">Waiting</span></article><span class="connector">→</span><article data-node="sandbox"><span class="node-icon">◇</span><span class="node-label">EXECUTION BOUNDARY</span><h3 id="gate-title">No guard</h3><p id="gate-description">Direct execution</p><span class="node-state">Waiting</span></article><span class="connector">→</span><article data-node="egress"><span class="node-icon">↗</span><span class="node-label">LOCAL MOCK ATTACKER</span><h3>Credential egress</h3><p>Fake token only</p><span class="node-state">Waiting</span></article></div>
<div class="recovery-strip" data-node="recovery"><span class="node-icon">↺</span><div><span class="node-label">DETERMINISTIC RESPONDER</span><h3>Investigate → mock rotate → restore → quarantine</h3></div><span class="node-state">Awaiting response</span></div>
<div class="metrics"><div><span>UNPROTECTED LEAKS</span><strong id="leaks">—</strong><small>localhost / fake credential</small></div><div><span>PROTECTED LEAKS</span><strong id="protected-leaks">—</strong><small>verified demo outcome</small></div><div><span>SESSION RISK BUDGET</span><strong id="risk">0.00</strong><small>cumulative, per session</small></div><div><span>SCORING BACKEND</span><strong id="backend">—</strong><small>no cloud calls in this viewer</small></div></div></section>
<section class="detail-grid"><article class="current-event"><div class="event-heading"><span id="status" class="pill">READY</span><span id="actor">REPLAY</span><span id="event-count">0 / 0</span></div><h2 id="action">Preparing verified evidence…</h2><p id="detail">The viewer never runs commands against OpenDots.</p><div class="narration" id="narration">Watch an attack persist across agents and sessions.</div></article><article class="ledger"><div class="ledger-heading"><h2>Decision stream</h2><span>EXECUTED DEMO REPLAY</span></div><ol id="stream" aria-label="Recent replay events"></ol></article></section>
<section class="controls" aria-label="Replay controls"><button id="restart" title="Restart (R)">↺ Restart</button><button id="back" title="Previous (Left arrow)">←</button><button id="play" class="primary" title="Play or pause (Space)" disabled>Play replay</button><button id="next" title="Next (Right arrow)">→</button><label class="scrub-label" for="scrub">Timeline</label><input id="scrub" type="range" min="0" max="0" value="0" aria-label="Replay timeline"><label for="speed">Speed</label><select id="speed"><option value="1">1× · cinematic</option><option value="1.5">1.5×</option><option value="2">2×</option><option value="0.5">0.5×</option></select></section>
<footer><span>VERIFIED OFFLINE REPLAY · TEMP REPOSITORIES · FAKE CREDENTIALS · MOCK ROTATION</span><span id="timestamp">Loading…</span><span class="keyboard">SPACE play · ← → step · R restart · C clean view · F fullscreen</span></footer>
</main></body></html>`;

export const visualizerStyle = `
:root{color-scheme:dark;--bg:#0b0e13;--panel:#121820;--line:#27303b;--muted:#8f9bab;--lime:#c5f66b;--red:#ff7382;--blue:#82b4ff;--amber:#ffd083;font-family:Inter,"Segoe UI",Arial,sans-serif}*{box-sizing:border-box}body{margin:0;background:radial-gradient(ellipse at 75% 5%,#1d2c23 0,transparent 40%),var(--bg);color:#f4f6fa}button,select{font:inherit;color:inherit;background:#19212b;border:1px solid var(--line);border-radius:8px;cursor:pointer;padding:10px 15px}button:hover{border-color:var(--lime)}button:disabled{opacity:.4;cursor:wait}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--lime);outline-offset:4px}header{height:76px;border-bottom:1px solid var(--line);padding:0 4%;display:flex;align-items:center;justify-content:space-between}.brand{color:#fff;text-decoration:none;font-weight:800;letter-spacing:3px;display:flex;align-items:center;gap:12px}.logo{display:grid;place-items:center;color:#10160b;background:var(--lime);width:34px;height:38px;clip-path:polygon(0 0,100% 0,100% 72%,50% 100%,0 72%);letter-spacing:0}.brand-sub{font-size:10px;color:var(--muted);letter-spacing:2px;border-left:1px solid var(--line);padding-left:15px}.header-right{display:flex;align-items:center;gap:12px}.verified{font-size:10px;letter-spacing:1.5px;color:var(--lime)}main{max-width:1800px;margin:auto;padding:28px 4% 15px}.intro{display:flex;justify-content:space-between;gap:40px;align-items:center;margin-bottom:27px}.eyebrow,.tiny{font-size:10px;color:var(--lime);letter-spacing:2px;font-weight:700}.eyebrow{margin:0 0 13px}h1{font-size:clamp(32px,3.1vw,56px);line-height:1.05;letter-spacing:-2px;margin:0}h1 span{color:var(--lime)}.subtitle{color:var(--muted);font-size:15px;margin:15px 0 0}.context{max-width:355px;border-left:2px solid var(--line);padding-left:24px}.context h2{margin:6px 0;font-size:25px}.context p{color:var(--muted);font-size:12px;line-height:1.5;margin:8px 0}.context .context-note{font-size:11px}.context-tag{font-size:9px;letter-spacing:1px;color:var(--lime)}.chapters{display:flex;gap:8px;margin-bottom:15px}.chapters button{background:transparent;color:var(--muted);font-size:12px}.chapters button span{margin-right:10px;font-family:monospace}.chapters button.selected{color:var(--lime);border-color:#769441;background:#c5f66b0d}#assessment-toggle{margin-left:auto}#assessment{border:1px solid #675233;border-radius:12px;padding:20px;margin-bottom:18px;background:#201b14}#assessment:not([hidden]){display:grid;grid-template-columns:1fr 1fr;gap:35px}#assessment h2{font-size:20px}#assessment h3{font-size:15px}#assessment p{font-size:12px;line-height:1.6;color:#c2c8d0}#assessment .warning{color:var(--amber)}.stage{background:linear-gradient(135deg,#151d25,#10151c);border:1px solid var(--line);border-radius:15px;padding:20px 24px 0;overflow:hidden}.stage-heading{display:flex;justify-content:space-between;font-size:10px;font-weight:700;letter-spacing:2px;color:var(--muted);margin-bottom:23px}#boundary{color:var(--red)}.flow{display:flex;align-items:center}.flow article{flex:1;min-width:0;background:#0d1219;border:1px solid #2a3542;border-radius:10px;padding:17px 12px;min-height:155px;transition:border-color .5s,background .5s,box-shadow .5s,transform .5s}.node-icon{font-size:25px;display:block;color:var(--muted);height:37px}.node-label{display:block;font-size:8px;color:var(--muted);font-weight:700;letter-spacing:1px}.flow h3{font-size:15px;white-space:nowrap;margin:10px 0 5px}.flow p{font-size:10px;color:var(--muted);margin:0 0 17px}.node-state{font-size:9px;font-weight:700;letter-spacing:1px;color:#647182;display:block}.connector{padding:0 9px;color:#495567;font-size:21px}.flow article.active{border-color:var(--blue);box-shadow:0 0 24px #82b4ff13;transform:translateY(-3px)}.flow article.active .node-icon{color:var(--blue)}[data-node].danger{border-color:#a3505c;background:#27161e}[data-node].danger .node-state,[data-node].danger .node-icon{color:var(--red)}[data-node].safe{border-color:#627e3b;background:#19241a}[data-node].safe .node-state,[data-node].safe .node-icon{color:var(--lime)}[data-node].hold{border-color:#8b7147}[data-node].hold .node-state{color:var(--amber)}.recovery-strip{display:flex;align-items:center;gap:17px;margin:17px 0 0;border:1px dashed #344132;border-radius:9px;padding:13px 17px;transition:background .5s,border-color .5s}.recovery-strip .node-icon{height:auto;color:var(--lime)}.recovery-strip h3{font-size:12px;margin:4px 0 0;color:#b9c3ce}.recovery-strip>.node-state{margin-left:auto}.metrics{display:grid;grid-template-columns:repeat(4,1fr);margin:20px -24px 0;border-top:1px solid var(--line);background:#0c111880}.metrics>div{padding:15px 25px;border-right:1px solid var(--line)}.metrics>div:last-child{border:0}.metrics span{display:block;font-size:8px;color:var(--muted);letter-spacing:1.5px}.metrics strong{display:block;font-size:25px;margin:6px 0;color:var(--lime);font-variant-numeric:tabular-nums}.metrics>div:first-child strong{color:var(--red)}.metrics small{font-size:9px;color:#687788}#backend{font-size:18px;text-transform:uppercase}.detail-grid{display:grid;grid-template-columns:1.2fr 1fr;gap:15px;margin-top:15px}.current-event,.ledger{border:1px solid var(--line);background:#11171e;border-radius:12px;padding:18px 22px;min-height:175px}.event-heading{display:flex;align-items:center;gap:12px}.pill{display:inline-block;font-size:9px;letter-spacing:1px;font-weight:800;color:var(--blue);border:1px solid #82b4ff55;background:#82b4ff10;padding:6px 9px;border-radius:5px}.pill.danger{color:var(--red);border-color:#ff738255}.pill.safe{color:var(--lime);border-color:#c5f66b55}.pill.hold{color:var(--amber);border-color:#ffd08355}#actor,#event-count{font-size:9px;color:var(--muted);letter-spacing:1px}#event-count{margin-left:auto}.current-event h2{font-size:23px;margin:15px 0 9px;letter-spacing:-.5px}.current-event>p{font-family:Consolas,monospace;font-size:11px;color:#b6c3d4;margin:0}.narration{color:var(--muted);font-size:11px;line-height:1.5;border-top:1px solid var(--line);margin-top:16px;padding-top:12px}.ledger-heading{display:flex;justify-content:space-between;align-items:center;margin-bottom:13px}.ledger h2{font-size:13px;margin:0}.ledger-heading span{font-size:8px;color:var(--muted);letter-spacing:1px}#stream{list-style:none;margin:0;padding:0}#stream li{display:flex;gap:10px;font-family:Consolas,monospace;font-size:10px;padding:6px 0;color:#8f9bab;border-bottom:1px solid #202833}#stream li:first-child{color:#fff}#stream li b{min-width:72px;font-size:9px;color:var(--blue)}#stream li b.danger{color:var(--red)}#stream li b.safe{color:var(--lime)}#stream li b.hold{color:var(--amber)}.controls{display:flex;align-items:center;gap:8px;margin:17px 0}.controls button{font-size:11px}.controls .primary{background:var(--lime);color:#11190a;font-weight:800;border-color:var(--lime);min-width:115px}.controls label{font-size:10px;color:var(--muted);margin-left:8px}.controls input{flex:1;min-width:80px;accent-color:var(--lime)}.controls select{font-size:10px;padding:8px}footer{display:flex;flex-wrap:wrap;gap:10px;justify-content:space-between;color:#7e8c9d;font-size:8px;letter-spacing:.8px;line-height:1.5}.recording header{height:55px}.recording .header-right button,.recording .controls,.recording .keyboard,.recording #assessment-toggle{display:none}.recording .intro{margin-bottom:20px}.recording main{padding-top:22px}.recording .stage{margin-top:20px}.recording .current-event,.recording .ledger{min-height:190px}@media(min-width:1500px){.flow article{padding:21px 17px;min-height:175px}.flow h3{font-size:18px}.flow p{font-size:12px}.node-label{font-size:9px}.detail-grid{margin-top:20px}.current-event,.ledger{min-height:200px}.current-event h2{font-size:28px}#stream li{font-size:12px;padding:8px 0}}@media(max-width:1000px){.brand-sub{display:none}.flow{flex-wrap:wrap;gap:10px}.flow article{flex:1 1 28%;min-height:145px}.connector{display:none}.intro{gap:20px}.context{max-width:270px}.metrics>div{padding:12px}.detail-grid{grid-template-columns:1fr 1fr}.current-event h2{font-size:18px}}@media(max-width:650px){header{padding:12px;height:auto}.header-right{gap:5px}.header-right button{font-size:9px;padding:8px}.verified{display:none}.intro{display:block}.context{margin-top:20px;max-width:none}.chapters{flex-wrap:wrap}.chapters button{font-size:10px}#assessment-toggle{margin-left:0}.flow article{flex-basis:44%}.metrics{grid-template-columns:1fr 1fr}.detail-grid,#assessment:not([hidden]){grid-template-columns:1fr}.controls{flex-wrap:wrap}.scrub-label{display:none}.controls input{flex-basis:35%}.recovery-strip h3{font-size:10px}}@media(prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

export const visualizerScript = String.raw`
(() => {
  'use strict';
  const el = id => document.getElementById(id);
  let replay = null, index = 0, timer = null, playing = false;
  const chapterNames = {unprotected:'01 / WITHOUT WARDEN',protected:'02 / WITH WARDEN',recovery:'03 / RESPONSE & RECOVERY'};
  function tone(status) {
    if (['LEAK','BLOCK'].includes(status)) return 'danger';
    if (['SAFE','ROTATE','RESTORE','QUARANTINE','CLOSED'].includes(status)) return 'safe';
    if (['HOLD','FLAG','SANDBOX','APPROVE'].includes(status)) return 'hold';
    return '';
  }
  function narration(event) {
    if (event.status === 'LEAK') return 'Without a memory of trust, a later agent obeys the persisted instruction. The local mock attacker receives the fake credential.';
    if (event.status === 'HOLD') return 'Control-file persistence requires human approval. This offline demo explicitly uses a demo-only approval callback.';
    if (event.status === 'APPROVE') return 'Deliberate demo-only approval lets us show defense in depth. Production approvals require a dashboard click.';
    if (event.status === 'SANDBOX') return 'Warden evaluates the script in isolation before it can run in the protected workspace. The displayed backend comes from this executed demo.';
    if (event.status === 'BLOCK') return 'The dangerous execution is stopped. Taint survives across agents and sessions; secret and network evidence explain the decision.';
    if (event.status === 'ROTATE') return 'The responder rotates a fake credential with a mock provider and verifies rejection. No real provider rotation is claimed.';
    if (event.status === 'CLOSED') return 'The demo verifies old-key rejection, baseline restoration, and quarantine. All three recovery checks passed in temporary repositories.';
    if (event.status === 'CLEF') return 'This viewer forces offline scoring. Model-backed classification is not claimed; the recorded backend remains visible.';
    if (event.chapter === 'unprotected') return 'An instruction travels from untrusted issue text into persistent files, then into another agent’s execution context.';
    if (event.chapter === 'recovery') return 'Deterministic recovery follows ledger provenance and repairs only the affected demo resources.';
    return 'Warden tracks the origin of untrusted input, preserving provenance when an action crosses files, agents, or days.';
  }
  function draw() {
    if (!replay) return;
    const event = replay.events[index];
    const past = replay.events.slice(0,index+1).filter(item => item.chapter === event.chapter);
    el('chapter-label').textContent = chapterNames[event.chapter];
    el('boundary').textContent = event.chapter === 'unprotected' ? 'UNPROTECTED PATH' : event.chapter === 'protected' ? 'WARDEN ENFORCEMENT' : 'MOCK-BACKED RECOVERY';
    el('boundary').style.color = event.chapter === 'unprotected' ? 'var(--red)' : 'var(--lime)';
    el('gate-title').textContent = event.chapter === 'unprotected' ? 'No guard' : 'Warden sandbox';
    el('gate-description').textContent = event.chapter === 'unprotected' ? 'Direct execution' : 'Inspect before execution';
    document.querySelectorAll('[data-chapter]').forEach(button => {
      const selected = button.dataset.chapter === event.chapter;
      button.classList.toggle('selected',selected);
      button.setAttribute('aria-pressed',String(selected));
    });
    document.querySelectorAll('[data-node]').forEach(node => {
      const relevant = past.filter(item => item.node === node.dataset.node);
      const last = relevant[relevant.length-1];
      node.classList.remove('active','danger','safe','hold');
      if (last) {
        const state = tone(last.status);
        if (state) node.classList.add(state);
        node.querySelector('.node-state').textContent = last.status === 'ALLOW' && event.chapter === 'protected' ? 'ALLOWED / TRACKED' : last.status;
      } else node.querySelector('.node-state').textContent = node.dataset.node === 'recovery' ? 'Awaiting response' : 'Waiting';
      if (node.dataset.node === event.node) node.classList.add('active');
    });
    el('status').textContent = event.status;
    el('status').className = 'pill ' + tone(event.status);
    el('actor').textContent = event.actor;
    el('event-count').textContent = (index+1) + ' / ' + replay.events.length;
    el('action').textContent = event.action;
    el('detail').textContent = event.detail;
    el('narration').textContent = narration(event);
    el('risk').textContent = event.risk.toFixed(2);
    const seen = replay.events.slice(0,index+1);
    el('leaks').textContent = seen.some(item => item.status === 'LEAK') ? String(replay.summary.unprotectedLeaks) : '—';
    el('protected-leaks').textContent = seen.some(item => item.status === 'SAFE') ? String(replay.summary.protectedLeaks) : '—';
    el('backend').textContent = seen.some(item => item.status === 'CLEF') ? replay.summary.scoringBackends.join(' / ') : '—';
    el('scrub').value = String(index);
    el('stream').replaceChildren(...past.slice(-4).reverse().map(item => {
      const row = document.createElement('li'), badge = document.createElement('b'), text = document.createElement('span');
      badge.textContent = item.status; badge.className = tone(item.status);
      text.textContent = item.actor + ' / ' + item.action;
      row.append(badge,text); return row;
    }));
  }
  function pause() { playing = false; clearTimeout(timer); timer = null; el('play').textContent = 'Play replay'; }
  function schedule() {
    clearTimeout(timer);
    const emphasis = ['LEAK','BLOCK','CLOSED','HOLD','SANDBOX'].includes(replay.events[index].status);
    timer = setTimeout(() => {
      if (index >= replay.events.length-1) { pause(); return; }
      index++; draw(); schedule();
    }, (emphasis ? 5500 : 3400) / Number(el('speed').value));
  }
  function play() {
    if (!replay) return;
    if (playing) { pause(); return; }
    if (index === replay.events.length-1) index = 0;
    playing = true; el('play').textContent = 'Pause replay'; draw(); schedule();
  }
  function jump(next) { if (!replay) return; pause(); index = Math.max(0,Math.min(replay.events.length-1,next)); draw(); }
  function cinema() { document.body.classList.toggle('recording'); el('cinema').textContent = document.body.classList.contains('recording') ? 'Exit recording mode' : 'Recording mode'; }
  async function fullscreen() { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { el('detail').textContent = 'Fullscreen unavailable. Use your browser fullscreen shortcut instead.'; } }
  el('play').addEventListener('click',play);
  el('restart').addEventListener('click',() => jump(0));
  el('back').addEventListener('click',() => jump(index-1));
  el('next').addEventListener('click',() => jump(index+1));
  el('scrub').addEventListener('input',event => jump(Number(event.target.value)));
  el('speed').addEventListener('change',() => { if (playing) schedule(); });
  el('cinema').addEventListener('click',cinema);
  el('fullscreen').addEventListener('click',fullscreen);
  el('assessment-toggle').addEventListener('click',() => { const panel = el('assessment'); panel.hidden = !panel.hidden; el('assessment-toggle').setAttribute('aria-expanded',String(!panel.hidden)); });
  document.querySelectorAll('[data-chapter]').forEach(button => button.addEventListener('click',() => { if (replay) jump(replay.events.findIndex(event => event.chapter === button.dataset.chapter)); }));
  document.addEventListener('keydown',event => {
    if (event.target.closest('input,select,button,a') || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if ([' ','arrowleft','arrowright','r','c','f'].includes(key)) event.preventDefault();
    if (key === ' ') play();
    if (key === 'arrowleft') jump(index-1);
    if (key === 'arrowright') jump(index+1);
    if (key === 'r') jump(0);
    if (key === 'c') cinema();
    if (key === 'f') void fullscreen();
  });
  fetch('/api/replay').then(response => { if (!response.ok) throw new Error('Replay unavailable'); return response.json(); }).then(data => {
    if (data.evidence !== 'executed-offline-demo' || !Array.isArray(data.events) || !data.events.length) throw new Error('Missing executed evidence');
    replay = data; el('play').disabled = false;
    el('scrub').max = String(replay.events.length-1);
    el('verification').textContent = '● VERIFIED OFFLINE REPLAY';
    el('timestamp').textContent = 'RUN ' + new Date(replay.generatedAt).toLocaleString();
    draw();
    const params = new URLSearchParams(location.search);
    if (params.get('cinema') === '1') cinema();
    if (params.get('autoplay') === '1') play();
  }).catch(() => { el('verification').textContent = 'EVIDENCE UNAVAILABLE'; el('action').textContent = 'Replay could not load'; el('detail').textContent = 'Restart npm run demo:visualize. No fallback success data is displayed.'; });
})();
`;