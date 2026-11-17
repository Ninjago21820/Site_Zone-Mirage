import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript5';

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []);

for (const file of walk('server')) {
  const text = fs.readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const edits = [];

  const visit = (node) => {
    if (ts.isFunctionLike(node)) {
      const modifiers = ts.canHaveModifiers(node) ? (ts.getModifiers(node) ?? []) : (node.modifiers ?? []);
      const isAsync = modifiers.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);
      if (isAsync && node.type && !/^Promise\s*</.test(node.type.getText(source))) {
        edits.push({ start: node.type.getStart(source), end: node.type.getEnd(), text: `Promise<${node.type.getText(source)}>` });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (!edits.length) continue;
  let out = text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  }
  fs.writeFileSync(file, out);
  console.log(`${file}: ${edits.length} signature(s)`);
}
