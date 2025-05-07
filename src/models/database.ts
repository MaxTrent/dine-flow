import { open, Database as SQLiteDatabase } from 'sqlite';
import sqlite3 from 'sqlite3';

export async function initializeDatabase(dbPath: string): Promise<SQLiteDatabase> {
  try {
    const db = await open({
      filename: dbPath,
      driver: sqlite3.Database,
    });
    console.log(`Connected to database: ${dbPath}`);

    // Create Sessions table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS Sessions (
        deviceId TEXT PRIMARY KEY,
        currentOrder TEXT NOT NULL,
        createdAt TEXT NOT NULL
      )
    `);
    console.log('Sessions table created or already exists');

    // Create Orders table
    await db.exec(`
      CREATE TABLE IF NOT EXISTS Orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deviceId TEXT NOT NULL,
        items TEXT NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL
      )
    `);
    console.log('Orders table created or already exists');

    return db;
  } catch (err) {
    console.error('Error initializing database:', err);
    throw err;
  }
}