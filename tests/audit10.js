// Round-4 consolidated regression suite for the Puzzle & Dragons practice app.
// Requires: playwright-core + headless chromium at the path below.
// Run: node audit10.js   (expects ../index.html relative to this file)
const { chromium } = require('playwright-core');
const APP = 'file://' + require('path').join(__dirname, '..', 'index.html');
const results = [];
const ok = (n, c, x) => results.push((c ? 'PASS' : 'FAIL') + ' | ' + n + (x !== undefined && x !== '' ? ' | ' + x : ''));

const BASE = { timeout: 30000 };

async function newPage(browser, viewport, touch) {
  const page = await browser.newPage({ viewport, isMobile: !!touch, hasTouch: !!touch });
  page.errs = [];
  page.on('pageerror', e => page.errs.push(e.message));
  await page.addInitScript(() => { window.__dialogs = []; window.alert = m => window.__dialogs.push(m); window.prompt = () => 'テスト盤面'; window.confirm = () => true; });
  await page.goto(APP, BASE);
  await page.waitForTimeout(320);
  return page;
}
// Build a deterministic board; override(map) = [{r,c,t,cell:{...},pos:{...}}]
async function setBoard(page, override) {
  await page.evaluate(ov => {
    const B = ['fire', 'water', 'wood', 'light', 'dark', 'heal'];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { board[r][c] = makeCell(B[(r + 2 * c) % 6]); pos[r][c] = makePos(); }
    (ov || []).forEach(o => {
      if (o.t) board[o.r][o.c] = makeCell(o.t);
      if (o.cell) Object.assign(board[o.r][o.c], o.cell);
      if (o.pos) Object.assign(pos[o.r][o.c], o.pos);
    });
    render();
  }, override || []);
  await page.waitForTimeout(90);
}
async function cellCenter(page, r, c) {
  return page.evaluate(([r, c]) => {
    const b = document.getElementById('board').getBoundingClientRect();
    return { x: b.x + (c + 0.5) * (b.width / cols), y: b.y + (r + 0.5) * (b.height / rows) };
  }, [r, c]);
}
async function drag(page, from, to, steps) {
  const a = await cellCenter(page, from[0], from[1]);
  const b = await cellCenter(page, to[0], to[1]);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: steps || 8 });
  await page.mouse.up();
}

