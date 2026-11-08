import { readdirSync, readFileSync } from 'node:fs';
import { parseThemeCss } from '../src/core.js';

/** Approximate oklch L (first component) or hsl lightness, else null. */
function lightness(value) {
  if (typeof value !== 'string') return null;
  const ok = value.match(/oklch\(\s*([\d.]+)/i);
  if (ok) return Number(ok[1]);
  const hsl = value.match(/hsl\(\s*[\d.]+(?:deg)?\s+[\d.]+%\s+([\d.]+)%/i);
  if (hsl) return Number(hsl[1]) / 100;
  const hex = value.match(/^#([0-9a-f]{6})$/i);
  if (hex) {
    const n = parseInt(hex[1], 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return Math.round((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 * 1000) / 1000;
  }
  if (value.startsWith('#')) return null;
  return null;
}

const names = ['background', 'card', 'popover', 'muted', 'secondary', 'accent', 'input', 'sidebar'];
for (const file of readdirSync('./tests/fixtures').filter(f => f.endsWith('.css'))) {
  const parsed = parseThemeCss(readFileSync('./tests/fixtures/' + file, 'utf8'));
  console.log('\n== ' + file);
  for (const mode of ['light', 'dark']) {
    const rows = names.map(n => [n, lightness(parsed[mode]?.[n])]).filter(([, v]) => v !== null);
    rows.sort((a, b) => a[1] - b[1]);
    console.log('  ' + mode.padEnd(6) + rows.map(([n, v]) => `${n}=${v}`).join('  '));
  }
}
