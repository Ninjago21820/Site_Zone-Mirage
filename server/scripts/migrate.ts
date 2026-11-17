#!/usr/bin/env node
/** Applique le schéma sur la base configurée (idempotent). `npm run db:migrate`. */
import { openDb } from '../db.js';

const db = await openDb();
const tables = await db.tableNames();
console.log(`Schéma appliqué (${db.dialect}) : ${tables.length} tables.`);
await db.close();
