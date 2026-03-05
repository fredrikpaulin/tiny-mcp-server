export interface Serializable {
  toJSON(): string;
}

export interface Cacheable extends Serializable {
  ttl: number;
  key: string;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";

export type RequestHandler = (req: Request) => Promise<Response>;
