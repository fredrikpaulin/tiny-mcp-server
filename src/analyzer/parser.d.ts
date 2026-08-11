// Type contract for the JS parser (parser.js).

import type { Ast, ModuleNode } from "./ast";

export interface ParseResult {
  ast: Ast;
  module: ModuleNode;
  hadError: boolean;
  errorMsg: string;
}

export function parseModule(source: string, filePath: string): ParseResult;
