/**
 * ToolTrace.ai Automation via Playwright
 * Automates: image upload → AI trace → Shadow Box → STL download
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const TOOLTRACE_URL = 'https://www.tooltrace.ai';
const MAX_RETRIES = 2;

/**
 * Process an image through ToolTrace.ai to generate an STL file.
 * @param {string} imagePath - Path to the input image
 * @param {string} outputDir - Directory to save the output STL
 * @returns {{ stlPath, success, error }}
 */
async function processImage(imagePath, outputDir) {
  const absImagePath = path.resolve(imagePath);
  const absOutputDir = path.resolve(outputDir);

  if (!fs.existsSync(absImagePath)) {
    return { stlPath: null, success: false, error: `Image not found: ${absImagePath}` };
  }

  // Ensure output directory exists
  if (!fs.existsSync(absOutputDir)) {
    fs.mkdirSync(absOutputDir, { recursive: true });
  }

  let lastError = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[TOOLTRACE] Attempt ${attempt}/${MAX_RETRIES}...`);
    try {
      const result = await runToolTrace(absImagePath, absOutputDir);
      return result;
    } catch (err) {
      lastError = err;
      console.error(`[TOOLTRACE] Attempt ${attempt} failed:`, err.message);
      if (attempt < MAX_RETRIES) {
        console.log('[TOOLTRACE] Retrying in 3s...');
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  }

  return {
    stlPath: null,
    success: false,
    error: lastError?.message || 'ToolTrace unavailable',
  };
}

async function runToolTrace(imagePath, outputDir) {
  let browser;
  try {
    console.log('[TOOLTRACE] Launching browser...');
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    page.setDefaultTimeout(60000);

    // Step 1: Navigate to ToolTrace
    console.log('[TOOLTRACE] Navigating to tooltrace.ai...');
    await page.goto(TOOLTRACE_URL, { waitUntil: 'networkidle' });

    // Step 2: Click Get Started
    // TODO: Selector may need updating based on live UI
    console.log('[TOOLTRACE] Clicking Get Started...');
    const getStartedBtn = page.locator('button:has-text("Get Started"), a:has-text("Get Started")');
    await getStartedBtn.first().click({ timeout: 15000 });
    await page.waitForTimeout(2000);

    // Step 3: Upload image
    // TODO: Selector may need updating based on live UI
    console.log(`[TOOLTRACE] Uploading image: ${imagePath}`);
    const fileInput = page.locator('input[type="file"]');
    await fileInput.first().setInputFiles(imagePath);

    // Step 4: Wait for AI tracing to complete
    // TODO: Selector may need updating — look for canvas, SVG outlines, or a completion indicator
    console.log('[TOOLTRACE] Waiting for AI tracing to complete...');
    await page.waitForFunction(() => {
      // Look for canvas element, SVG paths, or any "done" indicator
      const canvas = document.querySelector('canvas');
      const svgPaths = document.querySelectorAll('svg path');
      const doneIndicator = document.querySelector('[data-status="complete"], .trace-complete, .outline-ready');
      return (canvas && canvas.width > 0) || svgPaths.length > 2 || doneIndicator;
    }, { timeout: 60000, polling: 2000 });
    console.log('[TOOLTRACE] Tracing complete.');

    // Step 5: Select Shadow Box insert type
    // TODO: Selector may need updating based on live UI
    console.log('[TOOLTRACE] Selecting Shadow Box mode...');
    const shadowBoxOption = page.locator(
      'button:has-text("Shadow Box"), label:has-text("Shadow Box"), ' +
      '[data-type="shadow-box"], [value="shadow-box"], ' +
      'div:has-text("Shadow Box"):not(:has(div))'
    );
    await shadowBoxOption.first().click({ timeout: 15000 });
    await page.waitForTimeout(1000);

    // Step 6: Set foam thickness to 20mm
    // TODO: Selector may need updating based on live UI
    console.log('[TOOLTRACE] Setting thickness to 20mm...');
    const thicknessInput = page.locator(
      'input[name="thickness"], input[placeholder*="thickness"], ' +
      'input[type="number"][aria-label*="thickness"], input[type="range"]'
    );
    const thicknessEl = thicknessInput.first();
    await thicknessEl.fill('20');
    await page.waitForTimeout(500);

    // Step 7: Download/export STL
    // TODO: Selector may need updating based on live UI
    console.log('[TOOLTRACE] Clicking download/export...');
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.locator(
        'button:has-text("Download"), button:has-text("Export"), ' +
        'a:has-text("Download"), a:has-text("Export STL")'
      ).first().click(),
    ]);

    // Step 8: Save the downloaded STL
    const timestamp = Date.now();
    const stlFilename = `${timestamp}.stl`;
    const stlPath = path.join(outputDir, stlFilename);
    await download.saveAs(stlPath);
    console.log(`[TOOLTRACE] STL saved: ${stlPath}`);

    await browser.close();
    return { stlPath, success: true, error: null };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    throw err;
  }
}

module.exports = { processImage };
