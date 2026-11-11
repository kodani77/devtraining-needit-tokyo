/*
 * ショット角度ボード — 物理・当たり判定エンジン
 *
 * ブラウザでは window.StrikePhysics として、Node では require() で使える。
 *
 * 座標系: フィールド左上が (0,0)、右が +x、下が +y。
 * 角度:   0° = 真上（12時方向）、時計回りに増える（90° = 右、180° = 真下）。
 *
 * 判定モデル
 *   - ボール       : 半径 r の円
 *   - ボス / 雑魚  : 半径 R の円（ボールの中心が R + r に入ったら接触）
 *   - 弱点         : 敵に付く小さな円。ボール本体が触れたら弱点ヒット
 *   - ブロック     : 軸平行の長方形。反射・貫通どちらのタイプでも跳ね返る
 *   - 壁           : フィールドの外枠。常に跳ね返る
 *   反射タイプは敵に当たると跳ね返り、貫通タイプは敵をすり抜けてヒット数だけ数える。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.StrikePhysics = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var EPS = 1e-7;

  function angleToDir(deg) {
    var rad = (deg * Math.PI) / 180;
    return { x: Math.sin(rad), y: -Math.cos(rad) };
  }

  function dirToAngle(dx, dy) {
    var a = (Math.atan2(dx, -dy) * 180) / Math.PI;
    if (a < 0) a += 360;
    if (a >= 360) a -= 360;
    return a;
  }

  function normAngle(a) {
    a = a % 360;
    return a < 0 ? a + 360 : a;
  }

  /** 角度を時計の文字盤で表す（30° = 1時間、30分刻み）。 */
  function angleToClock(deg) {
    var halfHours = Math.round(normAngle(deg) / 15); // 0..24
    var hour = Math.floor(halfHours / 2) % 12;
    var half = halfHours % 2 === 1;
    if (hour === 0) hour = 12;
    return hour + '時' + (half ? '半' : '');
  }

  /** 半直線 p + t d (d は単位ベクトル) と円 |x - c| = R の交点パラメータ。 */
  function rayCircle(px, py, dx, dy, cx, cy, R) {
    var fx = px - cx;
    var fy = py - cy;
    var b = fx * dx + fy * dy;
    var c = fx * fx + fy * fy - R * R;
    var disc = b * b - c;
    if (disc < 0) return null;
    var s = Math.sqrt(disc);
    return { t1: -b - s, t2: -b + s };
  }

  /** ボール（半径 r）と長方形ブロックの最初の接触。ミンコフスキー和（角丸長方形）で解く。 */
  function rayBlock(px, py, dx, dy, b, r) {
    var best = null;
    function consider(t, nx, ny) {
      if (t > EPS && (best === null || t < best.t)) best = { t: t, nx: nx, ny: ny };
    }
    var x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
    var t, hx, hy;
    // 上下左右の面
    if (dy > 0) {
      t = (y0 - r - py) / dy; hx = px + t * dx;
      if (hx >= x0 && hx <= x1) consider(t, 0, -1);
    } else if (dy < 0) {
      t = (y1 + r - py) / dy; hx = px + t * dx;
      if (hx >= x0 && hx <= x1) consider(t, 0, 1);
    }
    if (dx > 0) {
      t = (x0 - r - px) / dx; hy = py + t * dy;
      if (hy >= y0 && hy <= y1) consider(t, -1, 0);
    } else if (dx < 0) {
      t = (x1 + r - px) / dx; hy = py + t * dy;
      if (hy >= y0 && hy <= y1) consider(t, 1, 0);
    }
    // 四隅（半径 r の円）
    var corners = [[x0, y0], [x1, y0], [x0, y1], [x1, y1]];
    for (var i = 0; i < 4; i++) {
      var cx = corners[i][0], cy = corners[i][1];
      var hit = rayCircle(px, py, dx, dy, cx, cy, r);
      if (hit && hit.t1 > EPS) {
        var qx = px + hit.t1 * dx - cx;
        var qy = py + hit.t1 * dy - cy;
        var len = Math.hypot(qx, qy) || 1;
        consider(hit.t1, qx / len, qy / len);
      }
    }
    if (best && best.nx * dx + best.ny * dy >= 0) return null; // 離れていく向きは無視
    return best;
  }

  /**
   * 線分 [0, L] の間に円 (中心 c, 半径 R) へ「入った」かを判定し、内外の状態を更新する。
   * 入った瞬間だけ true（同じ円の中に居続ける間は数えない）。
   */
  function trackEnter(state, key, px, py, dx, dy, L, cx, cy, R) {
    var hit = rayCircle(px, py, dx, dy, cx, cy, R);
    var inside = !!state[key];
    if (!hit || hit.t2 < -EPS) { state[key] = false; return false; }
    if (inside) {
      if (hit.t2 < L - EPS) state[key] = false;
      return false;
    }
    if (hit.t1 >= -EPS && hit.t1 <= L + EPS) {
      state[key] = hit.t2 > L + EPS;
      return true;
    }
    if (hit.t1 < -EPS && hit.t2 > EPS) state[key] = hit.t2 > L; // 最初から中にいた
    return false;
  }

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  /**
   * 1 本のショットを最後まで追いかける。
   * @param scene { width, height, ball:{x,y,r}, enemies:[{id,kind,x,y,r,hp,weak:[{dx,dy,r}]}], blocks:[{id,x,y,w,h}] }
   * @param angleDeg 発射角（0° = 真上、時計回り）
   * @param opts { shot: 'reflect'|'pierce', distance, maxBounces, record }
   */
  function simulate(scene, angleDeg, opts) {
    opts = opts || {};
    var shot = opts.shot === 'pierce' ? 'pierce' : 'reflect';
    var remaining = opts.distance != null ? opts.distance : scene.height * 6;
    var maxBounces = opts.maxBounces != null ? opts.maxBounces : 120;
    var record = opts.record !== false;

    var W = scene.width, H = scene.height;
    var r = scene.ball.r;
    var px = clamp(scene.ball.x, r, W - r);
    var py = clamp(scene.ball.y, r, H - r);
    var d = angleToDir(angleDeg);
    var dx = d.x, dy = d.y;

    var enemies = scene.enemies || [];
    var blocks = scene.blocks || [];

    var hits = {};
    var alive = {};
    for (var i = 0; i < enemies.length; i++) {
      hits[enemies[i].id] = { body: 0, weak: 0, defeated: false };
      alive[enemies[i].id] = true;
    }
    var inside = {};
    var path = record ? [{ x: px, y: py }] : null;
    var events = record ? [] : null;
    var wallHits = 0, blockHits = 0, bounces = 0, length = 0;
    var firstTarget = null;

    function registerBody(e, x, y) {
      var h = hits[e.id];
      h.body++;
      if (firstTarget === null) firstTarget = e.id;
      if (e.hp > 0 && h.body >= e.hp) { h.defeated = true; alive[e.id] = false; }
      if (events) events.push({ type: shot === 'pierce' ? 'pierce' : 'enemy', id: e.id, x: x, y: y, defeated: h.defeated });
    }

    while (remaining > EPS) {
      // --- このまま進んだ時に最初にぶつかる物を探す ---
      var bestT = Infinity, nx = 0, ny = 0, hitKind = null, hitEnemy = null, cornerWall = false;

      // 壁
      var tx = Infinity, ty = Infinity, wnx = 0, wny = 0;
      if (dx > EPS) { tx = (W - r - px) / dx; wnx = -1; }
      else if (dx < -EPS) { tx = (r - px) / dx; wnx = 1; }
      if (dy > EPS) { ty = (H - r - py) / dy; wny = -1; }
      else if (dy < -EPS) { ty = (r - py) / dy; wny = 1; }
      tx = Math.max(tx, 0); ty = Math.max(ty, 0);
      if (Math.abs(tx - ty) < 1e-6 && tx !== Infinity) {
        bestT = tx; cornerWall = true; hitKind = 'wall';
      } else if (tx < ty) {
        bestT = tx; nx = wnx; ny = 0; hitKind = 'wall';
      } else {
        bestT = ty; nx = 0; ny = wny; hitKind = 'wall';
      }

      // ブロック
      for (i = 0; i < blocks.length; i++) {
        var bh = rayBlock(px, py, dx, dy, blocks[i], r);
        if (bh && bh.t < bestT) {
          bestT = bh.t; nx = bh.nx; ny = bh.ny; hitKind = 'block'; cornerWall = false; hitEnemy = blocks[i];
        }
      }

      // 反射タイプは敵でも跳ね返る
      if (shot === 'reflect') {
        for (i = 0; i < enemies.length; i++) {
          var e = enemies[i];
          if (!alive[e.id]) continue;
          var eh = rayCircle(px, py, dx, dy, e.x, e.y, e.r + r);
          if (eh && eh.t1 > EPS && eh.t1 < bestT) {
            bestT = eh.t1; hitKind = 'enemy'; hitEnemy = e; cornerWall = false;
            var cxn = px + eh.t1 * dx - e.x, cyn = py + eh.t1 * dy - e.y;
            var ln = Math.hypot(cxn, cyn) || 1;
            nx = cxn / ln; ny = cyn / ln;
          }
        }
      }

      var willHit = bestT <= remaining + EPS;
      var segLen = Math.min(bestT, remaining);

      // --- この線分上での「すり抜けヒット」と弱点ヒット ---
      for (i = 0; i < enemies.length; i++) {
        var en = enemies[i];
        if (!alive[en.id]) continue;
        if (shot === 'pierce') {
          var pierceHit = rayCircle(px, py, dx, dy, en.x, en.y, en.r + r);
          if (trackEnter(inside, 'e' + en.id, px, py, dx, dy, segLen, en.x, en.y, en.r + r)) {
            registerBody(en, px + pierceHit.t1 * dx, py + pierceHit.t1 * dy);
          }
        }
        var weak = en.weak || [];
        for (var k = 0; k < weak.length; k++) {
          var wx = en.x + weak[k].dx, wy = en.y + weak[k].dy;
          if (trackEnter(inside, 'w' + en.id + '_' + k, px, py, dx, dy, segLen, wx, wy, weak[k].r + r)) {
            hits[en.id].weak++;
            if (events) events.push({ type: 'weak', id: en.id, x: wx, y: wy });
          }
        }
      }

      px += dx * segLen; py += dy * segLen;
      remaining -= segLen; length += segLen;
      if (path) path.push({ x: px, y: py });

      if (!willHit) break;
      if (bounces >= maxBounces) break;

      // --- 跳ね返り ---
      if (cornerWall) {
        dx = -dx; dy = -dy;
      } else {
        var dot = dx * nx + dy * ny;
        dx -= 2 * dot * nx; dy -= 2 * dot * ny;
        var dl = Math.hypot(dx, dy) || 1;
        dx /= dl; dy /= dl;
      }
      bounces++;
      if (hitKind === 'wall') {
        wallHits++;
        if (events) events.push({ type: 'wall', x: px, y: py });
      } else if (hitKind === 'block') {
        blockHits++;
        if (events) events.push({ type: 'block', id: hitEnemy.id, x: px, y: py });
      } else if (hitKind === 'enemy') {
        registerBody(hitEnemy, px, py);
      }
    }

    return {
      angle: normAngle(angleDeg),
      shot: shot,
      path: path,
      events: events,
      hits: hits,
      wallHits: wallHits,
      blockHits: blockHits,
      bounces: bounces,
      length: length,
      end: { x: px, y: py },
      firstTarget: firstTarget
    };
  }

  /** 狙いに応じた評価の重み。 */
  var PRIORITIES = {
    balance: { label: 'バランス', boss: 3, minion: 1, weak: 4, defeat: 2 },
    boss:    { label: 'ボス集中', boss: 5, minion: 0.2, weak: 3, defeat: 0 },
    weak:    { label: '弱点狙い', boss: 1, minion: 0.2, weak: 8, defeat: 0 },
    minion:  { label: '雑魚処理', boss: 0.5, minion: 2, weak: 0.5, defeat: 6 }
  };

  function summarize(scene, result) {
    var s = { boss: 0, minion: 0, weak: 0, defeated: 0, bossWeak: 0 };
    var enemies = scene.enemies || [];
    for (var i = 0; i < enemies.length; i++) {
      var e = enemies[i], h = result.hits[e.id];
      if (!h) continue;
      if (e.kind === 'boss') { s.boss += h.body; s.bossWeak += h.weak; }
      else s.minion += h.body;
      s.weak += h.weak;
      if (h.defeated && e.kind !== 'boss') s.defeated++;
    }
    return s;
  }

  function score(scene, result, weights) {
    var w = typeof weights === 'string' ? PRIORITIES[weights] : weights || PRIORITIES.balance;
    var s = summarize(scene, result);
    return s.boss * w.boss + s.minion * w.minion + s.weak * w.weak + s.defeated * w.defeat;
  }

  /**
   * 全方位を一定刻みで試し、手元のブレ（±tolerance°）を考慮した平均点で順位を付ける。
   */
  function sweep(scene, opts, cfg) {
    cfg = cfg || {};
    var step = cfg.step || 0.5;
    var tol = cfg.tolerance != null ? cfg.tolerance : 1;
    var priority = cfg.priority || 'balance';
    var top = cfg.top || 5;
    var minGap = cfg.minGap != null ? cfg.minGap : Math.max(3, tol * 2 + 1);
    var n = Math.round(360 / step);
    var simOpts = { shot: opts.shot, distance: opts.distance, maxBounces: opts.maxBounces, record: false };

    var raw = new Array(n);
    for (var i = 0; i < n; i++) raw[i] = score(scene, simulate(scene, i * step, simOpts), priority);

    var half = Math.round(tol / step);
    var smooth = new Array(n);
    var maxSmooth = 0;
    for (i = 0; i < n; i++) {
      var sum = 0, mn = Infinity;
      for (var j = -half; j <= half; j++) {
        var v = raw[(i + j + n) % n];
        sum += v;
        if (v < mn) mn = v;
      }
      // 平均点に「最悪でもこれだけは取れる」点を少し混ぜて、崖っぷちの角度を下げる
      smooth[i] = (sum / (2 * half + 1)) * 0.8 + mn * 0.2;
      if (smooth[i] > maxSmooth) maxSmooth = smooth[i];
    }

    var order = [];
    for (i = 0; i < n; i++) order.push(i);
    order.sort(function (a, b) { return smooth[b] - smooth[a] || raw[b] - raw[a]; });

    var picks = [];
    for (i = 0; i < order.length && picks.length < top; i++) {
      var idx = order[i];
      if (smooth[idx] <= 0) break;
      var a = idx * step, ok = true;
      for (j = 0; j < picks.length; j++) {
        var diff = Math.abs(picks[j].angle - a);
        if (Math.min(diff, 360 - diff) < minGap) { ok = false; break; }
      }
      if (ok) picks.push({ angle: a, score: raw[idx], stable: smooth[idx] });
    }

    return { step: step, raw: raw, smooth: smooth, max: maxSmooth, best: picks };
  }

  return {
    angleToDir: angleToDir,
    dirToAngle: dirToAngle,
    angleToClock: angleToClock,
    normAngle: normAngle,
    rayCircle: rayCircle,
    rayBlock: rayBlock,
    simulate: simulate,
    summarize: summarize,
    score: score,
    sweep: sweep,
    PRIORITIES: PRIORITIES
  };
});
