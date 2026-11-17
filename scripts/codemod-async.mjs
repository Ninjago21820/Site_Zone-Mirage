/**
 * Codemod de migration vers la couche de données asynchrone (MySQL).
 *
 * 1. `db.prepare(SQL).get(a, b)` → `await db.get(SQL, [a, b])`
 * 2. propagation de `async` / `await` dans le graphe d'appels jusqu'à stabilité.
 *
 * L'idempotence est garantie en relisant le texte avant chaque insertion
 * (`async` / `await` déjà présents) : le codemod peut être relancé sans risque.
 *
 * Usage : node scripts/codemod-async.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript5';

const ROOT = process.cwd();
const TARGET_DIRS = process.argv.includes('--tests') ? ['tests'] : ['server'];
const DRY = process.argv.includes('--dry');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const files = TARGET_DIRS.flatMap((dir) => walk(path.join(ROOT, dir)));
const state = new Map(files.map((file) => [file, fs.readFileSync(file, 'utf8')]));

const parse = (file, text) => ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

function applyEdits(file, edits) {
  const text = state.get(file);
  let out = text;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end ?? edit.start);
  }
  state.set(file, out);
}

const DB_METHODS = new Set(['get', 'all', 'run', 'pluck']);

/* ------------------------------- Phase A ------------------------------- */

for (const file of files) {
  const source = parse(file, state.get(file));
  const edits = [];
  const preparedVars = new Map();

  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isCallExpression(node.initializer)) {
      const init = node.initializer;
      const callee = init.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'prepare' && init.arguments.length === 1) {
        preparedVars.set(node.name.text, init.arguments[0].getText(source));
        edits.push({ start: node.getStart(source), end: node.getEnd(), text: '' });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  applyEdits(file, edits);

  const source2 = parse(file, state.get(file));
  const edits2 = [];
  const visit2 = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && DB_METHODS.has(node.expression.name.text)) {
      const method = node.expression.name.text;
      const inner = node.expression.expression;
      const args = node.arguments.map((argument) => argument.getText(source2));
      const params = args.length ? `, [${args.join(', ')}]` : '';
      const receiver = ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression)
        ? inner.expression.expression.getText(source2)
        : '';
      if (ts.isCallExpression(inner) && ts.isPropertyAccessExpression(inner.expression) &&
          inner.expression.name.text === 'prepare' && inner.arguments.length === 1) {
        const sql = inner.arguments[0].getText(source2);
        edits2.push({ start: node.getStart(source2), end: node.getEnd(), text: `await ${receiver}.${method}(${sql}${params})` });
      } else if (ts.isIdentifier(inner) && preparedVars.has(inner.text)) {
        edits2.push({ start: node.getStart(source2), end: node.getEnd(), text: `await db.${method}(${preparedVars.get(inner.text)}${params})` });
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'exec' && ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === 'db') {
      const args = node.arguments.map((argument) => argument.getText(source2));
      edits2.push({ start: node.getStart(source2), end: node.getEnd(), text: `await db.exec(${args.join(', ')})` });
    }
    ts.forEachChild(node, visit2);
  };
  visit2(source2);
  applyEdits(file, edits2);
}

// On écrit la phase A sur disque avant la phase B : les passes suivantes
// analysent l'AST réellement à jour (sinon les offsets dérivent).
if (!DRY) for (const [file, text] of state) fs.writeFileSync(file, text);

/* ------------------------------- Phase B ------------------------------- */

const SEED_ASYNC = new Set(['openDb', 'migrate', 'seedDemo', 'insertSnapshot']);

function fnName(node) {
  if (!node) return null;
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
    return node.parent.name.text;
  }
  if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) return node.name.text;
  return null;
}

function containingFunction(node) {
  let current = node.parent;
  while (current) {
    if (ts.isFunctionLike(current)) return current;
    current = current.parent;
  }
  return null;
}

function isAsync(fn, source, text) {
  const modifiers = ts.canHaveModifiers(fn) ? (ts.getModifiers(fn) ?? []) : (fn.modifiers ?? []);
  if (modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.AsyncKeyword)) return true;
  const start = fn.getStart(source);
  return /async\s*$/.test(text.slice(Math.max(0, start - 24), start));
}

let total = 0;
for (let round = 1; round <= 40; round += 1) {
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    noEmit: true,
    strict: false,
    allowJs: false,
  });
  const checker = program.getTypeChecker();

  const asyncKeys = new Set(SEED_ASYNC);
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) continue;
    const visit = (node) => {
      if (ts.isFunctionLike(node) && fnName(node) && isAsync(node, source, state.get(file))) asyncKeys.add(fnName(node));
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  let changed = 0;
  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) continue;
    const text = state.get(file);
    const edits = new Map();

    const addEdit = (start, value) => {
      if (!edits.has(start)) edits.set(start, { start, text: value });
    };

    const markAsync = (fn) => {
      if (!fn) return;
      if (isAsync(fn, source, text)) return;
      addEdit(fn.getStart(source), 'async ');
    };

    const visit = (node) => {
      if (ts.isAwaitExpression(node)) markAsync(containingFunction(node));

      if (ts.isCallExpression(node)) {
        const start = node.getStart(source);
        const before = text.slice(Math.max(0, start - 12), start);
        const alreadyAwaited = ts.isAwaitExpression(node.parent) || /await\s*$/.test(before);
        let declaration = null;
        try {
          declaration = checker.getResolvedSignature(node)?.declaration ?? null;
        } catch {
          declaration = null;
        }
        const name = fnName(declaration);
        const callee = ts.isIdentifier(node.expression) ? node.expression.text : null;
        const asyncCallee = (name && asyncKeys.has(name)) || (callee && SEED_ASYNC.has(callee));
        if (asyncCallee && !alreadyAwaited) {
          addEdit(start, 'await ');
          markAsync(containingFunction(node));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    if (edits.size) {
      changed += edits.size;
      if (!DRY) applyEdits(file, [...edits.values()]);
    }
  }

  total += changed;
  console.log(`passe ${round} — ${changed} modifications`);
  if (!DRY && changed > 0) {
    // Le programme TypeScript se relit depuis le disque : on y écrit l'état
    // intermédiaire pour que chaque passe analyse réellement le code courant.
    for (const [file, text] of state) fs.writeFileSync(file, text);
  }
  if (changed === 0 || DRY) break;
}

if (!DRY) {
  for (const [file, text] of state) fs.writeFileSync(file, text);
}
console.log(`${files.length} fichiers, ${total} modifications`);
