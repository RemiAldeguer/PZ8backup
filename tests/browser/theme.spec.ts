import { test, expect } from '@playwright/test';
import { loginTestAdmin } from '../auth-fixture';

test('le thème reste lisible, se mémorise et accompagne les vues et fenêtres', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const appearance = page.getByRole('combobox', { name: 'Thème de l’application', exact: true });
  await expect(appearance).toHaveValue('system');
  await appearance.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('.auth-page')).toHaveCSS('background-color', 'rgb(23, 33, 49)');
  await loginTestAdmin(page.request);
  await page.goto('/#project/project-nova/summary');
  await page.reload();
  await expect(page.locator('.app-shell')).toBeVisible();
  await expect(appearance).toHaveValue('dark');
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('14px Inter'))).toBe(true);
  await expect(page.locator('body')).toHaveCSS('font-family', /Inter/);
  // Measure the actual inherited palette, rather than inspecting stylesheet text.
  const contrast = await page.evaluate(() => {
    const sample = document.createElement('span');
    document.body.append(sample);
    function channels(value: string) { return value.match(/[\d.]+/g)!.slice(0, 3).map(Number); }
    function luminance(c: number[]) { const values = c.map(n => { const x = n / 255; return x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4; }); return values[0] * .2126 + values[1] * .7152 + values[2] * .0722; }
    sample.style.background = 'var(--surface)'; sample.style.color = 'var(--muted)';
    const style = getComputedStyle(sample), a = luminance(channels(style.color)), b = luminance(channels(style.backgroundColor));
    const flash = getComputedStyle(document.querySelector('.psr-flash')!);
    const flashText = luminance(channels(flash.color)), flashBackground = luminance(channels(flash.backgroundColor));
    sample.remove();
    return {
      muted: (Math.max(a, b) + .05) / (Math.min(a, b) + .05),
      flash: (Math.max(flashText, flashBackground) + .05) / (Math.min(flashText, flashBackground) + .05),
    };
  });
  expect(contrast.muted).toBeGreaterThanOrEqual(4.5);
  expect(contrast.flash).toBeGreaterThanOrEqual(4.5);
  await page.screenshot({ path: test.info().outputPath('summary-dark.png'), fullPage: true });
  for (const tab of ['list', 'gantt', 'budget', 'time']) {
    await page.goto('/#project/project-nova/' + tab);
    await expect(page.locator('.app-shell')).toBeVisible();
    await expect(page.locator('.topbar')).toHaveCSS('background-color', 'rgb(23, 33, 49)');
  }
  await page.goto('/#project/project-nova/gantt');
  await expect(page.locator('.pzg-scroll')).toBeVisible();
  await expect(page.locator('.pzg-scroll')).toHaveCSS('background-color', 'rgb(23, 33, 49)');
  await page.screenshot({ path: test.info().outputPath('gantt-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Paramètres du projet', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('dialog-dark.png'), fullPage: true });
  await page.getByRole('dialog').getByRole('button', { name: 'Annuler', exact: true }).click();
  await appearance.selectOption('light');
  await page.reload();
  await expect(appearance).toHaveValue('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('.topbar')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.goto('/#project/project-nova/summary');
  await page.screenshot({ path: test.info().outputPath('summary-light.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(appearance).toBeVisible();
  await appearance.selectOption('dark');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('mobile-dark.png'), fullPage: true });
  expect(errors).toEqual([]);
});

test('automatique suit le système et un stockage indisponible laisse changer de thème', async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => { throw new Error('Storage blocked by test'); };
    Storage.prototype.setItem = () => { throw new Error('Storage blocked by test'); };
  });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const appearance = page.getByRole('combobox', { name: 'Thème de l’application', exact: true });
  await expect(appearance).toHaveValue('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await appearance.selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await appearance.selectOption('system');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
