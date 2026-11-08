/**
 * The literal placeholder shown inside tweakcn's own "Import Custom CSS"
 * dialog (components/editor/css-import-dialog.tsx). Users copy and adapt it, so
 * it is a real paste shape: bare HSL triplets, oklch, hex, hsl(), comma rgb()
 * and comments all mixed in one block.
 */
import { parseThemeCss, buildOverrides } from '../src/core.js';

const placeholder = `:root {
  --background: 0 0% 100%;
  --foreground: oklch(0.52 0.13 144.17);
  --primary: #3e2723;
  --card: hsl(0 0% 100%);
  --muted: rgb(240, 240, 240);
  --border: #e5e7eb;
  --ring: 222.2 84% 4.9%;
  /* And more */
}
.dark {
  --background: 222.2 84% 4.9%;
  --foreground: hsl(37.50 36.36% 95.69%);
  --primary: rgb(46, 125, 50);
  --card: #1c1917;
  --muted: oklch(0.28 0.01 144);
  --border: hsl(20 5% 20%);
  --ring: 222.2 84% 50%;
  /* And more */
}`;

const parsed = parseThemeCss(placeholder);
const built = buildOverrides(parsed, {});
console.log('counts:', JSON.stringify(parsed.counts));
console.log('warnings:', JSON.stringify(parsed.warnings));
for (const k of ['background', 'foreground', 'primary', 'card', 'muted', 'border', 'ring']) {
  console.log('  ' + k.padEnd(12), 'light=' + String(parsed.light[k]).padEnd(28), 'dark=' + parsed.dark[k]);
}
console.log('tokens:', built.count);
const ok = parsed.counts.light === 7 && parsed.counts.dark === 7
  && parsed.warnings.length === 0 && built.count >= 100;
console.log(ok ? 'PLACEHOLDER FORMAT PASSES' : '*** FAILED ***');
process.exitCode = ok ? 0 : 1;
