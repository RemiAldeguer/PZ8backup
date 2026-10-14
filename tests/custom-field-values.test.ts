import assert from 'node:assert/strict';
import test from 'node:test';
import { customFieldImageSource, evaluateCustomFormula, formulaDependencies, parseMultipleChoices, safeCustomFieldUrl, validateFormulaDefinitions } from '../shared/custom-field-values.ts';
import type { CustomFieldDefinition } from '../shared/customization.ts';
import { customValuesInput, validCustomValue, validDefinitionOptions } from '../server/customization-validation.ts';

const definition = (id: string, type: CustomFieldDefinition['type'], overrides: Partial<CustomFieldDefinition> = {}): CustomFieldDefinition => ({
  id, name: id, scope: 'project', type, translations: { fr: '', en: '' }, options: [], ...overrides,
});
const formula = (expression: string, id = 'calculation', overrides: Partial<CustomFieldDefinition> = {}) => definition(id, 'formula', { formula: expression, ...overrides });
const raster = (mime: string, bytes: number[]) => `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
const png = raster('image/png', [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);

test('formulas implement arithmetic precedence, parentheses, signs and numeric references without executing source', () => {
  const amount = definition('amount', 'number');
  const first = formula('({budget} - {amount}) * 2', 'first');
  const second = formula('-{first} / 4 + 1e2 + .5', 'second');
  const catalogue = [amount, first, second];
  validateFormulaDefinitions(catalogue);
  assert.deepEqual(formulaDependencies('({budget} - {amount}) + {amount}'), ['budget', 'amount']);
  assert.equal(evaluateCustomFormula(second, catalogue, { amount: '12.5' }, { budget: 100 }).value, 56.75);
  assert.equal(evaluateCustomFormula(formula('2 + 3 * (5 - 1)'), [], {}).value, 14);
  assert.equal(evaluateCustomFormula(formula('-(2 + 3) * -2'), [], {}).value, 10);
  for (const expression of ['globalThis.process.exit()', 'Math.random()', '1; alert(1)', '{__proto__}', '2 ** 3', '2(3)', '1 +', '(1 + 2', '1 + 1e309']) {
    assert.throws(() => formulaDependencies(expression), Error, expression);
    assert.equal(evaluateCustomFormula(formula(expression), [], {}).value, null, expression);
  }
});

test('formula catalogue validation rejects cycles, missing fields, nonnumeric types and other scopes', () => {
  const amount = definition('amount', 'number');
  const first = formula('{amount}', 'first');
  const second = formula('{first} * 2', 'second');
  validateFormulaDefinitions([amount, first, second]);
  for (const catalogue of [
    [formula('{self}', 'self')], [formula('{second}', 'first'), formula('{first}', 'second')], [formula('{missing}')],
    [definition('text', 'text'), formula('{text}')], [definition('amount', 'number', { scope: 'task' }), first],
    [formula('{progress}')], [formula('')], [definition('amount', 'number', { formula: '2 + 2' })],
    [first, second],
  ]) assert.throws(() => validateFormulaDefinitions(catalogue), Error);
  validateFormulaDefinitions([formula('{allocatedHours} * {progress} / 100', 'task-progress', { scope: 'task' })]);
});

test('empty or unavailable formula operands and zero division show no fabricated number', () => {
  const amount = definition('amount', 'number');
  const calculated = formula('{budget} / {amount}');
  assert.equal(evaluateCustomFormula(calculated, [amount], {}, { budget: 100 }).value, null);
  assert.match(evaluateCustomFormula(calculated, [amount], {}, { budget: 100 }).error!, /Renseignez/);
  assert.match(evaluateCustomFormula(calculated, [amount], { amount: '0' }, { budget: 100 }).error!, /Division par zéro/);
  assert.equal(evaluateCustomFormula(calculated, [amount], { amount: 'NaN' }, { budget: 100 }).value, null);
  assert.equal(evaluateCustomFormula(calculated, [amount], { amount: '10' }).value, null);
  assert.equal(evaluateCustomFormula(formula('1e308 * 10'), [], {}).value, null);
  assert.throws(() => formulaDependencies('('.repeat(33) + '1' + ')'.repeat(33)), /trop de niveaux/);
});

test('multiple choices require unique configured string options and retain JSON-string storage', () => {
  const field = definition('choices', 'multi_select', { options: ['A', 'B'] });
  assert.equal(validDefinitionOptions(field), true);
  assert.equal(validDefinitionOptions({ ...field, options: [] }), false);
  assert.deepEqual(parseMultipleChoices('["A","B"]'), ['A', 'B']);
  assert.equal(validCustomValue(field, '["A","B"]'), true);
  assert.equal(validCustomValue(field, '[]'), true);
  for (const value of ['A', '{}', '[1]', '["A","A"]', '["C"]', '["__proto__"]']) assert.equal(validCustomValue(field, value), false, value);
  assert.equal(validCustomValue(definition('single', 'select', { options: ['A'] }), 'A'), true);
});

test('images accept bounded raster data or HTTP links and reject SVG, HTML, spoofed MIME and oversized files', () => {
  const field = definition('image', 'image');
  assert.equal(customFieldImageSource(png), png);
  assert.equal(validCustomValue(field, png), true);
  for (const [mime, bytes] of [
    ['image/jpeg', [255, 216, 255, 224, 0, 0, 0, 0, 0, 0, 0, 0]],
    ['image/gif', [...Buffer.from('GIF89a'), 0, 0, 0, 0, 0, 0]],
    ['image/webp', [...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WEBP')]],
  ] as const) assert.ok(customFieldImageSource(raster(mime, [...bytes])));
  assert.equal(customFieldImageSource('https://example.com/image.png'), 'https://example.com/image.png');
  const tooLarge = Buffer.alloc(65537); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(tooLarge);
  for (const value of ['javascript:alert(1)', 'file:///tmp/image.png', 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    raster('image/png', [...Buffer.from('<svg onload="alert(1)"></svg>')]), png.replace('image/png', 'image/jpeg'),
    `data:image/png;base64,${tooLarge.toString('base64')}`, `${png}\n`, 'data:image/png;base64,@@@=', 'data:text/html;base64,PHNjcmlwdD4=']) {
    assert.equal(customFieldImageSource(value), null, value.slice(0, 70));
    assert.equal(validCustomValue(field, value), false, value.slice(0, 70));
  }
  assert.equal(safeCustomFieldUrl('data:image/png;base64,AAA='), null);
});

test('typed values keep rich-text whitespace, bound ordinary text and prohibit persisted formula overrides', () => {
  const value = '  **Important**\n- Élément\n<script>alert(1)</script>\n  ';
  assert.equal(customValuesInput.parse({ rich: value }).rich, value);
  assert.equal(validCustomValue(definition('rich', 'rich_text'), value), true);
  assert.equal(validCustomValue(definition('text', 'text'), 'A'.repeat(10001)), false);
  assert.equal(validCustomValue(formula('1 + 2'), '3'), false);
  assert.equal(validCustomValue(formula('1 + 2'), ''), true);
  assert.equal(validCustomValue(definition('number', 'number'), '12.5'), true);
  assert.equal(validCustomValue(definition('date', 'date'), '2028-02-29'), true);
  assert.equal(validCustomValue(definition('url', 'url'), 'javascript:alert(1)'), false);
});
