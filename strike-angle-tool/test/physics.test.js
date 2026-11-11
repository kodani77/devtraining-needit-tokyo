// node --test strike-angle-tool/test/*.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../js/physics.js');

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

function scene(extra = {}) {
  return Object.assign({ width: 600, height: 800, ball: { x: 300, y: 700, r: 30 }, enemies: [], blocks: [] }, extra);
}

test('角度と方向ベクトルの変換（0°=真上、時計回り）', () => {
  near(P.angleToDir(0).y, -1);
  near(P.angleToDir(90).x, 1);
  near(P.angleToDir(180).y, 1);
  near(P.dirToAngle(-1, 0), 270);
  near(P.dirToAngle(1, -1), 45);
  assert.equal(P.angleToClock(0), '12時');
  assert.equal(P.angleToClock(45), '1時半');
  assert.equal(P.angleToClock(90), '3時');
  assert.equal(P.angleToClock(359), '12時');
});

test('真上に打つと天井で跳ね返り、まっすぐ戻ってくる', () => {
  const r = P.simulate(scene(), 0, { distance: 1000 });
  near(r.path[1].y, 30); // 天井 = ボール半径の位置で接触
  near(r.path[1].x, 300);
  assert.equal(r.wallHits, 1);
  near(r.length, 1000);
  near(r.end.y, 30 + (1000 - 670));
});

test('入射角 = 反射角（右壁で x 成分だけ反転）', () => {
  const r = P.simulate(scene(), 45, { distance: 500 });
  const [p0, p1, p2] = r.path;
  near(p1.x, 570);
  assert.ok(p2.x < p1.x && p2.y < p1.y, '左上へ進む');
  near((p1.x - p2.x) / (p1.y - p2.y), 1, 1e-9);
  near(p0.x, 300);
});

test('反射タイプはボスで跳ね返る / 貫通タイプはすり抜けて数える', () => {
  const s = scene({ enemies: [{ id: 1, kind: 'boss', x: 300, y: 300, r: 80, hp: 0, weak: [] }] });
  const ref = P.simulate(s, 0, { shot: 'reflect', distance: 300 });
  near(ref.path[1].y, 300 + 80 + 30); // 中心距離 R + r で接触
  assert.equal(ref.hits[1].body, 1);
  assert.equal(ref.firstTarget, 1);

  const pie = P.simulate(s, 0, { shot: 'pierce', distance: 1400 });
  // 上へ抜けて天井で跳ね返り、下へもう一度すり抜ける
  assert.equal(pie.hits[1].body, 2);
  assert.equal(pie.wallHits, 1);
});

test('ボールの太さも当たり判定に入る（中心が外れてもかすれば当たる）', () => {
  const s = scene({ enemies: [{ id: 1, kind: 'minion', x: 300 + 30 + 40 - 1, y: 300, r: 40, hp: 0, weak: [] }] });
  assert.equal(P.simulate(s, 0, { shot: 'pierce', distance: 600 }).hits[1].body, 1);
  s.enemies[0].x += 2; // 1 だけ外へずらすと当たらない
  assert.equal(P.simulate(s, 0, { shot: 'pierce', distance: 600 }).hits[1].body, 0);
});

test('ブロックは貫通タイプでも跳ね返す', () => {
  const s = scene({ blocks: [{ id: 'b', x: 250, y: 400, w: 100, h: 40 }] });
  const r = P.simulate(s, 0, { shot: 'pierce', distance: 400 });
  near(r.path[1].y, 440 + 30);
  assert.equal(r.blockHits, 1);
  assert.ok(r.end.y > r.path[1].y, '下へ戻る');
});

test('ブロックの角に当たると斜めに弾かれる', () => {
  // ブロックの左下角 (300, 440) をボールの右側でかすめる
  const s = scene({ ball: { x: 290, y: 700, r: 30 }, blocks: [{ id: 'b', x: 300, y: 400, w: 100, h: 40 }] });
  const r = P.simulate(s, 0, { distance: 400 });
  assert.equal(r.blockHits, 1);
  const p1 = r.path[1], p2 = r.path[2];
  assert.ok(p2.x < p1.x, '角で左へ弾かれる');
  near(Math.hypot(p1.x - 300, p1.y - 440), 30, 1e-6);
});

test('雑魚は設定回数で倒れ、以降は判定が消える', () => {
  const s = scene({ enemies: [{ id: 1, kind: 'minion', x: 300, y: 300, r: 40, hp: 1, weak: [] }] });
  const r = P.simulate(s, 0, { shot: 'reflect', distance: 3000 });
  assert.equal(r.hits[1].body, 1);
  assert.equal(r.hits[1].defeated, true);
  // 倒した後は真上の線を往復しても二度と当たらない
  assert.ok(r.wallHits >= 2);
});

test('弱点はボールが触れた瞬間だけ数える（跳ね返りで二重に数えない）', () => {
  const s = scene({ enemies: [{ id: 1, kind: 'boss', x: 300, y: 300, r: 80, hp: 0, weak: [{ dx: 0, dy: 70, r: 15 }] }] });
  const r = P.simulate(s, 0, { shot: 'reflect', distance: 500 });
  assert.equal(r.hits[1].body, 1);
  assert.equal(r.hits[1].weak, 1);
  const miss = P.simulate(s, 90, { shot: 'reflect', distance: 500 });
  assert.equal(miss.hits[1].weak, 0);
});

test('角の真ん中（四隅）に入ると来た方向へ返る', () => {
  const s = scene({ width: 600, height: 600, ball: { x: 300, y: 300, r: 30 } });
  const r = P.simulate(s, 45, { distance: Math.hypot(270, 270) + 100 });
  near(r.path[1].x, 570);
  near(r.path[1].y, 30);
  assert.ok(r.end.x < 570 && r.end.y > 30);
});

test('全方位検索はボスへ向く角度を上位に出す', () => {
  const s = scene({ enemies: [{ id: 1, kind: 'boss', x: 300, y: 200, r: 70, hp: 0, weak: [] }] });
  const sw = P.sweep(s, { shot: 'reflect', distance: 900 }, { step: 1, tolerance: 1, priority: 'boss', top: 3 });
  assert.equal(sw.raw.length, 360);
  assert.ok(sw.best.length > 0);
  const a = sw.best[0].angle;
  assert.ok(Math.min(a, 360 - a) < 25, `best=${a}`);
});
