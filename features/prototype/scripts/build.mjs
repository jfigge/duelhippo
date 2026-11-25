// Inlines fonts, CSS, three.js and the game into one offline file: dist/index.html
// That single file runs as-is in a browser, an Electron window or a mobile webview.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const read = p => readFileSync(new URL('../' + p, import.meta.url));
const font = (fam, file) =>
  `@font-face{font-family:'${fam}';font-style:normal;font-weight:400;font-display:swap;src:url(data:font/woff2;base64,${read(file).toString('base64')}) format('woff2')}`;
const safeJs = s => s.replace(/<\/script/gi, '<\\/script');
const block = (html, tag, content) => {
  const re = new RegExp(`<!--${tag}-->[\\s\\S]*?<!--/${tag}-->`);
  if (!re.test(html)) throw new Error('missing block ' + tag);
  return html.replace(re, () => content);
};

const src = read('src/index.html').toString();
// Hosted variant: three.js from cdnjs and fonts from Google, everything else inline.
{
  let web = block(src, 'CSS', `<style>${read('src/style.css')}</style>`);
  web = block(web, 'THREE', '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>');
  web = block(web, 'GAME', `<script>${safeJs(read('src/game.js').toString())}</script>`);
  mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
  writeFileSync(new URL('../dist/web.html', import.meta.url), web);
}
let html = src;
html = block(html, 'FONTS', `<style>${font('Press Start 2P', 'node_modules/@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff2')}${font('VT323', 'node_modules/@fontsource/vt323/files/vt323-latin-400-normal.woff2')}</style>`);
html = block(html, 'CSS', `<style>${read('src/style.css')}</style>`);
html = block(html, 'THREE', `<script>${safeJs(read('node_modules/three/build/three.min.js').toString())}</script>`);
html = block(html, 'GAME', `<script>${safeJs(read('src/game.js').toString())}</script>`);

mkdirSync(new URL('../dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('../dist/index.html', import.meta.url), html);
console.log(`dist/index.html  ${(html.length / 1024).toFixed(0)} KB`);
