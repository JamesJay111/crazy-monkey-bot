import Database from 'better-sqlite3';
import { logger } from '../utils/logger';
import * as fs from 'fs';
import * as path from 'path';

export function initDatabase(dbPath: string): Database.Database {
  // 确保目录存在
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new Database(dbPath);
  
  // 读取并执行初始化 SQL
  const initSqlPath = path.join(__dirname, '../../db/init.sql');
  const initSql = fs.readFileSync(initSqlPath, 'utf-8');
  
  db.exec(initSql);
  
  logger.info({ dbPath }, 'Database initialized');
  
  return db;
}

