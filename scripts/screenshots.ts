/**
 * `npm run screenshots`: boot the showcase demo and capture the README screenshots into
 * docs/screenshots/ (palette PNGs). Deterministic: fixed viewport, time zone, clock and log
 * timestamps; fonts loaded; animations off.
 *
 *   npm run screenshots                  build first, then capture
 *   npm run screenshots -- --no-build    reuse dist/
 *
 * Uses Playwright's Chromium, or the browser in CHROMIUM_PATH (e.g. /usr/bin/chromium).
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContextOptions, type Page } from 'playwright';
import sharp from 'sharp';
import { startDemo } from './demo.js';

const OUT = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
/** Every screenshot shows this moment (log timestamps, "now"). */
const NOW = Date.UTC(2026, 9, 14, 9, 30, 0);
const PORT = Number(process.env.DEMO_PORT ?? 8099);

const NO_MOTION = `*, *::before, *::after {
  transition: none !important; animation: none !important; caret-color: transparent !important;
}`;

interface Shot {
  name: string;
  hash: string;
  dark?: boolean;
  phone?: boolean;
  /** Extra steps after the page settled. */
  act?: (page: Page) => Promise<void>;
}

const SHOTS: Shot[] = [
  { name: 'apps-light', hash: '#/graph/apps' },
  { name: 'apps-dark', hash: '#/graph/apps', dark: true },
  {
    name: 'focus',
    hash: '#/graph/apps/n/sonarr',
    act: async (p) => {
      await p.keyboard.press('f');
      await p.waitForTimeout(2500);
    },
  },
  { name: 'infra', hash: '#/graph/infra' },
  {
    name: 'logs',
    hash: '#/graph/apps/n/jellyfin',
    dark: true,
    act: async (p) => {
      await p.getByRole('tab', { name: 'Logs' }).click();
      await p.getByText('apikey=[redacted]').first().waitFor({ timeout: 10_000 });
    },
  },
  {
    name: 'health',
    hash: '#/graph/apps/n/sonarr',
    act: async (p) => {
      await p.getByRole('tab', { name: 'Health' }).click();
      await p.waitForTimeout(400);
    },
  },
  { name: 'entities', hash: '#/entities' },
  {
    name: 'search',
    hash: '#/graph/apps',
    act: async (p) => {
      await p.keyboard.press('Control+k');
      await p.keyboard.type('media', { delay: 20 });
      await p.waitForTimeout(400);
    },
  },
  { name: 'wiki-home', hash: '#/wiki' },
  { name: 'wiki-stack', hash: '#/wiki/media' },
  { name: 'wiki-app', hash: '#/wiki/sonarr', dark: true },
  { name: 'phone', hash: '#/graph/apps', phone: true, dark: true },
  { name: 'phone-wiki', hash: '#/wiki/sonarr', phone: true },
];

async function capture(build: boolean) {
  mkdirSync(OUT, { recursive: true });
  const demo = await startDemo({ build, port: PORT, liveLogs: false, now: () => NOW, quiet: true });
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    // Software rendering with fixed colour and text settings, so pixels do not vary run to run.
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--force-color-profile=srgb',
      '--font-render-hinting=none',
      '--disable-lcd-text',
      '--disable-font-subpixel-positioning',
    ],
  });
  const errors: string[] = [];
  try {
    for (const shot of SHOTS) {
      const options: BrowserContextOptions = {
        viewport: shot.phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        deviceScaleFactor: shot.phone ? 2 : 1,
        isMobile: shot.phone ?? false,
        hasTouch: shot.phone ?? false,
        colorScheme: shot.dark ? 'dark' : 'light',
        timezoneId: 'UTC',
        locale: 'en-GB',
        reducedMotion: 'reduce',
        // Only so the no-animation style below can be injected; the app's CSP stays strict.
        bypassCSP: true,
      };
      const context = await browser.newContext(options);
      await context.clock.setFixedTime(NOW);
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(`${shot.name}: ${e.message}`));
      await page.goto(new URL(shot.hash, demo.url).href);
      await page.addStyleTag({ content: NO_MOTION });
      await page.evaluate(() => document.fonts.ready);
      // Graph layout runs in a worker; give it and the first fit time to settle.
      await page.waitForTimeout(shot.hash.startsWith('#/graph') ? 2500 : 1200);
      await shot.act?.(page);
      const png = await page.screenshot({ type: 'png' });
      await sharp(png)
        .png({ palette: true, quality: 90, effort: 10, compressionLevel: 9, dither: 0 })
        .toFile(`${OUT}${shot.name}.png`);
      process.stdout.write(`docs/screenshots/${shot.name}.png\n`);
      await context.close();
    }
  } finally {
    await browser.close();
    await demo.stop();
  }
  if (errors.length > 0) throw new Error(`page errors:\n${errors.join('\n')}`);
}

await capture(!process.argv.includes('--no-build'));
