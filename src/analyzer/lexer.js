// JS/TS Lexer — hand-written tokenizer
// Ported from Skeleton-ts src/lexer/lexer.c

import {
  TOK_EOF, TOK_ERROR, TOK_IDENT, TOK_NUMBER, TOK_STRING, TOK_TEMPLATE, TOK_REGEX,
  TOK_COMMENT, TOK_TS_IGNORE, TOK_TS_EXPECT_ERROR, TOK_TS_NOCHECK,
  TOK_LPAREN, TOK_RPAREN, TOK_LBRACE, TOK_RBRACE, TOK_LBRACKET, TOK_RBRACKET,
  TOK_COMMA, TOK_SEMI, TOK_COLON, TOK_TILDE, TOK_AT, TOK_HASH,
  TOK_DOT, TOK_DOTDOTDOT,
  TOK_PLUS, TOK_PLUSPLUS, TOK_PLUSEQ,
  TOK_MINUS, TOK_MINUSMINUS, TOK_MINUSEQ,
  TOK_STAR, TOK_STARSTAR, TOK_STAREQ, TOK_STARSTAREQ,
  TOK_SLASH, TOK_SLASHEQ,
  TOK_PERCENT, TOK_PERCENTEQ,
  TOK_EQ, TOK_EQEQ, TOK_EQEQEQ, TOK_ARROW,
  TOK_BANG, TOK_BANGEQ, TOK_BANGEQEQ,
  TOK_LT, TOK_LTEQ, TOK_LTLT, TOK_LTLTEQ,
  TOK_GT, TOK_GTEQ, TOK_GTGT, TOK_GTGTEQ, TOK_GTGTGT, TOK_GTGTGTEQ,
  TOK_AMP, TOK_AMPAMP, TOK_AMPEQ, TOK_AMPAMPEQ,
  TOK_PIPE, TOK_PIPEPIPE, TOK_PIPEEQ, TOK_PIPEPIPEEQ,
  TOK_CARET, TOK_CARETEQ,
  TOK_QUESTION, TOK_QUESTIONDOT, TOK_QUESTIONQUESTION, TOK_QUESTIONQUESTIONEQ,
  lookupKeyword, canStartRegex,
} from './tokens.js';

// --- Character tests ---

