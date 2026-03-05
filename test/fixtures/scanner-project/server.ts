import { validate } from "./utils/validate";
import { Database } from "./utils/db";
import type { Cacheable } from "./utils/types";

export class AppServer implements Cacheable {
  private db: Database;
  ttl = 3600;
  key = "server";

  constructor(db: Database) { this.db = db; }

  start() { console.log("started"); }

  toJSON() { return JSON.stringify({ ttl: this.ttl }); }
}

export function handleRequest(req: unknown) {
  const valid = validate(req);
  return { ok: valid };
}

export async function fetchData(url: string) {
  const res = await fetch(url);
  return res.json();
}

function complexHandler(items: unknown[]) {
  let total = 0;
  for (const item of items) {
    if (typeof item === "number") {
      if (item > 0) {
        for (let i = 0; i < item; i++) {
          if (i % 2 === 0) {
            total += i;
          } else {
            total -= 1;
          }
        }
      }
    } else if (typeof item === "string") {
      total += item.length;
    }
  }
  return total;
}

function internalHelper() {
  return 42;
}
