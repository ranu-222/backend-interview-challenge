import sqlite3 from 'sqlite3';
import { Task } from '../types';

const sqlite = sqlite3.verbose();

export class Database {
  private db: sqlite3.Database;

  constructor(filename: string = ':memory:') {
    this.db = new sqlite3.Database(filename);
  }

  async initialize(): Promise<void> {
    await this.createTables();
  }

  private async createTables(): Promise<void> {
    const createTasksTable = `
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        completed INTEGER DEFAULT 0,
        created_at INTEGER,
        updated_at INTEGER,
        is_deleted INTEGER DEFAULT 0,
        sync_status TEXT DEFAULT 'pending',
        server_id TEXT,
        last_synced_at INTEGER
      );
    `;

    const createSyncQueueTable = `
      CREATE TABLE IF NOT EXISTS sync_queue (
        queue_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        action TEXT NOT NULL,        -- create | update | delete
        updated_at INTEGER NOT NULL, -- timestamp
        status TEXT DEFAULT 'pending', -- pending | synced | error
        retry_count INTEGER DEFAULT 0,
        error_message TEXT
      );
    `;

    await this.run(createTasksTable);
    await this.run(createSyncQueueTable);
  }

  run(sql: string, params: any[] = []): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, (err) => err ? reject(err) : resolve());
    });
  }

  get(sql: string, params: any[] = []): Promise<any> {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
    });
  }

  all(sql: string, params: any[] = []): Promise<any[]> {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
    });
  }

  async insertTask(task: Task): Promise<void> {
    const sql = `
      INSERT INTO tasks
      (id, title, description, completed, created_at, updated_at, is_deleted, sync_status, server_id, last_synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    await this.run(sql, [
      task.id,
      task.title,
      task.description || "",
      task.completed ? 1 : 0,
      task.created_at ?? Date.now(),
      task.updated_at ?? Date.now(),
      task.is_deleted ? 1 : 0,
      task.sync_status,
      task.server_id,
      task.last_synced_at
    ]);
  }

  async getTask(id: string): Promise<Task | null> {
    const sql = `SELECT * FROM tasks WHERE id = ?`;
    const row = await this.get(sql, [id]);
    return row ? this.mapTask(row) : null;
  }

  async getAllTasks(): Promise<Task[]> {
    const sql = `SELECT * FROM tasks WHERE is_deleted = 0`;
    const rows = await this.all(sql);
    return rows.map(r => this.mapTask(r));
  }

  async updateTask(task: Task): Promise<void> {
    const sql = `
      UPDATE tasks
      SET title=?, description=?, completed=?, updated_at=?, is_deleted=?, sync_status=?, server_id=?, last_synced_at=?
      WHERE id = ?
    `;
    await this.run(sql, [
      task.title,
      task.description,
      task.completed ? 1 : 0,
      task.updated_at,
      task.is_deleted ? 1 : 0,
      task.sync_status,
      task.server_id,
      task.last_synced_at,
      task.id
    ]);
  }

  async addToSyncQueue(data: { id: string; action: string; updated_at: number }): Promise<void> {
    const sql = `
      INSERT INTO sync_queue (queue_id, task_id, action, updated_at, status)
      VALUES (?, ?, ?, ?, 'pending')
    `;
    const queueId = `${data.id}-${Date.now()}`; // unique event id
    await this.run(sql, [queueId, data.id, data.action, data.updated_at]);
  }

  async getTasksBySyncStatus(statuses: string[]): Promise<Task[]> {
    const sql = `
      SELECT * FROM tasks
      WHERE sync_status IN (${statuses.map(() => '?').join(',')})
      AND is_deleted = 0
    `;
    const rows = await this.all(sql, statuses);
    return rows.map(r => this.mapTask(r));
  }

  private mapTask(row: any): Task {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      completed: row.completed === 1,
      created_at: row.created_at,
      updated_at: row.updated_at,
      is_deleted: row.is_deleted === 1,
      sync_status: row.sync_status,
      server_id: row.server_id,
      last_synced_at: row.last_synced_at
    };
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.db.close((err) => err ? reject(err) : resolve());
    });
  }
}
