import type { CustomFieldDefinition, CustomFieldScope } from './customization';

/** Rich text is Markdown stored as text; renderers must never interpret raw HTML. */
export const CUSTOM_FIELD_TYPE_LABELS = {
  text: 'Texte simple (1 ligne)', rich_text: 'Texte riche', multi_select: 'Liste à choix multiples',
  select: 'Liste à choix simple', formula: 'Formule', image: 'Image', url: 'Lien web', number: 'Nombre', date: 'Date',
} as const;

export const FORMULA_BUILTINS: Record<CustomFieldScope, readonly { id: string; label: string }[]> = {
  project: [{ id: 'budget', label: 'Budget alloué (€)' }],
  task: [{ id: 'allocatedHours', label: 'Heures allouées' }, { id: 'progress', label: 'Avancement (%)' }],
  resource: [], report: [], 'time-entry': [{ id: 'hours', label: 'Heures saisies' }],
};

export function safeCustomFieldUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

export const CUSTOM_IMAGE_MAX_BYTES = 65_536;
const rasterMimeTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

/** Raster-only data URLs: bounded bytes and matching file signature, never SVG or HTML. */
export function customFieldImageSource(value: string): string | null {
  const webUrl = safeCustomFieldUrl(value);
  if (webUrl) return value.length <= 2000 ? webUrl : null;
  const match = value.match(/^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || match[2].length % 4 !== 0 || match[2].length > Math.ceil(CUSTOM_IMAGE_MAX_BYTES / 3) * 4) return null;
  try {
    const bytes = atob(match[2]);
    if (bytes.length > CUSTOM_IMAGE_MAX_BYTES || bytes.length < 12 || btoa(bytes) !== match[2]) return null;
    const code = (index: number) => bytes.charCodeAt(index);
    const mime = match[1];
    const valid = mime === rasterMimeTypes[0] ? [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => code(index) === byte)
      : mime === rasterMimeTypes[1] ? code(0) === 255 && code(1) === 216 && code(2) === 255
      : mime === rasterMimeTypes[2] ? ['GIF87a', 'GIF89a'].includes(bytes.slice(0, 6))
      : mime === rasterMimeTypes[3] ? bytes.startsWith('RIFF') && bytes.slice(8, 12) === 'WEBP' : false;
    return valid ? value : null;
  } catch { return null; }
}

export function parseMultipleChoices(value: string): string[] | null {
  if (!value) return [];
  try {
    const choices: unknown = JSON.parse(value);
    if (!Array.isArray(choices) || choices.length > 50 || choices.some(choice => typeof choice !== 'string')
      || new Set(choices).size !== choices.length) return null;
    return choices;
  } catch { return null; }
}

type Expression = { kind: 'number'; value: number } | { kind: 'reference'; id: string }
  | { kind: 'unary'; sign: 1 | -1; value: Expression }
  | { kind: 'binary'; operator: '+' | '-' | '*' | '/'; left: Expression; right: Expression };
type Token = { kind: 'number'; value: number } | { kind: 'reference'; id: string } | { kind: 'symbol'; value: string };

