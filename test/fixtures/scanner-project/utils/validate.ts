export function validate(input: unknown): boolean {
  return input !== null && input !== undefined;
}

export function sanitize(str: string): string {
  return str.trim().toLowerCase();
}
