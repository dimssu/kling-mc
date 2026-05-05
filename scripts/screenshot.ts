import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = join(process.cwd(), "screenshots");

const PAGES: Array<{ path: string; name: string; viewport?: { width: number; height: number } }> = [
  { path: "/", name: "01-dashboard" },
  { path: "/create", name: "02-create-empty" },
  { path: "/library", name: "03-library-generations" },
  { path: "/usage", name: "04-usage" },
  { path: "/", name: "05-dashboard-mobile", viewport: { width: 390, height: 844 } },
  { path: "/create", name: "06-create-mobile", viewport: { width: 390, height: 844 } },
];

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  for (const p of PAGES) {
    const ctx = await browser.newContext({
      viewport: p.viewport ?? { width: 1440, height: 900 },
      deviceScaleFactor: 2,
      colorScheme: "dark",
    });
    const page = await ctx.newPage();
    const url = BASE + p.path;
    console.log(`→ ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(800);
    const file = join(OUT, `${p.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`  saved ${file}`);
    await ctx.close();
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