const isDigit = (c) => c >= '0' && c <= '9';
const isHexDigit = (c) => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
const isAlpha = (c) => (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_' || c === '$' || (c > '\x7f' && /\p{ID_Start}/u.test(c));
const isAlphaNum = (c) => isAlpha(c) || isDigit(c) || (c > '\x7f' && /\p{ID_Continue}/u.test(c));

// --- Lexer ---

export const createLexer = (source) => {
  const lex = {
    source,
    pos: 0,       // current position
    start: 0,     // token start position
    line: 1,
    column: 0,
    lineStart: 0, // offset of current line start
    prevType: TOK_EOF,
    error: null,
  };

  // --- Internal helpers ---

  const atEnd = () => lex.pos >= source.length;
  const peek = () => atEnd() ? '\0' : source[lex.pos];
  const peekNext = () => lex.pos + 1 >= source.length ? '\0' : source[lex.pos + 1];

  const advance = () => {
    const c = source[lex.pos++];
    if (c === '\n') {
      lex.line++;
      lex.lineStart = lex.pos;
      lex.column = 0;
    } else {
      lex.column++;
    }
    return c;
  };

  const makeToken = (type) => {
    const tok = {
      type,
      value: source.slice(lex.start, lex.pos),
      line: lex.line,
      column: lex.start - lex.lineStart,
      offset: lex.start,
      length: lex.pos - lex.start,
    };
    lex.prevType = type;
    return tok;
  };

  const errorToken = (msg) => {
    lex.error = msg;
    return {
      type: TOK_ERROR,
      value: source.slice(lex.start, lex.pos),
      line: lex.line,
      column: lex.start - lex.lineStart,
      offset: lex.start,
      length: lex.pos - lex.start,
      error: msg,
    };
  };

  const skipWhitespace = () => {
    while (!atEnd()) {
      const c = peek();
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') advance();
      else break;
    }
  };

  // --- @ts- directive detection in comments ---

  const checkTsDirective = (content) => {
    let i = content.indexOf('@ts-');
    while (i !== -1) {
      if (content.startsWith('@ts-ignore', i)) return TOK_TS_IGNORE;
      if (content.startsWith('@ts-expect-error', i)) return TOK_TS_EXPECT_ERROR;
      if (content.startsWith('@ts-nocheck', i)) return TOK_TS_NOCHECK;
      i = content.indexOf('@ts-', i + 4);
    }
    return null;
  };

  // --- Scanning functions ---

  const scanLineComment = () => {
    advance(); // second /
    const contentStart = lex.pos;
    while (peek() !== '\n' && !atEnd()) advance();
    const directive = checkTsDirective(source.slice(contentStart, lex.pos));
    return makeToken(directive ?? TOK_COMMENT);
  };

  const scanBlockComment = () => {
    advance(); // *
    const contentStart = lex.pos;
    while (!atEnd()) {
      if (peek() === '*' && peekNext() === '/') {
        const contentEnd = lex.pos;
        advance(); advance(); // */
        const directive = checkTsDirective(source.slice(contentStart, contentEnd));
        return makeToken(directive ?? TOK_COMMENT);
      }
      advance();
    }
    return errorToken('Unterminated block comment');
  };

  const scanIdentifier = () => {
    while (isAlphaNum(peek())) advance();
    const word = source.slice(lex.start, lex.pos);
    return makeToken(lookupKeyword(word));
  };

  const scanNumber = () => {
    // Handle 0x, 0b, 0o prefixes
    if (source[lex.start] === '0') {
      const next = peek();
      if (next === 'x' || next === 'X') {
        advance();
        while (isHexDigit(peek()) || peek() === '_') advance();
        if (peek() === 'n') advance(); // BigInt
        return makeToken(TOK_NUMBER);
      }
      if (next === 'b' || next === 'B') {
        advance();
        while (peek() === '0' || peek() === '1' || peek() === '_') advance();
        if (peek() === 'n') advance();
        return makeToken(TOK_NUMBER);
      }
      if (next === 'o' || next === 'O') {
        advance();
        while ((peek() >= '0' && peek() <= '7') || peek() === '_') advance();
        if (peek() === 'n') advance();
        return makeToken(TOK_NUMBER);
      }
    }

    // Decimal digits
    while (isDigit(peek()) || peek() === '_') advance();

    // Fraction
    if (peek() === '.' && isDigit(peekNext())) {
      advance();
      while (isDigit(peek()) || peek() === '_') advance();
    }

    // Exponent
    if (peek() === 'e' || peek() === 'E') {
      advance();
      if (peek() === '+' || peek() === '-') advance();
      while (isDigit(peek()) || peek() === '_') advance();
    }

    // BigInt suffix
    if (peek() === 'n') advance();

    return makeToken(TOK_NUMBER);
  };

  const scanString = (quote) => {
    while (peek() !== quote && !atEnd()) {
      if (peek() === '\\') {
        advance(); // escape char
        if (!atEnd()) advance();
      } else if (peek() === '\n' && quote !== '`') {
        return errorToken('Unterminated string');
      } else {
        advance();
      }
    }
    if (atEnd()) return errorToken('Unterminated string');
    advance(); // closing quote
    return makeToken(quote === '`' ? TOK_TEMPLATE : TOK_STRING);
  };

  const scanRegex = () => {
    // First / already consumed
    let inClass = false;
    while (!atEnd()) {
      const c = peek();
      if (c === '\\') {
        advance();
        if (!atEnd()) advance();
        continue;
      }
      if (!inClass && c === '[') { inClass = true; advance(); continue; }
      if (inClass && c === ']') { inClass = false; advance(); continue; }
      if (c === '/' && !inClass) {
        advance(); // closing /
        const validFlags = 'dgimsuyv';
        while (validFlags.includes(peek())) advance(); // flags
        return makeToken(TOK_REGEX);
      }
      if (c === '\n') return errorToken('Unterminated regex');
      advance();
    }
    return errorToken('Unterminated regex');
  };

  // --- Main scan ---

  const next = () => {
    skipWhitespace();
    lex.start = lex.pos;

    if (atEnd()) return makeToken(TOK_EOF);

    const c = advance();

    // Identifiers and keywords
    if (isAlpha(c)) return scanIdentifier();

    // Numbers
    if (isDigit(c)) return scanNumber();

    // Strings
    if (c === '"' || c === "'" || c === '`') return scanString(c);

    // Operators and punctuation
    switch (c) {
      case '(': return makeToken(TOK_LPAREN);
      case ')': return makeToken(TOK_RPAREN);
      case '{': return makeToken(TOK_LBRACE);
      case '}': return makeToken(TOK_RBRACE);
      case '[': return makeToken(TOK_LBRACKET);
      case ']': return makeToken(TOK_RBRACKET);
      case ',': return makeToken(TOK_COMMA);
      case ';': return makeToken(TOK_SEMI);
      case ':': return makeToken(TOK_COLON);
      case '~': return makeToken(TOK_TILDE);
      case '@': return makeToken(TOK_AT);
      case '#': return makeToken(TOK_HASH);

      case '.':
        if (peek() === '.' && peekNext() === '.') { advance(); advance(); return makeToken(TOK_DOTDOTDOT); }
        return makeToken(TOK_DOT);

      case '+':
        if (peek() === '+') { advance(); return makeToken(TOK_PLUSPLUS); }
        if (peek() === '=') { advance(); return makeToken(TOK_PLUSEQ); }
        return makeToken(TOK_PLUS);

      case '-':
        if (peek() === '-') { advance(); return makeToken(TOK_MINUSMINUS); }
        if (peek() === '=') { advance(); return makeToken(TOK_MINUSEQ); }
        return makeToken(TOK_MINUS);

      case '*':
        if (peek() === '*') {
          advance();
          if (peek() === '=') { advance(); return makeToken(TOK_STARSTAREQ); }
          return makeToken(TOK_STARSTAR);
        }
        if (peek() === '=') { advance(); return makeToken(TOK_STAREQ); }
        return makeToken(TOK_STAR);

      case '/':
        if (peek() === '/') return scanLineComment();
        if (peek() === '*') return scanBlockComment();
        if (peek() === '=') { advance(); return makeToken(TOK_SLASHEQ); }
        if (canStartRegex(lex.prevType)) return scanRegex();
        return makeToken(TOK_SLASH);

      case '%':
        if (peek() === '=') { advance(); return makeToken(TOK_PERCENTEQ); }
        return makeToken(TOK_PERCENT);

      case '=':
        if (peek() === '=') {
          advance();
          if (peek() === '=') { advance(); return makeToken(TOK_EQEQEQ); }
          return makeToken(TOK_EQEQ);
        }
        if (peek() === '>') { advance(); return makeToken(TOK_ARROW); }
        return makeToken(TOK_EQ);

      case '!':
        if (peek() === '=') {
          advance();
          if (peek() === '=') { advance(); return makeToken(TOK_BANGEQEQ); }
          return makeToken(TOK_BANGEQ);
        }
        return makeToken(TOK_BANG);

      case '<':
        if (peek() === '<') {
          advance();
          if (peek() === '=') { advance(); return makeToken(TOK_LTLTEQ); }
          return makeToken(TOK_LTLT);
        }
        if (peek() === '=') { advance(); return makeToken(TOK_LTEQ); }
        return makeToken(TOK_LT);

      case '>':
        if (peek() === '>') {
          advance();
          if (peek() === '>') {
            advance();
            if (peek() === '=') { advance(); return makeToken(TOK_GTGTGTEQ); }
            return makeToken(TOK_GTGTGT);
          }
          if (peek() === '=') { advance(); return makeToken(TOK_GTGTEQ); }
          return makeToken(TOK_GTGT);
        }
        if (peek() === '=') { advance(); return makeToken(TOK_GTEQ); }
        return makeToken(TOK_GT);

      case '&':
        if (peek() === '&') {
          advance();
          if (peek() === '=') { advance(); return makeToken(TOK_AMPAMPEQ); }
          return makeToken(TOK_AMPAMP);
        }
        if (peek() === '=') { advance(); return makeToken(TOK_AMPEQ); }
        return makeToken(TOK_AMP);

      case '|':
        if (peek() === '|') {
          advance();
          if (peek() === '=') { advance(); return makeToken(TOK_PIPEPIPEEQ); }
          return makeToken(TOK_PIPEPIPE);
        }
        if (peek() === '=') { advance(); return makeToken(TOK_PIPEEQ); }
        return makeToken(TOK_PIPE);

      case '^':
        if (peek() === '=') { advance(); return makeToken(TOK_CARETEQ); }
        return makeToken(TOK_CARET);

      case '?':
        if (peek() === '?') {
          advance();
          if (peek() === '=') { advance(); return makeToken(TOK_QUESTIONQUESTIONEQ); }
          return makeToken(TOK_QUESTIONQUESTION);
        }
        if (peek() === '.' && !isDigit(peekNext())) {
          advance();
          return makeToken(TOK_QUESTIONDOT);
        }
        return makeToken(TOK_QUESTION);
    }

    return errorToken('Unexpected character');
  };

  // --- Peek (save/restore state) ---

  const peekToken = () => {
    const saved = { pos: lex.pos, start: lex.start, line: lex.line, column: lex.column, lineStart: lex.lineStart, prevType: lex.prevType, error: lex.error };
    const tok = next();
    Object.assign(lex, saved);
    return tok;
  };

  return {
    next,
    peek: peekToken,
    atEnd,
    get state() { return lex; },
  };
};
