import sqlite3 from 'sqlite3';
import { open } from 'sqlite';


export interface OrderItem {
  itemId: number;
  name: string;
  price: number;
  quantity: number;
}


export async function initializeDatabase(dbFile: string = ':memory:') {
  const db = await open({
    filename: dbFile,
    driver: sqlite3.Database
  });

  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS Sessions (
      deviceId TEXT PRIMARY KEY,
      currentOrder TEXT,  -- JSON string of OrderItem[]
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  
  await db.exec(`
    CREATE TABLE IF NOT EXISTS Orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deviceId TEXT,
      items TEXT,  -- JSON string of OrderItem[]
      status TEXT CHECK(status IN ('placed', 'cancelled')),
      createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (deviceId) REFERENCES Sessions(deviceId)
    )
  `);

  
  async function cleanupOldSessions() {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await db.run(`
      DELETE FROM Sessions
      WHERE createdAt < ?
    `, twentyFourHoursAgo);
  }

  
  await cleanupOldSessions();

  
  setInterval(cleanupOldSessions, 60 * 60 * 1000);

  return db;
}

