import fs from 'node:fs';
import ts from 'typescript5';

const file = process.argv[2];
const text = fs.readFileSync(file, 'utf8');
const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

const prepared = new Map();
const edits = [];

const visit = (node) => {
  if (ts.isVariableStatement(node)) {
    const decl = node.declarationList.declarations[0];
    if (decl && ts.isIdentifier(decl.name) && decl.initializer && ts.isCallExpression(decl.initializer)) {
      const init = decl.initializer;
      if (ts.isPropertyAccessExpression(init.expression) && init.expression.name.text === 'prepare' && init.arguments.length === 1) {
        prepared.set(decl.name.text, init.arguments[0].getText(source));
        edits.push({ start: node.getStart(source), end: node.getEnd(), text: '' });
        return;
      }
    }
  }
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
    const method = node.expression.name.text;
    const target = node.expression.expression;
    if (['run', 'get', 'all'].includes(method) && ts.isIdentifier(target) && prepared.has(target.text)) {
      const sql = prepared.get(target.text);
      const args = node.arguments.map((a) => a.getText(source));
      edits.push({
        start: node.getStart(source),
        end: node.getEnd(),
        text: `await db.${method}(${sql}${args.length ? `, [${args.join(', ')}]` : ''})`,
      });
    }
  }
  ts.forEachChild(node, visit);
};
visit(source);

let out = text;
for (const edit of edits.sort((a, b) => b.start - a.start)) {
  out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
}
fs.writeFileSync(file, out);
console.log(`${prepared.size} requêtes préparées, ${edits.length} remplacements`);
