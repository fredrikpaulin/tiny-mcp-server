export class Database {
  private path: string;
  constructor(path: string) { this.path = path; }
  query(sql: string) { return []; }
}

export const DB_VERSION = 1;
