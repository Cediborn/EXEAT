import { getDb, closeDb } from '../db.js';
getDb();
console.log('Migrations applied.');
closeDb();
