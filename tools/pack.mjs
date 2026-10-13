// 배포용 묶음 만들기: site/ → dist/
//  - app.js 난독화, style.css 압축
//  - data.json → d.bin (XOR 로 섞은 뒤 base64). app.js 가 풀어서 쓴다.
//  - robots.txt / _headers 로 AI 수집·검색 노출을 막는다
import fs from 'node:fs';
import path from 'node:path';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { minify } from 'csso';

const SRC = 'site', OUT = 'dist';
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const KEY = 'kS-ELO::clan-rating';            // app.js 의 풀기 열쇠와 같아야 한다
const raw = Buffer.from(fs.readFileSync(path.join(SRC, 'data.json'), 'utf8'), 'utf8');
const k = Buffer.from(KEY, 'utf8');
for (let i = 0; i < raw.length; i++) raw[i] ^= k[i % k.length] ^ (i * 31 & 255);
fs.writeFileSync(path.join(OUT, 'd.bin'), raw.toString('base64'));

const js = fs.readFileSync(path.join(SRC, 'app.js'), 'utf8');
const ob = JavaScriptObfuscator.obfuscate(js, {
  compact: true, controlFlowFlattening: true, controlFlowFlatteningThreshold: 0.4,
  stringArray: true, stringArrayEncoding: ['base64'], stringArrayThreshold: 0.75,
  renameGlobals: false, selfDefending: false, deadCodeInjection: false, unicodeEscapeSequence: false,
});
fs.writeFileSync(path.join(OUT, 'app.js'), ob.getObfuscatedCode());
fs.writeFileSync(path.join(OUT, 'style.css'), minify(fs.readFileSync(path.join(SRC, 'style.css'), 'utf8')).css);

let html = fs.readFileSync(path.join(SRC, 'index.html'), 'utf8');
html = html.replace(/\n\s+/g, '\n');
fs.writeFileSync(path.join(OUT, 'index.html'), html);

fs.writeFileSync(path.join(OUT, 'robots.txt'), [
  'User-agent: GPTBot', 'Disallow: /', '',
  'User-agent: ChatGPT-User', 'Disallow: /', '',
  'User-agent: OAI-SearchBot', 'Disallow: /', '',
  'User-agent: ClaudeBot', 'Disallow: /', '',
  'User-agent: Claude-User', 'Disallow: /', '',
  'User-agent: Claude-SearchBot', 'Disallow: /', '',
  'User-agent: anthropic-ai', 'Disallow: /', '',
  'User-agent: CCBot', 'Disallow: /', '',
  'User-agent: Google-Extended', 'Disallow: /', '',
  'User-agent: PerplexityBot', 'Disallow: /', '',
  'User-agent: Perplexity-User', 'Disallow: /', '',
  'User-agent: Bytespider', 'Disallow: /', '',
  'User-agent: Applebot-Extended', 'Disallow: /', '',
  'User-agent: meta-externalagent', 'Disallow: /', '',
  'User-agent: *', 'Disallow: /', '',
].join('\n'));
fs.writeFileSync(path.join(OUT, '_headers'), [
  '/*',
  '  X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex, noai, noimageai',
  '  X-Frame-Options: DENY',
  '  Referrer-Policy: same-origin',
  '  X-Content-Type-Options: nosniff',
  '/d.bin',
  '  Cache-Control: no-cache',
].join('\n') + '\n');
console.log('dist 준비 완료:', fs.readdirSync(OUT).join(', '));
