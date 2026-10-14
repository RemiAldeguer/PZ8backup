import { test, expect } from '@playwright/test';
import { loginTestAdmin } from '../auth-fixture';

test('Gantt : zoom visible, point central conservé, retour à 100 %, bornes et affichage mobile', async ({ page, request }) => {
  await loginTestAdmin(page.request); await loginTestAdmin(request);
  const before = await (await request.get('/api/state')).json();
  await page.goto('/#project/project-nova/gantt');
  const zoom = page.getByRole('group', { name: 'Zoom du Gantt', exact: true }); await expect(zoom).toBeVisible();
  const more = zoom.getByRole('button', { name: 'Zoom avant du Gantt', exact: true }); const less = zoom.getByRole('button', { name: 'Zoom arrière du Gantt', exact: true }); const reset = zoom.getByRole('button', { name: 'Réinitialiser le zoom du Gantt à 100 %', exact: true });
  const metrics = () => page.locator('.pzg-scroll').evaluate(el => ({ width: parseFloat((el as HTMLElement).style.getPropertyValue('--pzg-track-width')), offset: Math.max(0, el.clientWidth - parseFloat((el as HTMLElement).style.getPropertyValue('--pzg-label-width'))) / 2, left: el.scrollLeft }));
  await page.locator('.pzg-scroll').evaluate(el => { el.scrollLeft = 420; }); const initial = await metrics();
  await more.click(); await expect(reset).toHaveText('125 %'); const enlarged = await metrics(); expect(enlarged.width / initial.width).toBeCloseTo(1.25, 2); expect((enlarged.left + enlarged.offset) / enlarged.width).toBeCloseTo((initial.left + initial.offset) / initial.width, 2);
  await reset.click(); await expect(reset).toHaveText('100 %'); await expect(reset).toBeDisabled();
  for (let i = 0; i < 3; i++) await less.click(); await expect(reset).toHaveText('25 %'); await expect(less).toBeDisabled();
  await reset.click(); for (let i = 0; i < 12; i++) await more.click(); await expect(reset).toHaveText('400 %'); await expect(more).toBeDisabled();
  await reset.click(); await page.setViewportSize({ width: 390, height: 844 }); await expect(zoom).toBeVisible(); await expect(more).toBeInViewport(); await expect(less).toBeInViewport(); await more.click(); await expect(reset).toHaveText('125 %');
  const after = await (await request.get('/api/state')).json(); expect(after).toEqual(before);
});