(async () => {
  const exe = process.env.HOME + '/.cache/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-linux64/chrome-headless-shell';
  const browser = await chromium.launch({ executablePath: exe });

  /* ===== 1) startup / initial state ===== */
  {
    const page = await newPage(browser, { width: 375, height: 760 }, true);
    const st = await page.evaluate(() => ({
      nodes: document.querySelectorAll('.dnode').length,
      time: document.getElementById('stTime').textContent,
      gimmick: board.flat().some(d => d.t !== 'fire' && d.t !== 'water' && d.t !== 'wood' && d.t !== 'light' && d.t !== 'dark' && d.t !== 'heal' || d.plus || d.lock || d.thorn || d.blind || d.sblind > 0)
        || pos.flat().some(p => p.cloud > 0 || p.tape || p.roul),
      matches: findMatches().groups.length,
      saveUi: !!document.getElementById('saveBtn') || !!document.getElementById('boardCode'),
      tabCount: document.querySelectorAll('.etab').length,
      ochikon: document.getElementById('ochikonSel').value, megumi: document.getElementById('megumiSel').value,
    }));
    ok('S1 startup: playable immediately (30 nodes, 6.0s, clean board, no initial match)',
      st.nodes === 30 && st.time === '6.0' && !st.gimmick && st.matches === 0, JSON.stringify(st));
    ok('S2 save UI removed; 3 edit tabs; ochikon off / megumi none by default',
      !st.saveUi && st.tabCount === 3 && st.ochikon === 'off' && st.megumi === 'none', JSON.stringify(st));
    ok('S3 no page errors at startup', page.errs.length === 0, page.errs.slice(0, 2).join(';'));
    await page.close();
  }

  /* ===== 2) header fit at 375px ===== */
  {
    const page = await newPage(browser, { width: 375, height: 760 }, true);
    const h = await page.evaluate(() => {
      const boxes = ['resetBtn', 'stateResetBtn', 'modeBtn'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return { id, l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width) }; });
      const hdr = document.querySelector('header').getBoundingClientRect();
      return { boxes, hdrH: Math.round(hdr.height), iw: window.innerWidth };
    });
    ok('H1 375px: 3 header buttons fully inside viewport, compact header (<=48px)',
      h.boxes.every(b => b.w > 30 && b.l >= 0 && b.r <= h.iw + 1) && h.hdrH <= 48, JSON.stringify(h));
    await page.close();
  }

  /* ===== 3) board geometry across viewports ===== */
  for (const vp of [{ width: 375, height: 667 }, { width: 375, height: 760 }, { width: 390, height: 844 }, { width: 430, height: 932 }]) {
    const page = await newPage(browser, vp, true);
    const m = await page.evaluate(() => {
      const bw = document.getElementById('boardwrap').getBoundingClientRect();
      return { gap: Math.round(window.innerHeight - bw.bottom), sw: document.documentElement.scrollWidth, iw: window.innerWidth };
    });
    ok('G1 ' + vp.width + 'x' + vp.height + ': board flush to bottom, no horizontal overflow',
      Math.abs(m.gap) <= 2 && m.sw <= m.iw + 1, JSON.stringify(m));
    await page.close();
  }
  {
    const page = await newPage(browser, { width: 844, height: 390 }, true);
    await page.waitForTimeout(250);
    const m = await page.evaluate(() => document.getElementById('boardwrap').getBoundingClientRect().height / window.innerHeight);
    ok('G2 landscape: board height capped at ~55dvh', m <= 0.60, 'ratio=' + m.toFixed(2));
    await page.close();
  }

  /* ===== 4) desktop mouse play ===== */
  {
    const page = await newPage(browser, { width: 1280, height: 800 }, false);
    await setBoard(page, [{ r: 0, c: 0, t: 'fire' }, { r: 0, c: 1, t: 'water' }, { r: 1, c: 1, t: 'fire' }, { r: 2, c: 1, t: 'fire' }]);
    await drag(page, [0, 0], [0, 1]);
    await page.waitForTimeout(2400);
    const st = await page.evaluate(() => ({ lr: document.getElementById('lrCombo').textContent, resolving, turn }));
    ok('D1 desktop mouse drag resolves a combo', st.lr !== '-' && !st.resolving && st.turn === 1, JSON.stringify(st));
    ok('D2 desktop: no page errors', page.errs.length === 0, page.errs.slice(0, 2).join(';'));
    await page.close();
  }

  /* ===== 5) core mechanics: bombs / poison / deadly / thorn / sequential ===== */
  {
    const page = await newPage(browser, { width: 375, height: 760 }, true);
    // 5a unmatched bomb explodes: 20%, destroys row+col, kills locked drop too
    await setBoard(page, [
      { r: 2, c: 2, t: 'bomb' }, { r: 0, c: 0, t: 'fire' }, { r: 0, c: 1, t: 'water' },
      { r: 1, c: 1, t: 'fire' }, { r: 2, c: 1, t: 'fire' },
      { r: 0, c: 2, t: 'wood', cell: { lock: true } }, // sits in bomb's column, locked
    ]);
    const dmgBefore = await page.evaluate(() => turnDmg);
    await drag(page, [0, 0], [0, 1]); // benign swap, bomb stays unmatched
    await page.waitForTimeout(2600);
    const b1 = await page.evaluate(() => ({ dmg: turnDmg, res: resolving }));
    ok('M1 unmatched bomb: 20% damage, resolution completes', dmgBefore === 0 && b1.dmg === 20 && !b1.res, JSON.stringify(b1));
    // 5b matched bombs (3 in a row) clear safely, no explosion damage
    await setBoard(page, [
      { r: 4, c: 0, t: 'bomb' }, { r: 4, c: 1, t: 'bomb' }, { r: 4, c: 2, t: 'fire' }, { r: 3, c: 2, t: 'bomb' },
      { r: 0, c: 0, t: 'water' }, { r: 0, c: 1, t: 'wood' },
    ]);
    await page.evaluate(() => { turnDmg = 0; });
    await drag(page, [4, 2], [3, 2]); // swap fire with bomb -> row of 3 bombs
    await page.waitForTimeout(2600);
    const b2 = await page.evaluate(() => ({ dmg: turnDmg, lr: document.getElementById('lrCombo').textContent }));
    ok('M2 matched bombs clear safely (no explosion damage)', b2.dmg === 0 && b2.lr !== '-', JSON.stringify(b2));
    // 5c poison 3 = (3+1)*5 = 20%
    await setBoard(page, [
      { r: 4, c: 0, t: 'poison' }, { r: 4, c: 1, t: 'poison' }, { r: 4, c: 2, t: 'fire' }, { r: 3, c: 2, t: 'poison' },
      { r: 0, c: 0, t: 'water' }, { r: 0, c: 1, t: 'wood' },
    ]);
    await page.evaluate(() => { turnDmg = 0; });
    await drag(page, [4, 2], [3, 2]);
    await page.waitForTimeout(2400);
    const p1v = await page.evaluate(() => turnDmg);
    ok('M3 poison x3 = 20% damage', p1v === 20, 'dmg=' + p1v);
    // 5d deadly poison 3 = (3+1)*12.5 = 50%
    await setBoard(page, [
      { r: 4, c: 0, t: 'dpoison' }, { r: 4, c: 1, t: 'dpoison' }, { r: 4, c: 2, t: 'fire' }, { r: 3, c: 2, t: 'dpoison' },
      { r: 0, c: 0, t: 'water' }, { r: 0, c: 1, t: 'wood' },
    ]);
    await page.evaluate(() => { turnDmg = 0; });
    await drag(page, [4, 2], [3, 2]);
    await page.waitForTimeout(2400);
    const p2v = await page.evaluate(() => turnDmg);
    ok('M4 deadly poison x3 = 50% damage', p2v === 50, 'dmg=' + p2v);
    // 5e one move completing two groups (row of fire + column of wood) resolves sequentially to 2 combos
    await setBoard(page, [
      { r: 4, c: 0, t: 'fire' }, { r: 4, c: 1, t: 'fire' }, { r: 4, c: 2, t: 'wood' }, { r: 3, c: 2, t: 'fire' },
      { r: 2, c: 2, t: 'wood' }, { r: 1, c: 2, t: 'wood' },
    ]);
    await page.evaluate(() => { turn = 0; maxCombo = 0; });
    await drag(page, [4, 2], [3, 2]);
    await page.waitForTimeout(2800);
    const sq = await page.evaluate(() => ({ mx: maxCombo, t: turn, lr: document.getElementById('lrCombo').textContent }));
    ok('M5 one move, two groups: resolves to 2 combos in a single turn', sq.mx >= 2 && sq.t === 1, JSON.stringify(sq));
    ok('M6 no page errors (mechanics)', page.errs.length === 0, page.errs.slice(0, 2).join(';'));
    await page.close();
  }

  /* ===== 6) roulette: global sync, held freeze, keeps cycling during a move ===== */
  {
    const page = await newPage(browser, { width: 375, height: 760 }, true);
    await setBoard(page, [
      { r: 0, c: 0, pos: { roul: { colors: ['fire', 'water', 'wood', 'light', 'dark', 'heal'], interval: 1000, idx: 0, next: 0 } } },
      { r: 3, c: 4, pos: { roul: { colors: ['fire', 'water', 'wood', 'light', 'dark', 'heal'], interval: 1000, idx: 0, next: 0 } } },
    ]);
    // sync: both cells always show the same type
    let synced = true; const seen = new Set();
    for (let i = 0; i < 16; i++) {
      const pair = await page.evaluate(() => [effType(0, 0), effType(3, 4)]);
      if (pair[0] !== pair[1]) synced = false;
      seen.add(pair[0]);
      await page.waitForTimeout(200);
    }
    ok('R1 roulette: all cells change at the same timing (global clock)', synced && seen.size >= 3, [...seen].join(','));
    // held drop on a roulette cell freezes; others keep cycling during the drag
    const a = await cellCenter(page, 0, 0);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.waitForTimeout(150);
    const held0 = await page.evaluate(() => effType(0, 0));
    await page.waitForTimeout(2300);
    const mid = await page.evaluate(() => ({ held: effType(0, 0), other: effType(3, 4), base: board[3][4].t }));
    await page.mouse.up(); await page.waitForTimeout(300);
    ok('R2 roulette: held cell frozen while others keep cycling during a move',
      mid.held === held0 && mid.other !== mid.base, JSON.stringify({ held0, mid }));
    ok('R3 no page errors (roulette)', page.errs.length === 0, page.errs.slice(0, 2).join(';'));
    await page.close();
  }

  /* ===== 7) cloud fully hides the drop ===== */
  {
    const page = await newPage(browser, { width: 375, height: 760 }, true);
    await setBoard(page, [{ r: 1, c: 1, pos: { cloud: 2 } }]);
    const v = await page.evaluate(() => {
      const cellEl = document.getElementById('board').children[1 * cols + 1];
      const cr = cellEl.getBoundingClientRect();
      const cx = cr.x + cr.width / 2, cy = cr.y + cr.height / 2;
      let best = null, bd = 1e9;
      document.querySelectorAll('.dnode').forEach(n => { const r = n.getBoundingClientRect(); const d = Math.hypot(r.x + r.width / 2 - cx, r.y + r.height / 2 - cy); if (d < bd) { bd = d; best = n; } });
      return { vis: best ? getComputedStyle(best).visibility : 'missing', hasCloud: !!cellEl.querySelector('.cloudov'), dist: Math.round(bd) };
    });
    ok('C1 cloud: drop on a cloud cell is fully hidden', v.vis === 'hidden' && v.hasCloud && v.dist < 4, JSON.stringify(v));
    await page.close();
  }

  /* ===== 8) ochikon modes + megumi profiles (statistics) ===== */
  {
    const page = await newPage(browser, { width: 375, height: 760 }, true);
    const stats = await page.evaluate(() => {
      const fill = () => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) board[r][c] = null; gravityAndRefill(); return findMatches().groups.length; };
      const countTypes = () => { const m = {}; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const t = board[r][c].t; m[t] = (m[t] || 0) + 1; } return m; };
      const res = {};
      document.getElementById('ochikonSel').value = 'off'; document.getElementById('megumiSel').value = 'none';
      let wm = 0; for (let i = 0; i < 200; i++) { if (fill() > 0) wm++; }
      res.offBoards = wm;
      document.getElementById('ochikonSel').value = 'on';
      wm = 0; for (let i = 0; i < 200; i++) { if (fill() > 0) wm++; }
      res.onBoards = wm;
      document.getElementById('megumiSel').value = 'only'; megumiOnly = new Set(['fire', 'water']); syncSkyFxUI();
      let bad = 0; for (let i = 0; i < 100; i++) { fill(); const m = countTypes(); for (const k in m) if (k !== 'fire' && k !== 'water') bad += m[k]; }
      res.pairBad = bad;
      document.getElementById('megumiSel').value = 'water';
      const tot = {}; for (let i = 0; i < 100; i++) { fill(); const m = countTypes(); for (const k in m) tot[k] = (tot[k] || 0) + m[k]; }
      res.boostWater = (tot.water || 0) / 3000;
      document.getElementById('megumiSel').value = 'none';
      skyFx.poison = true;
      const tot2 = {}; for (let i = 0; i < 120; i++) { fill(); const m = countTypes(); for (const k in m) tot2[k] = (tot2[k] || 0) + m[k]; }
      res.poiShare = (tot2.poison || 0) / 3600; res.poiJammer = (tot2.jammer || 0) / 3600; res.poiDpoi = (tot2.dpoison || 0) / 3600;
      skyFx.poison = false; skyFx.thorn = true;
      let thorn = 0; for (let i = 0; i < 120; i++) { fill(); for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (board[r][c].thorn) thorn++; }
      res.thornShare = thorn / 3600;
      skyFx.thorn = false; skyFx.sblind = true;
      let sb = 0, sbBad = 0;
      for (let i = 0; i < 120; i++) { fill(); for (const d of board.flat()) { if (d.sblind > 0) { sb++; if (d.sblind !== 1) sbBad++; } } }
      res.sblindShare = sb / 3600; res.sblindBadVal = sbBad;
      skyFx.sblind = false;
      document.getElementById('ochikonSel').value = 'off'; document.getElementById('megumiSel').value = 'none';
      newBoard(true); render();
      return res;
    });
    ok('O1 ochikon OFF: zero skyfall matches in 200 refilled boards', stats.offBoards === 0, JSON.stringify(stats.offBoards));
    ok('O2 ochikon ON: skyfall matches occur naturally', stats.onBoards > 10, JSON.stringify(stats.onBoards));
    ok('O3 custom-only megumi (fire+water): no other types fall', stats.pairBad === 0, JSON.stringify(stats.pairBad));
    ok('O4 water-boost megumi: water share ~3/8', stats.boostWater > 0.32 && stats.boostWater < 0.44, stats.boostWater.toFixed(3));
    ok('O5 poison skyfall toggle alone: poison ~25%, no jammer/dpoison mixed in', Math.abs(stats.poiShare - 0.25) <= 0.035 && stats.poiJammer === 0 && stats.poiDpoi === 0,
      'poison=' + stats.poiShare.toFixed(3));
    ok('O6 thorn skyfall toggle alone: ~15% of spawns carry thorn', Math.abs(stats.thornShare - 0.15) <= 0.03, stats.thornShare.toFixed(3));
    ok('O7 super-blind skyfall toggle: ~30% of spawns are super-blind with 1 turn remaining (partial, as in the real game)',
      Math.abs(stats.sblindShare - 0.30) <= 0.035 && stats.sblindBadVal === 0, 'share=' + stats.sblindShare.toFixed(3));
    await page.close();
  }

  /* ===== 8b) ochikon OFF: cells stay blank during the turn (real-game no-skyfall) ===== */
  for (const mode of ['off', 'on']) {
    const page = await newPage(browser, { width: 375, height: 760 }, true);
    await page.evaluate(m => { document.getElementById('ochikonSel').value = m; }, mode);
    await setBoard(page, [
      { r: 4, c: 0, t: 'fire' }, { r: 4, c: 1, t: 'fire' }, { r: 4, c: 2, t: 'wood' }, { r: 3, c: 2, t: 'fire' },
      { r: 2, c: 2, t: 'wood' }, { r: 1, c: 2, t: 'wood' },
    ]);
    const initUids = await page.evaluate(() => board.flat().map(d => d.uid));
    await page.evaluate(set => { window.__initUids = new Set(set); }, [...initUids]);
    await drag(page, [4, 2], [3, 2]); // completes fire row + wood column (2 combos)
    let sawBlank = false, foreignUid = false, polls = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      const s = await page.evaluate(() => ({
        resolving,
        blanks: board.flat().filter(d => !d).length,
        foreign: board.flat().filter(Boolean).some(d => !window.__initUids.has(d.uid)),
      })).catch(() => null);
      if (!s) break;
      if (s.blanks > 0) sawBlank = true;
      if (polls > 0 && s.foreign) foreignUid = true;
      polls++;
      if (!s.resolving && polls > 2) break;
      await page.waitForTimeout(30);
    }
    await page.waitForTimeout(600);
    const fin = await page.evaluate(() => ({
      full: board.flat().every(Boolean), rest: findMatches().groups.length, turn,
      nodes: document.querySelectorAll('.dnode').length,
    }));
    if (mode === 'off') {
      // blanks observable between tasks can only happen if cleared cells are NOT refilled
      // immediately (synchronous refill would never expose a blank to a poll)
      ok('O6 ochikon OFF: blanks persist during the turn; refilled once at turn end (full, match-free rest)',
        sawBlank && fin.full && fin.rest === 0 && fin.turn === 1 && fin.nodes === 30,
        JSON.stringify({ sawBlank, foreignUid, fin }));
    } else {
      ok('O7 ochikon ON: new drops stream in during the turn; board full and settled after',
        foreignUid && fin.full && fin.turn === 1 && fin.nodes === 30,
        JSON.stringify({ sawBlank, foreignUid, fin }));
    }
    ok('O8 no page errors (ochikon ' + mode + ')', page.errs.length === 0, page.errs.slice(0, 2).join(';'));
    await page.close();
  }

  /* ===== 9) undo / state reset / bulk clear / sanitize ===== */
  {
    const page = await newPage(browser, { width: 375, height: 760 }, true);
    await setBoard(page, [{ r: 0, c: 0, t: 'fire' }, { r: 0, c: 1, t: 'water' }, { r: 1, c: 1, t: 'fire' }, { r: 2, c: 1, t: 'fire' }]);
    const sig0 = await page.evaluate(() => JSON.stringify(board.map(r => r.map(d => d.t))));
    await drag(page, [0, 0], [0, 1]);
    await page.waitForTimeout(2400);
    await page.click('#undoBtn'); await page.waitForTimeout(150);
    const u = await page.evaluate(() => ({ sig: JSON.stringify(board.map(r => r.map(d => d.t))), turn, lr: document.getElementById('lrCombo').textContent }));
    ok('U1 undo restores the pre-move board and displays', u.sig === sig0 && u.turn === 0 && u.lr === '-', 'turn=' + u.turn + ' lr=' + u.lr);
    // a tap that never moves a drop must not consume the undo snapshot
    await drag(page, [0, 0], [0, 1]);
    await page.waitForTimeout(2400);
    await drag(page, [4, 5], [4, 5]);
    await page.waitForTimeout(200);
    await page.click('#undoBtn'); await page.waitForTimeout(150);
    const u6 = await page.evaluate(() => ({ sig: JSON.stringify(board.map(r => r.map(d => d.t))), turn }));
    ok('U6 tap without moving keeps undo: still restores the pre-move board', u6.sig === sig0 && u6.turn === 0, 'turn=' + u6.turn);
    // opening/closing edit mode without painting must not consume the undo snapshot
    await drag(page, [0, 0], [0, 1]);
    await page.waitForTimeout(2400);
    await page.click('#modeBtn'); await page.waitForTimeout(120);
    await page.click('#modeBtn'); await page.waitForTimeout(120);
    await page.click('#undoBtn'); await page.waitForTimeout(150);
    const u7 = await page.evaluate(() => ({ sig: JSON.stringify(board.map(r => r.map(d => d.t))), turn }));
    ok('U7 mode toggle without edits keeps undo: still restores the pre-move board', u7.sig === sig0 && u7.turn === 0, 'turn=' + u7.turn);
    // state reset keeps the board
    await drag(page, [0, 0], [0, 1]);
    await page.waitForTimeout(2400);
    const sigBefore = await page.evaluate(() => JSON.stringify(board.map(r => r.map(d => d.t))) + JSON.stringify(pos));
    await page.click('#stateResetBtn'); await page.waitForTimeout(120);
    const sr = await page.evaluate(() => ({
      sig: JSON.stringify(board.map(r => r.map(d => d.t))) + JSON.stringify(pos),
      turn, maxCombo, turnDmg, t: document.getElementById('stTurn').textContent, lr: document.getElementById('lrCombo').textContent,
    }));
    ok('U2 state reset: counters zeroed, board untouched', sr.sig === sigBefore && sr.turn === 0 && sr.maxCombo === 0 && sr.turnDmg === 0 && sr.t === '0' && sr.lr === '-', JSON.stringify({ t: sr.turn, lr: sr.lr }));
    // bulk state clear in merged state tab
    await page.click('#modeBtn'); await page.waitForTimeout(120);
    await page.click('.etab[data-tab="mod"]'); await page.waitForTimeout(90);
    const bc = await page.evaluate(() => {
      board[0][0].plus = true; board[0][1].lock = true; board[1][0].thorn = true; board[2][2].sblind = 3;
      pos[0][2].cloud = 2; pos[1][3].tape = true; pos[2][0].roul = { colors: ['fire', 'water'], interval: 1000, idx: 0, next: 0 };
      uneraseAttrs.add('fire');
      const typesBefore = JSON.stringify(board.map(r => r.map(d => d.t)));
      document.getElementById('bulkClearGimmickBtn').click();
      const left = board.flat().some(d => d.plus || d.weak || d.lock || d.thorn || d.blind || d.sblind > 0)
        || pos.flat().some(p => p.cloud > 0 || p.tape || p.roul) || uneraseAttrs.size > 0;
      return { left, typesSame: JSON.stringify(board.map(r => r.map(d => d.t))) === typesBefore };
    });
    ok('U3 bulk state clear: all states+gimmicks cleared, drop types unchanged', !bc.left && bc.typesSame, JSON.stringify(bc));
    await page.click('#modeBtn'); await page.waitForTimeout(100);
    // sanitize guards
    const san = await page.evaluate(() => {
      const B = ['fire', 'water', 'wood', 'light', 'dark', 'heal'];
      const mk = () => { const bd = [], ps = []; let u = 5000; for (let r = 0; r < 5; r++) { bd.push([]); ps.push([]); for (let c = 0; c < 6; c++) { bd[r].push({ uid: u++, t: B[(r + 2 * c) % 6], plus: false, weak: false, lock: false, thorn: false, blind: false, sblind: 0 }); ps[r].push({ cloud: 0, tape: false, roul: null }); } } return { cols: 6, rows: 5, board: bd, pos: ps }; };
      const good = mk();
      const dup = mk(); dup.board[0][1].uid = dup.board[0][0].uid;
      const badIdx = mk(); badIdx.pos[0][0].roul = { colors: ['fire', 'water'], interval: 1000, idx: 8, next: 0 };
      const unk = mk(); unk.board[0][0].evil = 1;
      return { good: sanitizeData(good) !== null, dup: sanitizeData(dup) === null, badIdx: sanitizeData(badIdx) === null, unk: sanitizeData(unk) === null };
    });
    ok('U4 sanitizeData: valid ok; duplicate uid / bad roulette idx / unknown field rejected',
      san.good && san.dup && san.badIdx && san.unk, JSON.stringify(san));
    ok('U5 no page errors (undo/reset/sanitize)', page.errs.length === 0, page.errs.slice(0, 2).join(';'));
    await page.close();
  }

  /* ===== 10) zoom disabled ===== */
  {
    const page = await newPage(browser, { width: 375, height: 760 }, true);
    const z = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="viewport"]').getAttribute('content');
      const g = new Event('gesturestart', { cancelable: true }); document.dispatchEvent(g);
      const d = new MouseEvent('dblclick', { cancelable: true }); document.dispatchEvent(d);
      return { meta, gPrev: g.defaultPrevented, dPrev: d.defaultPrevented };
    });
    ok('Z1 zoom disabled: viewport meta + gesturestart/dblclick blocked',
      z.meta.includes('user-scalable=no') && z.meta.includes('maximum-scale=1') && z.gPrev && z.dPrev, JSON.stringify(z));
    await page.close();
  }

  /* ===== 11) timer: timeout ends the move; display does not snap back ===== */
  {
    const page = await newPage(browser, { width: 375, height: 760 }, true);
    await page.evaluate(() => setTime(1.0));
    await setBoard(page, [{ r: 0, c: 0, t: 'fire' }, { r: 0, c: 1, t: 'water' }, { r: 1, c: 1, t: 'fire' }, { r: 2, c: 1, t: 'fire' }]);
    const a = await cellCenter(page, 0, 0); const b = await cellCenter(page, 0, 1);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 6 }); // first swap starts the timer
    await page.waitForTimeout(1250); // timer (1.0s) expires while still holding -> resolution begins
    const mid = await page.evaluate(() => ({ stTime: document.getElementById('stTime').textContent, resolving, held: !!held }));
    await page.mouse.up();
    await page.waitForTimeout(2200);
    const fin = await page.evaluate(() => ({ stTime: document.getElementById('stTime').textContent, resolving, turn }));
    ok('T1 timeout ends the move; display stays 0.0 during resolution, resets for the next move after',
      mid.stTime === '0.0' && mid.resolving && !mid.held && fin.stTime === '1.0' && !fin.resolving && fin.turn === 1,
      JSON.stringify({ mid, fin }));
    await page.close();
  }

  /* ===== 12) 7x6 stress: full resolution terminates ===== */
  {
    const page = await newPage(browser, { width: 390, height: 844 }, true);
    await page.click('.sizechip[data-size="7x6"]'); await page.waitForTimeout(200);
    let allOk = true;
    for (let i = 0; i < 5; i++) {
      const pts = await page.evaluate(() => {
        const b = document.getElementById('board').getBoundingClientRect();
        const r = Math.floor(Math.random() * (rows - 1)), c = Math.floor(Math.random() * (cols - 1));
        return { x1: b.x + (c + 0.5) * (b.width / cols), y1: b.y + (r + 0.5) * (b.height / rows), x2: b.x + (c + 1.5) * (b.width / cols), y2: b.y + (r + 0.5) * (b.height / rows) };
      });
      await page.mouse.move(pts.x1, pts.y1); await page.mouse.down();
      await page.mouse.move(pts.x2, pts.y2, { steps: 5 }); await page.mouse.up();
      await page.waitForTimeout(3200);
      const done = await page.evaluate(() => !resolving && document.querySelectorAll('.dnode').length === cols * rows);
      if (!done) allOk = false;
    }
    ok('X1 7x6: five random moves all resolve completely (42 nodes)', allOk && page.errs.length === 0, 'errs=' + page.errs.slice(0, 2).join(';'));
    await page.close();
  }


  /* ===== 13) strict L-shape lock release ===== */
  {
    const page = await newPage(browser, { width: 375, height: 760 }, true);
    const lockAt = () => page.evaluate(() => board[0][0].lock);
    // T shape (junction mid-run) must NOT unlock
    await setBoard(page, [
      { r: 0, c: 0, cell: { lock: true } },
      { r: 4, c: 1, t: 'fire' }, { r: 4, c: 2, t: 'fire' }, { r: 4, c: 3, t: 'fire' }, { r: 3, c: 2, t: 'fire' }, { r: 2, c: 2, t: 'fire' },
    ]);
    await page.evaluate(() => resolveBoard());
    await page.waitForTimeout(300);
    ok('L1 T-shape clear does NOT release locks', await lockAt() === true, '');
    // cross/plus shape must NOT unlock
    await setBoard(page, [
      { r: 0, c: 0, cell: { lock: true } },
      { r: 2, c: 1, t: 'fire' }, { r: 2, c: 2, t: 'fire' }, { r: 2, c: 3, t: 'fire' }, { r: 1, c: 2, t: 'fire' }, { r: 3, c: 2, t: 'fire' },
    ]);
    await page.evaluate(() => resolveBoard());
    await page.waitForTimeout(300);
    ok('L2 plus-shape clear does NOT release locks', await lockAt() === true, '');
    // true L (corner at the end of both runs) DOES unlock board-wide
    await setBoard(page, [
      { r: 0, c: 0, cell: { lock: true } },
      { r: 4, c: 0, t: 'fire' }, { r: 4, c: 1, t: 'fire' }, { r: 4, c: 2, t: 'fire' }, { r: 3, c: 0, t: 'fire' }, { r: 2, c: 0, t: 'fire' },
    ]);
    await page.evaluate(() => resolveBoard());
    await page.waitForTimeout(300);
    ok('L3 true L-shape clear releases all locks', await lockAt() === false, '');
    ok('L4 no page errors (L shapes)', page.errs.length === 0, page.errs.slice(0, 2).join(';'));
    await page.close();
  }

  /* ===== 14) mid-drag UI races (second-finger taps) ===== */
  {
    const page = await newPage(browser, { width: 375, height: 760 }, true);
    await setBoard(page, [{ r: 0, c: 0, t: 'fire' }, { r: 0, c: 1, t: 'water' }, { r: 1, c: 1, t: 'fire' }, { r: 2, c: 1, t: 'fire' }]);
    const a = await cellCenter(page, 0, 0); const b = await cellCenter(page, 0, 1);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 }); // drag in progress, timer running
    await page.evaluate(() => document.querySelector('.sizechip[data-size="7x6"]').click());
    const mid = await page.evaluate(() => ({ cols, rows, held: !!held }));
    await page.mouse.up(); await page.waitForTimeout(2400);
    const fin = await page.evaluate(() => ({ cols, turn, resolving }));
    ok('V1 size change is blocked mid-drag; the move still resolves normally',
      mid.cols === 6 && mid.held && fin.cols === 6 && fin.turn === 1 && !fin.resolving && page.errs.length === 0,
      JSON.stringify({ mid, fin, errs: page.errs.slice(0, 1) }));
    await page.close();
  }
  {
    const page = await newPage(browser, { width: 375, height: 760 }, true);
    await setBoard(page, [{ r: 0, c: 0, t: 'fire' }, { r: 0, c: 1, t: 'water' }, { r: 1, c: 1, t: 'fire' }, { r: 2, c: 1, t: 'fire' }]);
    const a = await cellCenter(page, 0, 0); const b = await cellCenter(page, 0, 1);
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.evaluate(() => document.getElementById('resetBtn').click());
    const mid = await page.evaluate(() => ({ held: !!held, timer: !!timerId, turn, stTime: document.getElementById('stTime').textContent }));
    await page.mouse.up(); await page.waitForTimeout(400);
    ok('V2 settings reset mid-drag cancels the drag and stops the timer cleanly',
      !mid.held && !mid.timer && mid.turn === 0 && mid.stTime === '6.0' && page.errs.length === 0,
      JSON.stringify({ mid, errs: page.errs.slice(0, 1) }));
    await page.close();
  }

  /* ===== 12) FZ: ochikon OFF — full resolutions across all megumi profiles must rest full & match-free ===== */
  for (const prof of ['none', 'water', 'only2', 'only3', 'fxmix']) {
    const page = await newPage(browser, { width: 375, height: 760 }, true);
    await page.evaluate(p => {
      document.getElementById('ochikonSel').value = 'off';
      if (p === 'only2') { document.getElementById('megumiSel').value = 'only'; megumiOnly = new Set(['fire', 'water']); }
      else if (p === 'only3') { document.getElementById('megumiSel').value = 'only'; megumiOnly = new Set(['light', 'dark', 'heal']); }
      else if (p === 'fxmix') { document.getElementById('megumiSel').value = 'none'; skyFx.poison = true; skyFx.jammer = true; }
      else document.getElementById('megumiSel').value = p;
      syncSkyFxUI();
    }, prof);
    let bad = 0, details = '';
    for (let i = 0; i < 12; i++) {
      await page.evaluate(() => {
        const B = ['fire', 'water', 'wood', 'light', 'dark', 'heal'];
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { board[r][c] = makeCell(B[(r + 2 * c) % 6]); pos[r][c] = makePos(); }
        const t1 = B[Math.floor(Math.random() * 6)], t2 = B[Math.floor(Math.random() * 6)];
        const r1 = Math.floor(Math.random() * rows), r2 = Math.floor(Math.random() * rows);
        for (let k = 0; k < 3; k++) { board[r1][k].t = t1; board[r2][cols - 1 - k].t = t2; }
        board[Math.floor(Math.random() * rows)][Math.floor(Math.random() * cols)] = makeCell('bomb');
        render();
      });
      await page.evaluate(() => resolveBoard());
      await page.waitForFunction(() => !resolving, null, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(150);
      const s = await page.evaluate(() => ({ full: board.flat().every(Boolean), rest: findMatches().groups.length, resolving }));
      if (!s.full || s.rest !== 0 || s.resolving) { bad++; details = JSON.stringify(s); }
    }
    ok('FZ1 ochikon OFF (' + prof + '): 12 full resolutions all rest full & match-free', bad === 0, details);
    ok('FZ2 no page errors (fuzz ' + prof + ')', page.errs.length === 0, page.errs.slice(0, 2).join(';'));
    await page.close();
  }

  /* ===== 13) Round-5 regressions: shuffle validity / palette persistence / roulette entry / pid residue ===== */
  {
    const page = await newPage(browser, { width: 375, height: 760 }, true);
    const sh = await page.evaluate(() => {
      const B = ['fire', 'water', 'wood', 'light', 'dark', 'heal'];
      const out = {};
      const configs = {
        only2: () => { document.getElementById('megumiSel').value = 'only'; megumiOnly = new Set(['fire', 'water']); },
        only3: () => { document.getElementById('megumiSel').value = 'only'; megumiOnly = new Set(['water', 'wood', 'light']); },
        only4: () => { document.getElementById('megumiSel').value = 'only'; megumiOnly = new Set(['fire', 'water', 'wood', 'dark']); },
        water: () => { document.getElementById('megumiSel').value = 'water'; },
        fxmix: () => { document.getElementById('megumiSel').value = 'none'; skyFx.poison = true; skyFx.jammer = true; },
      };
      for (const p of Object.keys(configs)) {
        Object.keys(skyFx).forEach(k => skyFx[k] = false);
        configs[p](); syncSkyFxUI();
        let bad = 0, impure = 0;
        for (let i = 0; i < 80; i++) {
          for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) board[r][c] = makeCell(B[Math.floor(Math.random() * 6)]);
          shuffleBoard();
          if (findMatches().groups.length > 0) bad++;
          if (p === 'only2' && board.flat().some(d => d.t !== 'fire' && d.t !== 'water')) impure++;
        }
        out[p] = { bad, impure };
      }
      Object.keys(skyFx).forEach(k => skyFx[k] = false);
      document.getElementById('megumiSel').value = 'none'; syncSkyFxUI();
      return out;
    });
    ok('SH1 shuffle: match-free boards for all profiles (only 2/3/4 colors, boost, fx mix), only-2 purity kept',
      Object.values(sh).every(v => v.bad === 0 && v.impure === 0), JSON.stringify(sh));
    const pp = await page.evaluate(() => {
      if (!editMode) document.getElementById('modeBtn').click();
      buildPalettes();
      const rp = document.getElementById('roulPreset');
      rp.value = 'custom'; rp.onchange && rp.onchange();
      document.querySelectorAll('.roulColorChk').forEach(ch => { ch.checked = (ch.value === 'poison' || ch.value === 'jammer'); });
      document.getElementById('roulInterval').value = '500';
      buildPalettes();
      return { preset: document.getElementById('roulPreset').value, colors: [...document.querySelectorAll('.roulColorChk:checked')].map(x => x.value), interval: document.getElementById('roulInterval').value };
    });
    ok('P0 roulette custom settings survive palette rebuilds',
      pp.preset === 'custom' && pp.colors.join() === 'poison,jammer' && pp.interval === '500', JSON.stringify(pp));
    const r9 = await page.evaluate(() => {
      if (editMode) document.getElementById('modeBtn').click();
      const B = ['fire', 'water', 'wood', 'light', 'dark', 'heal'];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { board[r][c] = makeCell(B[(r + 2 * c) % 6]); pos[r][c] = makePos(); }
      board[4][1] = makeCell('poison');
      pos[4][2] = Object.assign(makePos(), { roul: { colors: B.slice(), interval: 1000, idx: 0, next: 0 } });
      render();
      held = { r: 4, c: 1 }; heldUid = board[4][1].uid;
      swapHeld(4, 2);
      const dragIn = board[4][2].t;
      held = null; heldUid = null;
      board[3][2] = makeCell('jammer'); board[4][2] = null; render();
      applyGravity();
      const fallIn = board[4][2] && board[4][2].t;
      render();
      return { dragIn, fallIn };
    });
    ok('R9 special drops entering a roulette cell (drag or gravity) convert to fire',
      r9.dragIn === 'fire' && r9.fallIn === 'fire', JSON.stringify(r9));
    await page.close();
  }
  {
    const page = await newPage(browser, { width: 375, height: 760 }, true);
    await setBoard(page, [{ r: 4, c: 0, t: 'fire' }, { r: 4, c: 1, t: 'fire' }, { r: 4, c: 2, t: 'wood' }, { r: 3, c: 2, t: 'fire' }]);
    const v3 = await page.evaluate(async () => {
      resolveBoard();
      const rect = wrapEl.getBoundingClientRect();
      const ev = new PointerEvent('pointerdown', { pointerId: 99, bubbles: true, clientX: rect.left + rect.width * 0.25, clientY: rect.top + rect.height * 0.5 });
      wrapEl.dispatchEvent(ev);
      const during = { resolving, activePid };
      return during;
    });
    ok('V3 pointerdown during resolution does not capture activePid', v3.resolving && v3.activePid === null, JSON.stringify(v3));
    await page.waitForTimeout(2400);
    await page.close();
  }

  /* ===== 14) unerase-by-attribute + megumi custom-only validation ===== */
  {
    const page = await newPage(browser, { width: 375, height: 760 }, true);
    // NE1: fire set unerasable -> a fire match does not clear and does not count as a combo; water still clears
    await setBoard(page, [
      { r: 4, c: 0, t: 'fire' }, { r: 4, c: 1, t: 'fire' }, { r: 4, c: 2, t: 'fire' },
      { r: 0, c: 0, t: 'water' }, { r: 0, c: 1, t: 'water' }, { r: 0, c: 2, t: 'water' },
    ]);
    const ne1 = await page.evaluate(async () => {
      uneraseAttrs = new Set(['fire']); render();
      const groupsBefore = findMatches().groups.map(g => g.type);
      await resolveBoard();
      return {
        bottom: [board[4][0].t, board[4][1].t, board[4][2].t],
        lr: document.getElementById('lrCombo').textContent,
        groupsBefore,
      };
    });
    ok('NE1 unerasable attribute: fire forms no match group and stays on the board; other attributes clear',
      ne1.bottom.join() === 'fire,fire,fire' && ne1.lr !== '0' && ne1.groupsBefore.includes('water') && !ne1.groupsBefore.includes('fire'), JSON.stringify(ne1));
    // NE2: the attribute chips toggle the set and the badge shows on that attribute only
    const ne2 = await page.evaluate(() => {
      uneraseAttrs = new Set(); syncUneraseChips(); render();
      document.querySelector('.unerasechip[data-attr="water"]').click();
      const on = [...uneraseAttrs];
      const coord = t => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (board[r][c].t === t) return [r, c]; return null; };
      const badgeAt = ([r, c]) => dropNodes.get(board[r][c].uid).firstChild.innerHTML.includes('🚫');
      const waterBadge = badgeAt(coord('water'));
      const fireBadge = badgeAt(coord('fire'));
      document.querySelector('.unerasechip[data-attr="water"]').click();
      return { on, waterBadge, fireBadge, off: uneraseAttrs.size };
    });
    ok('NE2 unerase chips toggle the attribute set; 🚫 badge appears on that attribute only',
      ne2.on.join() === 'water' && ne2.waterBadge && !ne2.fireBadge && ne2.off === 0, JSON.stringify(ne2));
    // MG1: the "only" picker enforces 2..4 colors
    const mg1 = await page.evaluate(() => {
      megumiOnly = new Set(['fire', 'water']); syncSkyFxUI();
      const chk = v => document.querySelector('.megumiOnlyChk[value="' + v + '"]');
      chk('wood').click(); chk('light').click();
      const at4 = [...megumiOnly].sort().join();
      chk('dark').click();
      const still4 = megumiOnly.size === 4 && !megumiOnly.has('dark') && chk('dark').checked === false;
      chk('light').click(); chk('wood').click();
      const at2 = [...megumiOnly].sort().join();
      chk('fire').click();
      const still2 = megumiOnly.size === 2 && megumiOnly.has('fire') && chk('fire').checked === true;
      return { at4, still4, at2, still2 };
    });
    ok('MG1 megumi "only" picker enforces 2..4 colors', mg1.at4 === 'fire,light,water,wood' && mg1.still4 && mg1.at2 === 'fire,water' && mg1.still2, JSON.stringify(mg1));
    ok('NE3 no page errors (unerase/megumi-custom)', page.errs.length === 0, page.errs.slice(0, 2).join(';'));
    await page.close();
  }

  /* ===== 15) round-6 fixes: roulette bake on edit paths, reset restores roulette, capture loss, small/landscape layout ===== */
  {
    const page = await newPage(browser, { width: 375, height: 760 }, true);
    const r10 = await page.evaluate(() => {
      const B = ['fire', 'water', 'wood', 'light', 'dark', 'heal'];
      pos[2][2] = Object.assign(makePos(), { roul: { colors: B.slice(), interval: 1000, idx: 0, next: 0 } });
      tool = { kind: 'drop', value: 'poison' }; paint(2, 2);
      const painted = board[2][2].t;
      bulkSel = new Set(['poison']); document.getElementById('bulkFillBtn').click();
      const bulkRoul = board[2][2].t, bulkPlain = board[0][0].t;
      return { painted, bulkRoul, bulkPlain };
    });
    ok('R10 painting/filling a special drop onto a roulette cell converts it to fire (paint + bulk fill)',
      r10.painted === 'fire' && r10.bulkRoul === 'fire' && r10.bulkPlain === 'poison', JSON.stringify(r10));
    const r11 = await page.evaluate(() => {
      document.getElementById('roulPreset').value = 'custom';
      document.getElementById('roulPreset').onchange();
      document.querySelectorAll('.roulColorChk').forEach(ch => { ch.checked = (ch.value === 'fire' || ch.value === 'poison'); });
      document.getElementById('roulInterval').value = '2000';
      const before = getRoulPreset();
      document.getElementById('resetBtn').click();
      return {
        before: { preset: document.getElementById('roulPreset').value, colors: before.colors, interval: before.interval },
        preset: document.getElementById('roulPreset').value,
        allChecked: [...document.querySelectorAll('.roulColorChk')].every(ch => ch.checked),
        interval: document.getElementById('roulInterval').value,
        customDisplay: document.getElementById('roulCustom').style.display,
      };
    });
    ok('R11 full reset restores roulette defaults (std preset, all colors, 1s) after a custom setting',
      r11.preset === 'std' && r11.allChecked && r11.interval === '1000' && r11.customDisplay === 'none' && r11.before.colors.join() === 'fire,poison',
      JSON.stringify(r11));
    const u8 = await page.evaluate(() => {
      snapshot = 'KEEP'; tool = { kind: 'mod', value: 'modclear' }; paint(0, 0);
      const afterModClear = snapshot;
      snapshot = 'KEEP'; tool = { kind: 'pos', value: 'posclear' }; paint(0, 0);
      const afterPosClear = snapshot;
      snapshot = 'KEEP'; tool = { kind: 'mod', value: 'plus' }; paint(0, 0);
      const afterRealChange = snapshot;
      tool = { kind: 'mod', value: 'plus' }; paint(0, 0);
      return { afterModClear, afterPosClear, afterRealChange };
    });
    ok('U8 no-change edits (state clear / pos clear on untouched cells) keep the undo snapshot; a real edit discards it',
      u8.afterModClear === 'KEEP' && u8.afterPosClear === 'KEEP' && u8.afterRealChange === null, JSON.stringify(u8));
    const u9 = await page.evaluate(() => {
      snapshot = 'KEEP'; bulkSel = new Set(['fire', 'water']); document.getElementById('bulkFillBtn').click();
      const afterFillFail = snapshot;
      snapshot = 'KEEP'; bulkSel = new Set(); document.getElementById('bulkJinBtn').click();
      const afterJinFail = snapshot;
      return { afterFillFail, afterJinFail };
    });
    ok('U9 failed bulk operations (wrong color count) keep the undo snapshot',
      u9.afterFillFail === 'KEEP' && u9.afterJinFail === 'KEEP', JSON.stringify(u9));
    const o8 = await page.evaluate(() => {
      document.getElementById('ochikonSel').value = 'off';
      document.getElementById('megumiSel').value = 'only'; megumiOnly = new Set(['fire', 'water']); syncSkyFxUI();
      let impure = 0, refilled = 0, matched = 0;
      for (let i = 0; i < 60; i++) {
        newBoard(true);
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (Math.random() < 0.4) board[r][c] = null;
        refillEmpties();
        for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if (lastSpawned.has(board[r][c].uid)) { refilled++; if (board[r][c].t !== 'fire' && board[r][c].t !== 'water') impure++; }
        if (findMatches().groups.length) matched++;
      }
      document.getElementById('megumiSel').value = 'none'; syncSkyFxUI();
      return { impure, refilled, matched };
    });
    ok('O8 megumi "only" refills stay pure (no out-of-set drops) and match-free',
      o8.impure === 0 && o8.matched === 0 && o8.refilled > 300, JSON.stringify(o8));
    const p8 = await page.evaluate(async () => {
      activePid = 99; held = { r: 0, c: 0 }; heldUid = board[0][0].uid; moveStarted = false;
      const ev = new Event('lostpointercapture'); ev.pointerId = 99;
      wrapEl.dispatchEvent(ev);
      await new Promise(r => setTimeout(r, 30));
      return { held, activePid };
    });
    ok('P8 losing pointer capture mid-grab ends the move cleanly (no stuck held state)',
      p8.held === null && p8.activePid === null, JSON.stringify(p8));
    ok('R12 no page errors (round-6 fixes)', page.errs.length === 0, page.errs.slice(0, 2).join(';'));
    await page.close();
  }
  {
    const page = await newPage(browser, { width: 320, height: 568 }, true);
    const ly = await page.evaluate(() => {
      const hdr = document.querySelector('header'), st = document.getElementById('status');
      return { hdrSW: hdr.scrollWidth, hdrCW: hdr.clientWidth, stSW: st.scrollWidth, stCW: st.clientWidth };
    });
    ok('LY1 320px width: header and status fit without horizontal overflow',
      ly.hdrSW <= ly.hdrCW + 1 && ly.stSW <= ly.stCW + 1, JSON.stringify(ly));
    await page.close();
  }
  {
    const page = await newPage(browser, { width: 844, height: 390 }, true);
    const ly2 = await page.evaluate(() => {
      const stage = document.getElementById('stage');
      const oy = getComputedStyle(stage).overflowY;
      stage.scrollTop = stage.scrollHeight;
      const sr = stage.getBoundingClientRect();
      const mr = document.getElementById('megumiSel').getBoundingClientRect();
      return { oy, sh: stage.scrollHeight, ch: stage.clientHeight, megumiVisible: mr.bottom <= sr.bottom + 2 && mr.top >= sr.top - 2 };
    });
    ok('LY2 landscape (844x390): stage scrolls internally and the last play control is reachable',
      ly2.oy === 'auto' && ly2.megumiVisible, JSON.stringify(ly2));
    ok('LY3 no page errors (landscape layout)', page.errs.length === 0, page.errs.slice(0, 2).join(';'));
    await page.close();
  }

  console.log(results.join('\n'));
  const fails = results.filter(r => r.startsWith('FAIL')).length;
  console.log('TOTAL: ' + results.length + ' checks, ' + fails + ' failures');
  await browser.close();
  process.exit(fails ? 1 : 0);
})();