function parseFormula(expression: string): Expression {
  if (!expression.trim() || expression.length > 1000) throw new Error('La formule doit contenir entre 1 et 1 000 caractères.');
  const tokens: Token[] = [];
  for (let position = 0; position < expression.length;) {
    const remaining = expression.slice(position);
    if (/^\s/.test(remaining)) { position++; continue; }
    const number = remaining.match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
    if (number) {
      const value = Number(number[0]);
      if (!Number.isFinite(value)) throw new Error('La formule contient un nombre non fini.');
      tokens.push({ kind: 'number', value }); position += number[0].length;
    } else if (remaining[0] === '{') {
      const end = remaining.indexOf('}');
      const id = end > 0 ? remaining.slice(1, end).trim() : '';
      if (!id || id.length > 100 || /[{}]/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('Une référence de champ est invalide.');
      tokens.push({ kind: 'reference', id }); position += end + 1;
    } else if ('+-*/()'.includes(remaining[0])) { tokens.push({ kind: 'symbol', value: remaining[0] }); position++; }
    else throw new Error('Utilisez des nombres, des références entre accolades, +, −, ×, / et des parenthèses.');
    if (tokens.length > 256) throw new Error('La formule est trop complexe.');
  }
  let index = 0;
  let depth = 0;
  const symbol = (value: string) => tokens[index]?.kind === 'symbol' && (tokens[index] as { value: string }).value === value;
  function primary(): Expression {
    if (++depth > 32) throw new Error('La formule contient trop de niveaux de parenthèses.');
    try {
      if (symbol('+') || symbol('-')) { const sign = symbol('-') ? -1 : 1; index++; return { kind: 'unary', sign, value: primary() }; }
      const token = tokens[index++];
      if (token?.kind === 'number') return { kind: 'number', value: token.value };
      if (token?.kind === 'reference') return { kind: 'reference', id: token.id };
      if (token?.kind === 'symbol' && token.value === '(') {
        const value = addition();
        if (!symbol(')')) throw new Error('Une parenthèse fermante manque dans la formule.');
        index++; return value;
      }
      throw new Error('La formule attend un nombre ou une référence de champ.');
    } finally { depth--; }
  }
  function multiplication(): Expression {
    let left = primary();
    while (symbol('*') || symbol('/')) {
      const operator = (tokens[index++] as { value: '*' | '/' }).value;
      left = { kind: 'binary', operator, left, right: primary() };
    }
    return left;
  }
  function addition(): Expression {
    let left = multiplication();
    while (symbol('+') || symbol('-')) {
      const operator = (tokens[index++] as { value: '+' | '-' }).value;
      left = { kind: 'binary', operator, left, right: multiplication() };
    }
    return left;
  }
  const result = addition();
  if (index !== tokens.length) throw new Error('La formule contient une opération invalide.');
  return result;
}

export function formulaDependencies(expression: string): string[] {
  const ids = new Set<string>();
  function visit(node: Expression): void {
    if (node.kind === 'reference') ids.add(node.id);
    else if (node.kind === 'binary') { visit(node.left); visit(node.right); }
    else if (node.kind === 'unary') visit(node.value);
  }
  visit(parseFormula(expression));
  return [...ids];
}

/** Validate the entire prospective catalogue before applying an edit or deletion. */
export function validateFormulaDefinitions(definitions: CustomFieldDefinition[]): void {
  const byId = new Map(definitions.map(field => [field.id, field]));
  const visiting = new Set<string>();
  const complete = new Set<string>();
  function visit(field: CustomFieldDefinition): void {
    if (complete.has(field.id)) return;
    if (visiting.has(field.id)) throw new Error('Les formules ne peuvent pas créer de référence circulaire.');
    visiting.add(field.id);
    if (visiting.size > 100) throw new Error('Une formule ne peut pas dépendre de plus de 100 niveaux de calcul.');
    for (const id of formulaDependencies(field.formula ?? '')) {
      if (FORMULA_BUILTINS[field.scope].some(builtin => builtin.id === id)) continue;
      const dependency = byId.get(id);
      if (!dependency || dependency.scope !== field.scope || !['number', 'formula'].includes(dependency.type)) {
        throw new Error('Une formule doit référencer des champs numériques ou calculés des mêmes éléments concernés.');
      }
      if (dependency.type === 'formula') visit(dependency);
    }
    visiting.delete(field.id); complete.add(field.id);
  }
  for (const field of definitions) {
    if (field.type === 'formula') visit(field);
    else if (field.formula?.trim()) throw new Error('Seul un champ de type Formule peut contenir une expression de calcul.');
  }
}

export function evaluateCustomFormula(field: CustomFieldDefinition, definitions: CustomFieldDefinition[], values: Record<string, string>, builtins: Record<string, number> = {}): { value: number | null; error?: string } {
  const byId = new Map(definitions.map(definition => [definition.id, definition]));
  const visiting = new Set<string>();
  const cache = new Map<string, number>();
  function calculate(definition: CustomFieldDefinition): number {
    if (cache.has(definition.id)) return cache.get(definition.id)!;
    if (visiting.has(definition.id)) throw new Error('Référence circulaire.');
    visiting.add(definition.id);
    if (visiting.size > 100) throw new Error('La formule contient trop de niveaux de calcul.');
    const result = evaluate(parseFormula(definition.formula ?? ''), definition.scope);
    visiting.delete(definition.id); cache.set(definition.id, result);
    return result;
  }
  function reference(id: string, scope: CustomFieldScope): number {
    if (FORMULA_BUILTINS[scope].some(builtin => builtin.id === id)) {
      if (!Object.hasOwn(builtins, id) || !Number.isFinite(builtins[id])) throw new Error('La donnée numérique du projet ou de la tâche est indisponible.');
      return builtins[id];
    }
    const definition = byId.get(id);
    if (!definition || definition.scope !== scope) throw new Error('Un champ référencé est introuvable.');
    if (definition.type === 'formula') return calculate(definition);
    if (definition.type !== 'number') throw new Error('La référence doit désigner un champ numérique.');
    const value = values[id]?.trim();
    if (!value) throw new Error(`Renseignez « ${definition.translations.fr || definition.name} » pour calculer cette formule.`);
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw new Error('Un champ référencé ne contient pas de nombre valide.');
    return Number(value);
  }
  function evaluate(node: Expression, scope: CustomFieldScope): number {
    if (node.kind === 'number') return node.value;
    if (node.kind === 'reference') return reference(node.id, scope);
    if (node.kind === 'unary') return node.sign * evaluate(node.value, scope);
    const left = evaluate(node.left, scope); const right = evaluate(node.right, scope);
    if (node.operator === '/' && right === 0) throw new Error('Division par zéro.');
    const result = node.operator === '+' ? left + right : node.operator === '-' ? left - right : node.operator === '*' ? left * right : left / right;
    if (!Number.isFinite(result)) throw new Error('Le résultat du calcul dépasse les limites numériques.');
    return result;
  }
  try { return { value: calculate(field) }; }
  catch (error) { return { value: null, error: error instanceof Error ? error.message : 'Calcul indisponible.' }; }
}
