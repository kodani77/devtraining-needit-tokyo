#!/usr/bin/env node
/*
 * スマホに入れて単体で使える 1 ファイル版を作る。
 *   node strike-angle-tool/build-standalone.js
 * → strike-angle-tool/dist/shot-angle-board.html
 *
 * CSS と JS をすべて HTML に埋め込むので、サーバーもネットも不要（フォントだけは
 * 通信できる時に読み込み、オフラインでは端末のフォントで表示する）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

function inlineScript(src) {
  const code = read(src);
  if (/<\/script/i.test(code)) throw new Error(src + ' に </script が含まれていて埋め込めません');
  return '<script>\n' + code + '\n</script>';
}

let html = read('index.html');

const replacements = [
  ['<link rel="stylesheet" href="css/style.css">', () => '<style>\n' + read('css/style.css') + '\n</style>'],
  ['<script src="js/physics.js"></script>', () => inlineScript('js/physics.js')],
  ['<script src="js/app.js"></script>', () => inlineScript('js/app.js')]
];
for (const [needle, make] of replacements) {
  if (!html.includes(needle)) throw new Error('index.html に ' + needle + ' が見つかりません');
  html = html.replace(needle, make);
}

// ホーム画面に追加した時にアプリらしく見せる設定とアイコン
const icon =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1a2130"/>' +
    '<circle cx="32" cy="32" r="21" fill="none" stroke="#ffcf3a" stroke-width="4"/>' +
    '<path d="M32 32 L48 16" stroke="#ffcf3a" stroke-width="5" stroke-linecap="round"/>' +
    '<circle cx="32" cy="32" r="6" fill="#5aa8ff"/></svg>'
  );
const headExtra = [
  '<meta name="theme-color" content="#1a2130">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-title" content="角度ボード">',
  '<link rel="icon" href="' + icon + '">',
  '<link rel="apple-touch-icon" href="' + icon + '">'
].join('\n');
html = html.replace('<title>', headExtra + '\n<title>');

const outDir = path.join(root, 'dist');
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'shot-angle-board.html');
fs.writeFileSync(out, html);
console.log('wrote ' + path.relative(process.cwd(), out) + ' (' + Math.round(html.length / 1024) + ' KB)');
