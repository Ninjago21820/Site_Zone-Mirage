/**
 * Codemod de migration vers la couche de données asynchrone (MySQL).
 *
 * Transforme `db.prepare(SQL).get(a, b)` en `await db.get(SQL, [a, b])`, puis
 * propage `async` / `await` dans tout le graphe d'appels jusqu'à stabilité.
 *
 * Usage : node scripts/codemod-async.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const ROOT = process.cwd();
const TARGETS = ['server'];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

const files = TARGETS.flatMap((dir) => walk(path.join(ROOT, dir)));
const state = new Map(files.map((file) => [file, fs.readFileSync(file, 'utf8')]));

function parse(file, text) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function applyEdits(file, edits) {
  const text = state.get(file);
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  for (const edit of sorted) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end ?? edit.start);
  state.set(file, out);
}

/* ------------------------------------------------------------------ *
 * Phase A — `db.prepare(...).get(...)` → `await db.get(sql, [params])`
 * ------------------------------------------------------------------ */

const DB_METHODS = new Set(['get', 'all', 'run', 'pluck']);

for (const file of files) {
  const text = state.get(file);
  const source = parse(file, text);
  const edits = [];
  const preparedVars = new Map();

  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer)) {
      const init = node.initializer;
      const callee = init.expression;
      if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'prepare' && ts.isIdentifier(callee.expression)) {
        if (init.arguments.length === 1) {
          preparedVars.set(node.name.getText(source), init.arguments[0].getText(source));
          edits.push({ start: node.getStart(source), end: node.getEnd(), text: '' });
        }
      }
    }

    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      const inner = node.expression.expression;

      // db.prepare(sql).method(args)
      if (DB_METHODS.has(method) && ts.isCallExpression(inner) &&
          ts.isPropertyAccessExpression(inner.expression) &&
          inner.expression.name.text === 'prepare' && ts.isIdentifier(inner.expression.expression)) {
        const sql = inner.arguments[0].getText(source);
        const args = node.arguments.map((argument) => argument.getText(source));
        const params = args.length ? `, [${args.join(', ')}]` : '';
        edits.push({ start: node.getStart(source), end: node.getEnd(), text: `await db.${method}(${sql}${params})` });
      }

      // prepared variable: stmt.method(args)
      if (DB_METHODS.has(method) && ts.isIdentifier(inner) && preparedVars.has(inner.text)) {
        const sql = preparedVars.get(inner.text);
        const args = node.arguments.map((argument) => argument.getText(source));
        const params = args.length ? `, [${args.join(', ')}]` : '';
        edits.push({ start: node.getStart(source), end: node.getEnd(), text: `await db.${method}(${sql}${params})` });
      }

      // db.exec(sql)
      if (method === 'exec' && ts.isIdentifier(inner) && inner.text === 'db') {
        edits.push({ start: node.getStart(source), end: node.getEnd(), text: `await db.exec(${node.arguments.map((a) => a.getText(source)).join(', ')})` });
      }
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
  applyEdits(file, edits);
}

/* ------------------------------------------------------------------ *
 * Phase B — propagation de async/await
 * ------------------------------------------------------------------ */

const SEED_ASYNC = new Set(['openDb', 'migrate', 'seedDemo', 'insertSnapshot']);

function fnName(node, source) {
  if (!node) return null;
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) return node.name.text;
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
    return node.parent.name.text;
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name.text;
  void source;
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

let rounds = 0;
for (;;) {
  rounds += 1;
  if (rounds > 15) {
    console.log('limite de passes atteinte');
    break;
  }
  // Nouvelle compilation sur l'état courant.
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowJs: false,
    skipLibCheck: true,
    noEmit: true,
    strict: false,
  });
  const checker = program.getTypeChecker();
  let changed = 0;

  const asyncKeys = new Set(SEED_ASYNC);
  const collect = (file) => {
    const source = program.getSourceFile(file);
    if (!source) return;
    const visit = (node) => {
      if (ts.isFunctionLike(node)) {
        let hasAwait = false;
        const scan = (child) => {
          if (child !== node && ts.isFunctionLike(child)) return;
          if (ts.isAwaitExpression(child)) hasAwait = true;
          ts.forEachChild(child, scan);
        };
        scan(node);
        const name = fnName(node, source);
        if (name && (hasAwait || (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword))) {
          asyncKeys.add(name);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  };
  files.forEach(collect);

  for (const file of files) {
    const source = program.getSourceFile(file);
    if (!source) continue;
    const text = state.get(file);
    const edits = [];
    const marked = new Set();

    const markAsync = (fn) => {
      if (!fn) return;
      const modifiers = ts.getModifiers(fn) ?? [];
      if (modifiers.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)) return;
      if (marked.has(fn.getStart(source))) return;
      marked.add(fn.getStart(source));
      if (ts.isFunctionDeclaration(fn) || ts.isFunctionExpression(fn)) {
        edits.push({ start: fn.getStart(source), text: 'async ' });
      } else if (ts.isArrowFunction(fn)) {
        edits.push({ start: fn.getStart(source), text: 'async ' });
      } else {
        edits.push({ start: fn.getStart(source), text: 'async ' });
      }
    };

    const visit = (node) => {
      if (ts.isAwaitExpression(node)) {
        markAsync(containingFunction(node));
      }
      if (ts.isCallExpression(node) && node.expression) {
        let declaration = null;
        try {
          const signature = checker.getResolvedSignature(node);
          declaration = signature?.declaration ?? null;
        } catch {
          declaration = null;
        }
        const name = declaration ? fnName(declaration, source) : null;
        const calleeName = ts.isIdentifier(node.expression) ? node.expression.text : null;
        const isAsyncCallee = (name && asyncKeys.has(name)) || (calleeName && SEED_ASYNC.has(calleeName));
        if (isAsyncCallee && !(ts.isAwaitExpression(node.parent))) {
          edits.push({ start: node.getStart(source), text: 'await ' });
          markAsync(containingFunction(node));
          changed += 1;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);

    // Dédoublonne les insertions au même point.
    const unique = new Map();
    for (const edit of edits) {
      if (!unique.has(edit.start)) unique.set(edit.start, edit);
    }
    if (unique.size) {
      changed += unique.size;
      applyEdits(file, [...unique.values()]);
    }
    void text;
  }

  console.log(`passe ${rounds} — ${changed} modifications`);
  if (changed === 0) break;
}

for (const [file, text] of state) {
  fs.writeFileSync(file, text);
}
console.log(`${files.length} fichiers réécrits`);
