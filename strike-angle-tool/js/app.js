/* ショット角度ボード — 画面と操作 */
(function () {
  'use strict';

  var P = window.StrikePhysics;
  var STORE_KEY = 'shot-angle-board:v1';
  var FIELD_W = 600;

  // ------------------------------------------------------------------
  // 状態
  // ------------------------------------------------------------------
  function sampleScene() {
    return {
      width: FIELD_W,
      height: 800,
      ball: { x: 330, y: 690, r: 30 },
      enemies: [
        { id: 1, kind: 'boss', x: 300, y: 215, r: 92, hp: 0, weak: [{ dx: -38, dy: 74, r: 18 }] },
        { id: 2, kind: 'minion', x: 105, y: 420, r: 36, hp: 2, weak: [] },
        { id: 3, kind: 'minion', x: 495, y: 395, r: 36, hp: 2, weak: [] },
        { id: 4, kind: 'minion', x: 520, y: 110, r: 32, hp: 2, weak: [] }
      ],
      blocks: [
        { id: 5, x: 40, y: 560, w: 170, h: 26 },
        { id: 6, x: 400, y: 540, w: 150, h: 26 }
      ]
    };
  }

  var state = {
    scene: sampleScene(),
    angle: 18,
    shot: 'reflect',
    distanceMul: 4,
    priority: 'balance',
    tolerance: 1,
    pullMode: false,
    showHeat: true,
    selected: null, // { type: 'ball'|'enemy'|'block'|'weak', id, k }
    nextId: 10
  };

  var image = { el: null, crop: { top: 0, bottom: 0, left: 0, right: 0 }, opacity: 0.85 };

  var result = null;      // 現在角度のシミュレーション結果
  var sweepResult = null; // 全方位検索の結果
  var sceneDirty = true;

  // ------------------------------------------------------------------
  // DOM
  // ------------------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };
  var canvas = $('board');
  var ctx = canvas.getContext('2d');
  var frame = $('board-frame');

  // ------------------------------------------------------------------
  // 保存・復元
  // ------------------------------------------------------------------
  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        scene: state.scene, angle: state.angle, shot: state.shot, distanceMul: state.distanceMul,
        priority: state.priority, tolerance: state.tolerance, pullMode: state.pullMode,
        showHeat: state.showHeat, nextId: state.nextId
      }));
    } catch (e) { /* 保存できない環境でもそのまま動かす */ }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (!data || !data.scene || !data.scene.ball) return;
      ['scene', 'angle', 'shot', 'distanceMul', 'priority', 'tolerance', 'pullMode', 'showHeat', 'nextId'].forEach(function (k) {
        if (data[k] !== undefined) state[k] = data[k];
      });
    } catch (e) { /* 壊れたデータは無視してサンプルで開く */ }
  }

  // ------------------------------------------------------------------
  // 便利関数
  // ------------------------------------------------------------------
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function fmtAngle(a) { return (Math.round(a * 10) / 10).toFixed(1) + '°'; }
  function findEnemy(id) { return state.scene.enemies.find(function (e) { return e.id === id; }); }
  function findBlock(id) { return state.scene.blocks.find(function (b) { return b.id === id; }); }
  function distance() { return state.scene.height * state.distanceMul; }
  function simOpts(record) { return { shot: state.shot, distance: distance(), maxBounces: 150, record: record }; }
  function kindLabel(kind) { return kind === 'boss' ? 'ボス' : '雑魚'; }

  var colors = {};
  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ['field', 'field-grid', 'field-ink', 'path', 'path-edge', 'ball', 'boss', 'minion', 'block', 'weak', 'heat', 'accent'].forEach(function (k) {
      colors[k] = cs.getPropertyValue('--' + k).trim();
    });
  }

  function withAlpha(hex, a) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex);
    if (!m) return hex;
    var n = parseInt(m[1], 16);
    return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  // ------------------------------------------------------------------
  // 計算
  // ------------------------------------------------------------------
  function recompute() {
    result = P.simulate(state.scene, state.angle, simOpts(true));
    if (sceneDirty) {
      sweepResult = P.sweep(state.scene, simOpts(false), {
        step: 0.5, tolerance: state.tolerance, priority: state.priority, top: 5
      });
      sceneDirty = false;
    }
  }

  var rafPending = false;
  function update(opts) {
    if (opts && opts.scene) sceneDirty = true;
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(function () {
      rafPending = false;
      recompute();
      draw();
      renderPanel();
      save();
    });
  }

  // ------------------------------------------------------------------
  // キャンバスのサイズと座標変換
  // ------------------------------------------------------------------
  var view = { scale: 1, dpr: 1 };
  function resize() {
    var cssW = frame.clientWidth;
    var cssH = cssW * (state.scene.height / state.scene.width);
    var dpr = window.devicePixelRatio || 1;
    canvas.style.height = cssH + 'px';
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    view.scale = cssW / state.scene.width;
    view.dpr = dpr;
    draw();
  }

  function toField(ev) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * state.scene.width,
      y: ((ev.clientY - rect.top) / rect.height) * state.scene.height
    };
  }

  // ------------------------------------------------------------------
  // 描画
  // ------------------------------------------------------------------
  function draw() {
    if (!result) return;
    var s = state.scene;
    var k = view.scale * view.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(k, 0, 0, k, 0, 0);
    var px = 1 / view.scale; // 画面上の 1px をフィールド単位で

    // 背景
    ctx.fillStyle = colors.field;
    ctx.fillRect(0, 0, s.width, s.height);
    if (image.el) {
      var iw = image.el.naturalWidth, ih = image.el.naturalHeight, c = image.crop;
      var sx = iw * c.left / 100, sy = ih * c.top / 100;
      var sw = iw * (1 - (c.left + c.right) / 100), sh = ih * (1 - (c.top + c.bottom) / 100);
      ctx.globalAlpha = image.opacity;
      ctx.drawImage(image.el, sx, sy, sw, sh, 0, 0, s.width, s.height);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(6,10,18,0.18)';
      ctx.fillRect(0, 0, s.width, s.height);
    } else {
      ctx.strokeStyle = colors['field-grid'];
      ctx.lineWidth = 1 * px;
      ctx.beginPath();
      for (var gx = 50; gx < s.width; gx += 50) { ctx.moveTo(gx, 0); ctx.lineTo(gx, s.height); }
      for (var gy = 50; gy < s.height; gy += 50) { ctx.moveTo(0, gy); ctx.lineTo(s.width, gy); }
      ctx.stroke();
    }

    drawBlocks(px);
    drawEnemies(px);
    drawHeat(px);
    drawPath(px);
    drawBall(px);
    drawProtractor(px);
  }

  function isSel(type, id, kk) {
    var sel = state.selected;
    return sel && sel.type === type && sel.id === id && (kk === undefined || sel.k === kk);
  }

  function drawBlocks(px) {
    state.scene.blocks.forEach(function (b) {
      var hit = result.events.some(function (ev) { return ev.type === 'block' && ev.id === b.id; });
      ctx.fillStyle = withAlpha(colors.block, 0.85);
      ctx.strokeStyle = hit ? colors.path : 'rgba(255,255,255,0.55)';
      ctx.lineWidth = (hit ? 2.5 : 1.5) * px;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      // 斜線でブロックらしく
      ctx.save();
      ctx.beginPath(); ctx.rect(b.x, b.y, b.w, b.h); ctx.clip();
      ctx.strokeStyle = 'rgba(20,26,38,0.35)';
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      for (var t = -b.h; t < b.w; t += 12) { ctx.moveTo(b.x + t, b.y + b.h); ctx.lineTo(b.x + t + b.h, b.y); }
      ctx.stroke();
      ctx.restore();
      if (isSel('block', b.id)) {
        ctx.setLineDash([6 * px, 4 * px]);
        ctx.strokeStyle = colors['field-ink'];
        ctx.lineWidth = 1.5 * px;
        ctx.strokeRect(b.x - 4 * px, b.y - 4 * px, b.w + 8 * px, b.h + 8 * px);
        ctx.setLineDash([]);
        // 右下のサイズ変更ハンドル
        ctx.fillStyle = colors['field-ink'];
        ctx.fillRect(b.x + b.w - 6 * px, b.y + b.h - 6 * px, 12 * px, 12 * px);
      }
    });
  }

  function drawEnemies(px) {
    var r = state.scene.ball.r;
    state.scene.enemies.forEach(function (e) {
      var h = result.hits[e.id] || { body: 0, weak: 0, defeated: false };
      var col = e.kind === 'boss' ? colors.boss : colors.minion;
      // 当たり判定の外周（ボールの中心がここに入ると接触）
      ctx.setLineDash([3 * px, 5 * px]);
      ctx.strokeStyle = withAlpha(col, 0.35);
      ctx.lineWidth = 1 * px;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r + r, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = withAlpha(col, h.defeated ? 0.18 : 0.42);
      ctx.strokeStyle = col;
      ctx.lineWidth = (h.body > 0 ? 3.5 : 2) * px;
      ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

      // ラベル
      ctx.fillStyle = colors['field-ink'];
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = '700 ' + Math.max(13, Math.min(26, e.r * 0.38)) * px * view.scale + 'px "Zen Kaku Gothic New", sans-serif';
      ctx.fillText(kindLabel(e.kind) + (h.defeated ? '（撃破）' : ''), e.x, e.y - (e.kind === 'boss' ? e.r * 0.18 : 0));
      if (e.kind === 'boss' || e.hp > 0) {
        ctx.font = '600 ' + 11 * px + 'px "Chakra Petch", sans-serif';
        ctx.globalAlpha = 0.8;
        ctx.fillText(e.hp > 0 ? e.hp + '回で撃破' : '', e.x, e.y + (e.kind === 'boss' ? e.r * 0.2 : 14 * px));
        ctx.globalAlpha = 1;
      }

      // 弱点
      (e.weak || []).forEach(function (w, kk) {
        var wx = e.x + w.dx, wy = e.y + w.dy;
        ctx.fillStyle = withAlpha(colors.weak, 0.55);
        ctx.strokeStyle = colors.weak;
        ctx.lineWidth = 2 * px;
        ctx.beginPath(); ctx.arc(wx, wy, w.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1.5 * px;
        ctx.beginPath();
        ctx.moveTo(wx - w.r * 0.5, wy); ctx.lineTo(wx + w.r * 0.5, wy);
        ctx.moveTo(wx, wy - w.r * 0.5); ctx.lineTo(wx, wy + w.r * 0.5);
        ctx.stroke();
        if (isSel('weak', e.id, kk)) selectionRing(wx, wy, w.r + 5 * px, px);
      });

      // ヒット数バッジ
      if (h.body > 0 || h.weak > 0) {
        var label = '×' + h.body + (h.weak ? '  弱' + h.weak : '');
        ctx.font = '700 ' + 14 * px + 'px "Chakra Petch", "Zen Kaku Gothic New", sans-serif';
        var tw = ctx.measureText(label).width + 14 * px;
        var bx = e.x + e.r * 0.7, by = e.y - e.r * 0.85;
        ctx.fillStyle = colors.path;
        roundRect(bx - tw / 2, by - 11 * px, tw, 22 * px, 11 * px);
        ctx.fill();
        ctx.fillStyle = colors['path-edge'];
        ctx.fillText(label, bx, by + 1 * px);
      }

      if (isSel('enemy', e.id)) selectionRing(e.x, e.y, e.r + 6 * px, px);
    });
  }

  function selectionRing(x, y, rad, px) {
    ctx.setLineDash([6 * px, 4 * px]);
    ctx.strokeStyle = colors['field-ink'];
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath(); ctx.arc(x, y, rad, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  function roundRect(x, y, w, h, rr) {
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawPath(px) {
    var pts = result.path;
    var r = state.scene.ball.r;
    var total = result.length || 1;

    // ボールの太さ（当たり判定の幅）
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = withAlpha(colors.path, 0.1);
    ctx.lineWidth = r * 2;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();

    // 軌道の中心線（先へ行くほど薄く）
    var acc = 0;
    for (i = 1; i < pts.length; i++) {
      var a = pts[i - 1], b = pts[i];
      var seg = Math.hypot(b.x - a.x, b.y - a.y);
      var alpha = 1 - 0.75 * (acc / total);
      acc += seg;
      ctx.strokeStyle = withAlpha(colors['path-edge'], 0.6 * alpha);
      ctx.lineWidth = 5.5 * px;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.strokeStyle = withAlpha(colors.path, alpha);
      ctx.lineWidth = 3 * px;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    // 反射点に番号
    var n = 0;
    result.events.forEach(function (ev) {
      if (ev.type === 'weak' || ev.type === 'pierce') return;
      n++;
      if (n > 12) return;
      ctx.fillStyle = colors['path-edge'];
      ctx.strokeStyle = colors.path;
      ctx.lineWidth = 2 * px;
      ctx.beginPath(); ctx.arc(ev.x, ev.y, 9 * px, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = colors.path;
      ctx.font = '700 ' + 11 * px + 'px "Chakra Petch", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(n), ev.x, ev.y + 0.5 * px);
    });

    // 貫通ヒット・弱点ヒットの印
    result.events.forEach(function (ev) {
      if (ev.type !== 'pierce' && ev.type !== 'weak') return;
      var col = ev.type === 'weak' ? colors.weak : colors.path;
      burst(ev.x, ev.y, (ev.type === 'weak' ? 14 : 10) * px, col, px);
    });

    // 止まる位置
    var end = result.end;
    ctx.setLineDash([5 * px, 4 * px]);
    ctx.strokeStyle = withAlpha(colors.ball, 0.9);
    ctx.lineWidth = 2 * px;
    ctx.beginPath(); ctx.arc(end.x, end.y, r, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }

  function burst(x, y, rad, col, px) {
    ctx.strokeStyle = col;
    ctx.lineWidth = 2.5 * px;
    ctx.beginPath();
    for (var i = 0; i < 8; i++) {
      var a = (i * Math.PI) / 4;
      ctx.moveTo(x + Math.cos(a) * rad * 0.45, y + Math.sin(a) * rad * 0.45);
      ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    ctx.stroke();
  }

  function drawBall(px) {
    var b = state.scene.ball;
    ctx.fillStyle = withAlpha(colors.ball, 0.9);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2.5 * px;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 ' + Math.max(11, b.r * 0.5) * px * view.scale + 'px "Zen Kaku Gothic New", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('自', b.x, b.y + 1 * px);
    if (isSel('ball', 0)) selectionRing(b.x, b.y, b.r + 6 * px, px);
  }

  function drawHeat(px) {
    if (!state.showHeat || !sweepResult || sweepResult.max <= 0) return;
    var b = state.scene.ball;
    var inner = b.r + 14 * px, outer = b.r + 34 * px;
    var n = sweepResult.smooth.length, step = sweepResult.step;
    for (var i = 0; i < n; i++) {
      var v = sweepResult.smooth[i] / sweepResult.max;
      if (v <= 0.02) continue;
      var a0 = ((i * step - step / 2 - 90) * Math.PI) / 180;
      var a1 = ((i * step + step / 2 - 90) * Math.PI) / 180;
      ctx.fillStyle = withAlpha(colors.heat, 0.12 + 0.78 * v * v);
      ctx.beginPath();
      ctx.arc(b.x, b.y, outer, a0, a1 + 0.002);
      ctx.arc(b.x, b.y, inner, a1 + 0.002, a0, true);
      ctx.closePath();
      ctx.fill();
    }
    // 上位の角度に目印
    sweepResult.best.forEach(function (best, idx) {
      var d = P.angleToDir(best.angle);
      var x = b.x + d.x * (outer + 12 * px), y = b.y + d.y * (outer + 12 * px);
      ctx.fillStyle = colors['path-edge'];
      ctx.beginPath(); ctx.arc(x, y, 8 * px, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = colors.heat;
      ctx.lineWidth = 1.5 * px;
      ctx.stroke();
      ctx.fillStyle = colors.heat;
      ctx.font = '700 ' + 10 * px + 'px "Chakra Petch", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(idx + 1), x, y + 0.5 * px);
    });
  }

  function drawProtractor(px) {
    var b = state.scene.ball;
    var R = b.r + 58 * px;
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 1 * px;
    ctx.beginPath(); ctx.arc(b.x, b.y, R, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath();
    for (var a = 0; a < 360; a += 15) {
      var d = P.angleToDir(a);
      var len = a % 45 === 0 ? 9 : 5;
      ctx.moveTo(b.x + d.x * R, b.y + d.y * R);
      ctx.lineTo(b.x + d.x * (R - len * px), b.y + d.y * (R - len * px));
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '600 ' + 10 * px + 'px "Chakra Petch", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (a = 0; a < 360; a += 45) {
      d = P.angleToDir(a);
      ctx.fillText(a + '°', b.x + d.x * (R + 12 * px), b.y + d.y * (R + 12 * px));
    }

    // 発射方向の矢印
    d = P.angleToDir(state.angle);
    var x0 = b.x + d.x * (b.r + 4 * px), y0 = b.y + d.y * (b.r + 4 * px);
    var x1 = b.x + d.x * (R + 2 * px), y1 = b.y + d.y * (R + 2 * px);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3 * px;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    var ah = 10 * px, nx = -d.y, ny = d.x;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(x1 + d.x * ah, y1 + d.y * ah);
    ctx.lineTo(x1 + nx * ah * 0.6, y1 + ny * ah * 0.6);
    ctx.lineTo(x1 - nx * ah * 0.6, y1 - ny * ah * 0.6);
    ctx.closePath();
    ctx.fill();

    // 角度ラベル（ボールの反対側に置いて軌道と重ねない）
    var label = fmtAngle(state.angle);
    ctx.font = '700 ' + 15 * px + 'px "Chakra Petch", sans-serif';
    var lx = clamp(b.x - d.x * (R + 30 * px), 34 * px, state.scene.width - 34 * px);
    var ly = clamp(b.y - d.y * (R + 30 * px), 14 * px, state.scene.height - 14 * px);
    var tw = ctx.measureText(label).width + 14 * px;
    ctx.fillStyle = 'rgba(8,12,20,0.78)';
    roundRect(lx - tw / 2, ly - 12 * px, tw, 24 * px, 6 * px);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(label, lx, ly + 1 * px);
  }

  // ------------------------------------------------------------------
  // パネル
  // ------------------------------------------------------------------
  function renderPanel() {
    var a = state.angle;
    $('angle-value').textContent = fmtAngle(a);
    $('angle-clock').textContent = P.angleToClock(a);
    $('dial-needle').style.transform = 'rotate(' + (a + 180) + 'deg)';
    $('angle-range').value = String(a);
    if (document.activeElement !== $('angle-input')) $('angle-input').value = String(Math.round(a * 10) / 10);

    ['reflect', 'pierce'].forEach(function (t) {
      $('shot-' + t).setAttribute('aria-checked', state.shot === t ? 'true' : 'false');
    });

    // 当たり判定の集計
    var s = P.summarize(state.scene, result);
    var minionTotal = state.scene.enemies.filter(function (e) { return e.kind !== 'boss'; }).length;
    var rows = [
      ['ボス本体', s.boss, '回', 'var(--boss)'],
      ['弱点', s.weak, '回', 'var(--weak)'],
      ['雑魚', s.minion, '回', 'var(--minion)'],
      ['雑魚撃破', s.defeated, '/ ' + minionTotal + '体', 'var(--minion)'],
      ['ブロック反射', result.blockHits, '回', 'var(--block)'],
      ['壁反射', result.wallHits, '回', 'var(--line)']
    ];
    $('stats').innerHTML = rows.map(function (row) {
      return '<div class="stat" style="--stat-color:' + row[3] + '"><dt>' + row[0] + '</dt><dd>' + row[1] + '<small>' + row[2] + '</small></dd></div>';
    }).join('');

    var first = result.firstTarget != null ? findEnemy(result.firstTarget) : null;
    $('first-hit').innerHTML = first
      ? '最初に当たる敵: <strong>' + kindLabel(first.kind) + '</strong> ・ 評価 <strong>' + P.score(state.scene, result, state.priority).toFixed(1) + '</strong> 点'
      : 'この角度では敵に当たりません。';

    // おすすめ角度
    $('tolerance-out').textContent = '±' + state.tolerance.toFixed(1) + '°';
    $('distance-out').textContent = '×' + state.distanceMul;
    $('priority').value = state.priority;
    $('show-heat').checked = state.showHeat;
    $('pull-mode').checked = state.pullMode;
    $('tolerance').value = String(state.tolerance);
    $('distance').value = String(state.distanceMul);

    var list = $('best-list');
    var best = sweepResult ? sweepResult.best : [];
    if (!best.length) {
      list.innerHTML = '<li class="best-empty">敵を置くと、ここに当たりやすい角度が出ます。</li>';
    } else {
      var top = best[0].stable || 1;
      list.innerHTML = best.map(function (b, i) {
        var r = P.simulate(state.scene, b.angle, simOpts(false));
        var sm = P.summarize(state.scene, r);
        var parts = [];
        if (sm.boss) parts.push('ボス' + sm.boss);
        if (sm.weak) parts.push('弱点' + sm.weak);
        if (sm.minion) parts.push('雑魚' + sm.minion);
        if (sm.defeated) parts.push('撃破' + sm.defeated);
        var current = Math.abs(b.angle - state.angle) < 0.01;
        return '<li class="best-item"><button type="button" data-angle="' + b.angle + '"' + (current ? ' aria-current="true"' : '') + '>' +
          '<span class="best-rank">' + (i + 1) + '</span>' +
          '<span class="best-angle">' + fmtAngle(b.angle) + '</span>' +
          '<span class="best-detail">' + P.angleToClock(b.angle) + ' ・ ' + (parts.join(' ') || '—') + '</span>' +
          '<span class="best-bar" title="安定度"><span style="width:' + Math.round((b.stable / top) * 100) + '%"></span></span>' +
          '</button></li>';
      }).join('');
    }

    renderProps();
    $('add-weak').disabled = !(state.selected && (state.selected.type === 'enemy' || state.selected.type === 'weak'));
  }

  var propsKey = '';
  function renderProps() {
    var sel = state.selected;
    var key = sel ? sel.type + ':' + sel.id + ':' + (sel.k || 0) : '';
    var box = $('props');
    // 入力中に作り直すとフォーカスが外れるので、選択が変わった時だけ組み立てる
    if (key === propsKey && box.childElementCount) { syncProps(); return; }
    propsKey = key;

    if (!sel) {
      box.innerHTML = '<p class="props-empty">フィールド上の敵・ブロック・ボールをタップすると、大きさや撃破までの回数を変えられます。</p>';
      return;
    }
    var html = '';
    if (sel.type === 'ball') {
      html = title('自分のボール', 'var(--ball)') + rangeRow('p-r', '半径', 14, 60, 1);
    } else if (sel.type === 'enemy') {
      var e = findEnemy(sel.id);
      html = title(kindLabel(e.kind), e.kind === 'boss' ? 'var(--boss)' : 'var(--minion)') +
        '<div class="field-row"><label for="p-kind">種類</label><select id="p-kind"><option value="boss">ボス</option><option value="minion">雑魚</option></select></div>' +
        rangeRow('p-r', '半径', 12, 200, 1) +
        '<div class="field-row"><label for="p-hp">撃破まで</label><span><input type="number" id="p-hp" class="props-num" min="0" max="99" step="1"> 回</span><span></span></div>' +
        '<p class="note">0 回 = 倒れない（ボスなど）。雑魚を倒すと、その後は当たり判定が消えます。</p>' +
        '<div class="button-row"><button type="button" class="ghost" id="p-add-weak">＋ 弱点を付ける</button><button type="button" class="ghost danger" id="p-delete">削除</button></div>';
    } else if (sel.type === 'block') {
      html = title('ブロック', 'var(--block)') + rangeRow('p-w', '幅', 10, 600, 1) + rangeRow('p-h', '高さ', 10, 400, 1) +
        '<p class="note">右下の四角をドラッグしても大きさを変えられます。ブロックは貫通タイプでも跳ね返ります。</p>' +
        '<div class="button-row"><button type="button" class="ghost danger" id="p-delete">削除</button></div>';
    } else if (sel.type === 'weak') {
      html = title('弱点', 'var(--weak)') + rangeRow('p-r', '半径', 6, 60, 1) +
        '<p class="note">ボールの体が弱点に触れたら 1 回と数えます。</p>' +
        '<div class="button-row"><button type="button" class="ghost danger" id="p-delete">削除</button></div>';
    }
    box.innerHTML = html;
    syncProps();
  }

  function title(text, col) { return '<div class="props-title"><span class="props-swatch" style="--sw:' + col + '"></span>' + text + '</div>'; }
  function rangeRow(id, label, min, max, step) {
    return '<div class="field-row"><label for="' + id + '">' + label + '</label><input type="range" id="' + id + '" min="' + min + '" max="' + max + '" step="' + step + '"><output class="mono" id="' + id + '-out"></output></div>';
  }

  function selectedObject() {
    var sel = state.selected;
    if (!sel) return null;
    if (sel.type === 'ball') return state.scene.ball;
    if (sel.type === 'enemy') return findEnemy(sel.id);
    if (sel.type === 'block') return findBlock(sel.id);
    if (sel.type === 'weak') { var e = findEnemy(sel.id); return e && e.weak[sel.k]; }
    return null;
  }

  function syncProps() {
    var o = selectedObject();
    if (!o) return;
    function setRange(id, v) {
      var el = $(id);
      if (!el) return;
      if (document.activeElement !== el) el.value = String(Math.round(v));
      $(id + '-out').textContent = String(Math.round(v));
    }
    setRange('p-r', o.r);
    setRange('p-w', o.w);
    setRange('p-h', o.h);
    if ($('p-kind')) $('p-kind').value = o.kind;
    if ($('p-hp') && document.activeElement !== $('p-hp')) $('p-hp').value = String(o.hp || 0);
  }

  $('props').addEventListener('input', function (ev) {
    var o = selectedObject();
    if (!o) return;
    var id = ev.target.id, v = Number(ev.target.value);
    if (id === 'p-r') o.r = v;
    else if (id === 'p-w') o.w = v;
    else if (id === 'p-h') o.h = v;
    else if (id === 'p-hp') o.hp = clamp(Math.round(v) || 0, 0, 99);
    else if (id === 'p-kind') { o.kind = ev.target.value; propsKey = ''; }
    else return;
    update({ scene: true });
  });
  $('props').addEventListener('change', function (ev) {
    if (ev.target.id === 'p-kind') {
      var o = selectedObject();
      if (o) { o.kind = ev.target.value; propsKey = ''; update({ scene: true }); }
    }
  });
  $('props').addEventListener('click', function (ev) {
    if (ev.target.id === 'p-delete') deleteSelected();
    if (ev.target.id === 'p-add-weak') addWeak();
  });

  // ------------------------------------------------------------------
  // 追加・削除
  // ------------------------------------------------------------------
  function freeSpot(r) {
    // 既存の物と重なりにくい場所を探す
    var s = state.scene, best = null, bestD = -1;
    for (var i = 0; i < 60; i++) {
      var x = r + Math.random() * (s.width - 2 * r);
      var y = r + Math.random() * (s.height * 0.7 - 2 * r);
      var d = Infinity;
      s.enemies.forEach(function (e) { d = Math.min(d, Math.hypot(e.x - x, e.y - y) - e.r - r); });
      d = Math.min(d, Math.hypot(s.ball.x - x, s.ball.y - y) - s.ball.r - r);
      if (d > bestD) { bestD = d; best = { x: x, y: y }; }
    }
    return best;
  }

  function addEnemy(kind) {
    var r = kind === 'boss' ? 90 : 36;
    var p = freeSpot(r);
    var e = { id: state.nextId++, kind: kind, x: Math.round(p.x), y: Math.round(p.y), r: r, hp: kind === 'boss' ? 0 : 2, weak: [] };
    state.scene.enemies.push(e);
    state.selected = { type: 'enemy', id: e.id };
    update({ scene: true });
  }

  function addBlock() {
    var b = { id: state.nextId++, x: Math.round(state.scene.width / 2 - 70), y: Math.round(state.scene.height * 0.5), w: 140, h: 26 };
    state.scene.blocks.push(b);
    state.selected = { type: 'block', id: b.id };
    update({ scene: true });
  }

  function addWeak() {
    var sel = state.selected;
    if (!sel || (sel.type !== 'enemy' && sel.type !== 'weak')) return;
    var e = findEnemy(sel.id);
    var d = Math.hypot(state.scene.ball.x - e.x, state.scene.ball.y - e.y) || 1;
    // ボールに向いた側の縁に置く
    e.weak.push({ dx: Math.round(((state.scene.ball.x - e.x) / d) * e.r * 0.75), dy: Math.round(((state.scene.ball.y - e.y) / d) * e.r * 0.75), r: Math.max(10, Math.round(e.r * 0.2)) });
    state.selected = { type: 'weak', id: e.id, k: e.weak.length - 1 };
    update({ scene: true });
  }

  function deleteSelected() {
    var sel = state.selected;
    if (!sel) return;
    if (sel.type === 'enemy') state.scene.enemies = state.scene.enemies.filter(function (e) { return e.id !== sel.id; });
    else if (sel.type === 'block') state.scene.blocks = state.scene.blocks.filter(function (b) { return b.id !== sel.id; });
    else if (sel.type === 'weak') { var e = findEnemy(sel.id); if (e) e.weak.splice(sel.k, 1); }
    else return; // ボールは消さない
    state.selected = null;
    update({ scene: true });
  }

  $('add-boss').addEventListener('click', function () { addEnemy('boss'); });
  $('add-minion').addEventListener('click', function () { addEnemy('minion'); });
  $('add-block').addEventListener('click', addBlock);
  $('add-weak').addEventListener('click', addWeak);

  // ------------------------------------------------------------------
  // キャンバス操作
  // ------------------------------------------------------------------
  function hitTest(p) {
    var s = state.scene;
    var tol = 10 / view.scale; // 指で掴みやすいよう少し広めに
    var sel = state.selected;
    if (sel && sel.type === 'block') {
      var sb = findBlock(sel.id);
      if (sb && Math.abs(p.x - (sb.x + sb.w)) < tol + 4 && Math.abs(p.y - (sb.y + sb.h)) < tol + 4) return { type: 'block-resize', id: sb.id };
    }
    for (var i = s.enemies.length - 1; i >= 0; i--) {
      var e = s.enemies[i];
      for (var k = 0; k < e.weak.length; k++) {
        var w = e.weak[k];
        if (Math.hypot(p.x - e.x - w.dx, p.y - e.y - w.dy) < Math.max(w.r, 8) + tol * 0.5) return { type: 'weak', id: e.id, k: k };
      }
    }
    if (Math.hypot(p.x - s.ball.x, p.y - s.ball.y) < s.ball.r + tol * 0.5) return { type: 'ball', id: 0 };
    for (i = s.enemies.length - 1; i >= 0; i--) {
      e = s.enemies[i];
      if (Math.hypot(p.x - e.x, p.y - e.y) < e.r) return { type: 'enemy', id: e.id };
    }
    for (i = s.blocks.length - 1; i >= 0; i--) {
      var b = s.blocks[i];
      if (p.x >= b.x - tol * 0.5 && p.x <= b.x + b.w + tol * 0.5 && p.y >= b.y - tol * 0.5 && p.y <= b.y + b.h + tol * 0.5) return { type: 'block', id: b.id };
    }
    return null;
  }

  function aimAt(p) {
    var b = state.scene.ball;
    var dx = p.x - b.x, dy = p.y - b.y;
    if (Math.hypot(dx, dy) < 4) return;
    setAngle(P.dirToAngle(dx, dy));
  }

  function setAngle(a, exact) {
    a = P.normAngle(a);
    state.angle = exact ? Math.round(a * 1000) / 1000 : Math.round(a * 2) / 2; // ドラッグ時は 0.5° 刻み
    if (state.angle >= 360) state.angle = 0;
    update();
  }

  var drag = null;
  canvas.addEventListener('pointerdown', function (ev) {
    if (ev.button !== undefined && ev.button !== 0) return;
    var p = toField(ev);
    var hit = hitTest(p);
    canvas.setPointerCapture(ev.pointerId);
    if (hit) {
      if (hit.type !== 'block-resize') state.selected = { type: hit.type, id: hit.id, k: hit.k };
      var o = hit.type === 'block-resize' ? findBlock(hit.id) : selectedObject();
      drag = { kind: hit.type, start: p, origin: o ? { x: o.x !== undefined ? o.x : o.dx, y: o.y !== undefined ? o.y : o.dy, w: o.w, h: o.h } : null, moved: false };
      update();
    } else {
      state.selected = null;
      drag = { kind: 'aim', start: p };
      if (!state.pullMode) aimAt(p);
      update();
    }
    ev.preventDefault();
  });

  canvas.addEventListener('pointermove', function (ev) {
    var p = toField(ev);
    if (!drag) {
      var h = hitTest(p);
      canvas.style.cursor = h ? (h.type === 'block-resize' ? 'nwse-resize' : 'grab') : 'crosshair';
      return;
    }
    var s = state.scene;
    var dx = p.x - drag.start.x, dy = p.y - drag.start.y;
    if (drag.kind === 'aim') {
      if (state.pullMode) {
        // ひっぱり操作: 引いた向きと反対へ飛ぶ
        if (Math.hypot(dx, dy) > 6) setAngle(P.dirToAngle(-dx, -dy));
      } else aimAt(p);
      return;
    }
    drag.moved = true;
    var o = drag.origin;
    if (drag.kind === 'ball') {
      s.ball.x = clamp(o.x + dx, s.ball.r, s.width - s.ball.r);
      s.ball.y = clamp(o.y + dy, s.ball.r, s.height - s.ball.r);
    } else if (drag.kind === 'enemy') {
      var e = findEnemy(state.selected.id);
      e.x = clamp(o.x + dx, 0, s.width); e.y = clamp(o.y + dy, 0, s.height);
    } else if (drag.kind === 'weak') {
      var w = selectedObject();
      w.dx = o.x + dx; w.dy = o.y + dy;
    } else if (drag.kind === 'block') {
      var b = findBlock(state.selected.id);
      b.x = clamp(o.x + dx, -b.w / 2, s.width - b.w / 2); b.y = clamp(o.y + dy, -b.h / 2, s.height - b.h / 2);
    } else if (drag.kind === 'block-resize') {
      var rb = findBlock(state.selected.id);
      rb.w = Math.max(10, o.w + dx); rb.h = Math.max(10, o.h + dy);
    }
    update({ scene: true });
  });

  function endDrag() {
    if (drag && drag.moved) {
      // 座標を整数に丸めて保存
      var o = selectedObject();
      if (o) ['x', 'y', 'dx', 'dy', 'w', 'h'].forEach(function (k) { if (typeof o[k] === 'number') o[k] = Math.round(o[k]); });
      update({ scene: true });
    }
    drag = null;
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('wheel', function (ev) {
    // ホイールで選択中の物の大きさを変える
    var o = selectedObject();
    if (!o || o.r === undefined) return;
    ev.preventDefault();
    o.r = clamp(o.r - Math.sign(ev.deltaY) * 2, 6, 200);
    update({ scene: true });
  }, { passive: false });

  document.addEventListener('keydown', function (ev) {
    var t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    if (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight') {
      var step = ev.shiftKey ? 5 : 0.5;
      setAngle(state.angle + (ev.key === 'ArrowRight' ? step : -step), true);
      ev.preventDefault();
    } else if ((ev.key === 'Delete' || ev.key === 'Backspace') && state.selected) {
      deleteSelected();
      ev.preventDefault();
    } else if (ev.key === 'Escape') {
      state.selected = null;
      update();
    }
  });

  // ------------------------------------------------------------------
  // パネル操作
  // ------------------------------------------------------------------
  $('angle-range').addEventListener('input', function (ev) { setAngle(Number(ev.target.value), true); });
  $('angle-input').addEventListener('input', function (ev) {
    var v = Number(ev.target.value);
    if (ev.target.value !== '' && isFinite(v)) setAngle(v, true);
  });
  Array.prototype.forEach.call(document.querySelectorAll('.step'), function (btn) {
    btn.addEventListener('click', function () { setAngle(state.angle + Number(btn.dataset.step), true); });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.seg-btn'), function (btn) {
    btn.addEventListener('click', function () { state.shot = btn.dataset.shot; update({ scene: true }); });
  });
  $('best-list').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-angle]');
    if (btn) setAngle(Number(btn.dataset.angle), true);
  });
  $('priority').addEventListener('change', function (ev) { state.priority = ev.target.value; update({ scene: true }); });
  $('tolerance').addEventListener('input', function (ev) { state.tolerance = Number(ev.target.value); update({ scene: true }); });
  $('distance').addEventListener('input', function (ev) { state.distanceMul = Number(ev.target.value); update({ scene: true }); });
  $('show-heat').addEventListener('change', function (ev) { state.showHeat = ev.target.checked; update(); });
  $('pull-mode').addEventListener('change', function (ev) {
    state.pullMode = ev.target.checked;
    $('mode-hint').textContent = state.pullMode
      ? '空いている所から引っぱる → 引いた方向の反対へ発射（ゲームと同じ操作）。敵・ブロック・ボールはドラッグで移動。'
      : '空いている所をドラッグ → その方向へ発射。敵・ブロック・ボールはドラッグで移動。← → キーで 0.5° ずつ調整。';
    update();
  });

  $('reset-sample').addEventListener('click', function () {
    var h = state.scene.height;
    state.scene = sampleScene();
    if (image.el) setFieldHeight(fieldHeightForImage(), 800);
    else if (h !== 800) resize();
    state.selected = null;
    update({ scene: true });
  });

  var clearTimer = null;
  $('clear-all').addEventListener('click', function () {
    var btn = $('clear-all');
    if (!btn.classList.contains('armed')) {
      btn.classList.add('armed');
      btn.textContent = 'もう一度押すと消します';
      clearTimer = setTimeout(function () { btn.classList.remove('armed'); btn.textContent = '敵とブロックを全部消す'; }, 3000);
      return;
    }
    clearTimeout(clearTimer);
    btn.classList.remove('armed');
    btn.textContent = '敵とブロックを全部消す';
    state.scene.enemies = [];
    state.scene.blocks = [];
    state.selected = null;
    update({ scene: true });
  });

  // ------------------------------------------------------------------
  // 背景画像
  // ------------------------------------------------------------------
  function fieldHeightForImage() {
    var c = image.crop;
    var w = image.el.naturalWidth * (1 - (c.left + c.right) / 100);
    var h = image.el.naturalHeight * (1 - (c.top + c.bottom) / 100);
    return Math.round(clamp(FIELD_W * (h / w), 400, 1400));
  }

  function setFieldHeight(newH, oldH) {
    oldH = oldH || state.scene.height;
    if (newH === oldH) return;
    var k = newH / oldH;
    var s = state.scene;
    s.height = newH;
    s.ball.y *= k;
    s.enemies.forEach(function (e) { e.y *= k; e.weak.forEach(function (w) { w.dy *= k; }); });
    s.blocks.forEach(function (b) { b.y *= k; b.h *= k; });
    resize();
    sceneDirty = true;
  }

  function loadImageFile(file) {
    if (!file || !/^image\//.test(file.type)) return;
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        image.el = img;
        $('crop-controls').hidden = false;
        $('image-clear').disabled = false;
        setFieldHeight(fieldHeightForImage());
        update({ scene: true });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  }

  $('image-input').addEventListener('change', function (ev) { loadImageFile(ev.target.files[0]); ev.target.value = ''; });
  $('image-clear').addEventListener('click', function () {
    image.el = null;
    $('crop-controls').hidden = true;
    $('image-clear').disabled = true;
    setFieldHeight(800);
    update({ scene: true });
  });
  ['top', 'bottom', 'left', 'right'].forEach(function (side) {
    $('crop-' + side).addEventListener('input', function (ev) {
      image.crop[side] = Number(ev.target.value);
      $('crop-' + side + '-out').textContent = image.crop[side] + '%';
      if (image.el) setFieldHeight(fieldHeightForImage());
      update({ scene: true });
    });
  });
  $('image-opacity').addEventListener('input', function (ev) {
    image.opacity = Number(ev.target.value);
    $('image-opacity-out').textContent = Math.round(image.opacity * 100) + '%';
    update();
  });

  document.addEventListener('paste', function (ev) {
    var items = (ev.clipboardData && ev.clipboardData.items) || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image/') === 0) { loadImageFile(items[i].getAsFile()); ev.preventDefault(); return; }
    }
  });
  frame.addEventListener('dragover', function (ev) { ev.preventDefault(); $('drop-hint').hidden = false; });
  frame.addEventListener('dragleave', function () { $('drop-hint').hidden = true; });
  frame.addEventListener('drop', function (ev) {
    ev.preventDefault();
    $('drop-hint').hidden = true;
    if (ev.dataTransfer && ev.dataTransfer.files[0]) loadImageFile(ev.dataTransfer.files[0]);
  });

  // ------------------------------------------------------------------
  // 起動
  // ------------------------------------------------------------------
  function onTheme() { readColors(); update(); }
  try { window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', onTheme); } catch (e) { /* 古いブラウザ */ }
  new MutationObserver(onTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  if (window.ResizeObserver) new ResizeObserver(function () { resize(); }).observe(frame);
  else window.addEventListener('resize', resize);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(function () { draw(); });

  load();
  readColors();
  recompute();
  resize();
  renderPanel();
})();
