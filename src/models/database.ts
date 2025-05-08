import { open, Database as SQLiteDatabase } from 'sqlite';
import sqlite3 from 'sqlite3';
import winston from 'winston';

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/app.log' }),
    new winston.transports.Console()
  ],
});

export interface Database {
  query: (text: string, params?: any[]) => Promise<any>;
  run: (text: string, params?: any[]) => Promise<void>;
  get: (text: string, params?: any[]) => Promise<any>;
  all: (text: string, params?: any[]) => Promise<any[]>;
}

export async function initializeDatabase(dbPath: string): Promise<Database> {
  const db: SQLiteDatabase = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  logger.info('Connected to SQLite database', { dbPath });

  try {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS Sessions (
        deviceId TEXT PRIMARY KEY,
        currentOrder TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
    `);

    await db.exec(`
      CREATE TABLE IF NOT EXISTS Orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        deviceId TEXT NOT NULL,
        items TEXT NOT NULL,
        total INTEGER NOT NULL,
        status TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
    `);

    logger.info('Database tables initialized', { tables: ['Sessions', 'Orders'] });
  } catch (err) {
    logger.error('Error initializing database', { error: err });
    throw err;
  }

  return {
    query: async (text: string, params: any[] = []) => {
      logger.debug('Executing query', { query: text, params });
      return db.all(text, params);
    },
    run: async (text: string, params: any[] = []) => {
      logger.debug('Executing run', { query: text, params });
      await db.run(text, params);
    },
    get: async (text: string, params: any[] = []) => {
      logger.debug('Executing get', { query: text, params });
      return db.get(text, params);
    },
    all: async (text: string, params: any[] = []) => {
      logger.debug('Executing all', { query: text, params });
      return db.all(text, params);
    },
  };
}