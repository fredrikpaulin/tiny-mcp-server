// Token types for JS/TS lexer
// Ported from Skeleton-ts src/lexer/tokens.h

// --- Token type constants ---

// End/Error
export const TOK_EOF = 0;
export const TOK_ERROR = 1;

// Literals
export const TOK_IDENT = 2;
export const TOK_NUMBER = 3;
export const TOK_STRING = 4;
export const TOK_TEMPLATE = 5;
export const TOK_REGEX = 6;

// Keywords - Import/Export
export const TOK_IMPORT = 7;
export const TOK_EXPORT = 8;
export const TOK_FROM = 9;
export const TOK_AS = 10;
export const TOK_DEFAULT = 11;

// Keywords - Declarations
export const TOK_FUNCTION = 12;
export const TOK_CLASS = 13;
export const TOK_CONST = 14;
export const TOK_LET = 15;
export const TOK_VAR = 16;
export const TOK_ASYNC = 17;
export const TOK_STATIC = 18;
export const TOK_GET = 19;
export const TOK_SET = 20;
export const TOK_EXTENDS = 21;
export const TOK_IMPLEMENTS = 22;

// Keywords - Control flow
export const TOK_IF = 23;
export const TOK_ELSE = 24;
export const TOK_SWITCH = 25;
export const TOK_CASE = 26;
export const TOK_FOR = 27;
export const TOK_WHILE = 28;
export const TOK_DO = 29;
export const TOK_RETURN = 30;
export const TOK_THROW = 31;
export const TOK_TRY = 32;
export const TOK_CATCH = 33;
export const TOK_FINALLY = 34;
export const TOK_BREAK = 35;
export const TOK_CONTINUE = 36;

// Keywords - Other
export const TOK_NEW = 37;
export const TOK_THIS = 38;
export const TOK_SUPER = 39;
export const TOK_TYPEOF = 40;
export const TOK_INSTANCEOF = 41;
export const TOK_IN = 42;
export const TOK_OF = 43;
export const TOK_AWAIT = 44;
export const TOK_YIELD = 45;
export const TOK_DELETE = 46;
export const TOK_VOID = 47;
export const TOK_NULL = 48;
export const TOK_UNDEFINED = 49;
export const TOK_TRUE = 50;
export const TOK_FALSE = 51;
export const TOK_WITH = 52;
export const TOK_DEBUGGER = 53;

// TypeScript keywords
export const TOK_TYPE = 54;
export const TOK_INTERFACE = 55;
export const TOK_ENUM = 56;
export const TOK_NAMESPACE = 57;
export const TOK_MODULE = 58;
export const TOK_DECLARE = 59;
export const TOK_READONLY = 60;
export const TOK_PRIVATE = 61;
export const TOK_PROTECTED = 62;
export const TOK_PUBLIC = 63;
export const TOK_ABSTRACT = 64;
export const TOK_ANY = 65;
export const TOK_UNKNOWN = 66;
export const TOK_NEVER = 67;
export const TOK_KEYOF = 68;
export const TOK_INFER = 69;
export const TOK_IS = 70;
export const TOK_ASSERTS = 71;
export const TOK_OVERRIDE = 72;
export const TOK_SATISFIES = 73;

// Operators
export const TOK_PLUS = 74;
export const TOK_MINUS = 75;
export const TOK_STAR = 76;
export const TOK_SLASH = 77;
export const TOK_PERCENT = 78;
export const TOK_STARSTAR = 79;
export const TOK_PLUSPLUS = 80;
export const TOK_MINUSMINUS = 81;
export const TOK_EQ = 82;
export const TOK_PLUSEQ = 83;
export const TOK_MINUSEQ = 84;
export const TOK_STAREQ = 85;
export const TOK_SLASHEQ = 86;
export const TOK_PERCENTEQ = 87;
export const TOK_STARSTAREQ = 88;
export const TOK_EQEQ = 89;
export const TOK_EQEQEQ = 90;
export const TOK_BANG = 91;
export const TOK_BANGEQ = 92;
export const TOK_BANGEQEQ = 93;
export const TOK_LT = 94;
export const TOK_GT = 95;
export const TOK_LTEQ = 96;
export const TOK_GTEQ = 97;
export const TOK_AMPAMP = 98;
export const TOK_PIPEPIPE = 99;
export const TOK_QUESTION = 100;
export const TOK_QUESTIONDOT = 101;
export const TOK_QUESTIONQUESTION = 102;
export const TOK_AMP = 103;
export const TOK_PIPE = 104;
export const TOK_CARET = 105;
export const TOK_TILDE = 106;
export const TOK_LTLT = 107;
export const TOK_GTGT = 108;
export const TOK_GTGTGT = 109;
export const TOK_AMPEQ = 110;
export const TOK_PIPEEQ = 111;
export const TOK_CARETEQ = 112;
export const TOK_LTLTEQ = 113;
export const TOK_GTGTEQ = 114;
export const TOK_GTGTGTEQ = 115;
export const TOK_AMPAMPEQ = 116;
export const TOK_PIPEPIPEEQ = 117;
export const TOK_QUESTIONQUESTIONEQ = 118;

// Punctuation
export const TOK_ARROW = 119;
export const TOK_DOT = 120;
export const TOK_DOTDOTDOT = 121;
export const TOK_COLON = 122;
export const TOK_COMMA = 123;
export const TOK_SEMI = 124;
export const TOK_AT = 125;
export const TOK_HASH = 126;

// Delimiters
export const TOK_LPAREN = 127;
export const TOK_RPAREN = 128;
export const TOK_LBRACE = 129;
export const TOK_RBRACE = 130;
export const TOK_LBRACKET = 131;
export const TOK_RBRACKET = 132;

// Special markers
export const TOK_COMMENT = 133;
export const TOK_TS_IGNORE = 134;
export const TOK_TS_EXPECT_ERROR = 135;
export const TOK_TS_NOCHECK = 136;

export const TOK_COUNT = 137;

// --- Token names (indexed by type) ---

const TOKEN_NAMES = [
  'EOF', 'ERROR', 'IDENT', 'NUMBER', 'STRING', 'TEMPLATE', 'REGEX',
  'import', 'export', 'from', 'as', 'default',
  'function', 'class', 'const', 'let', 'var', 'async', 'static', 'get', 'set', 'extends', 'implements',
  'if', 'else', 'switch', 'case', 'for', 'while', 'do', 'return', 'throw', 'try', 'catch', 'finally', 'break', 'continue',
  'new', 'this', 'super', 'typeof', 'instanceof', 'in', 'of', 'await', 'yield', 'delete', 'void', 'null', 'undefined', 'true', 'false', 'with', 'debugger',
  'type', 'interface', 'enum', 'namespace', 'module', 'declare', 'readonly', 'private', 'protected', 'public', 'abstract', 'any', 'unknown', 'never', 'keyof', 'infer', 'is', 'asserts', 'override', 'satisfies',
  '+', '-', '*', '/', '%', '**', '++', '--',
  '=', '+=', '-=', '*=', '/=', '%=', '**=',
  '==', '===', '!', '!=', '!==',
  '<', '>', '<=', '>=',
  '&&', '||', '?', '?.', '??',
  '&', '|', '^', '~',
  '<<', '>>', '>>>',
  '&=', '|=', '^=', '<<=', '>>=', '>>>=',
  '&&=', '||=', '??=',
  '=>', '.', '...', ':', ',', ';', '@', '#',
  '(', ')', '{', '}', '[', ']',
  'COMMENT', '@ts-ignore', '@ts-expect-error', '@ts-nocheck',
];

export const tokenName = (type) => TOKEN_NAMES[type] || 'UNKNOWN';

// --- Keyword lookup (Map instead of C hash table) ---

const KEYWORDS = new Map([
  ['if', TOK_IF], ['in', TOK_IN], ['of', TOK_OF], ['do', TOK_DO],
  ['as', TOK_AS], ['is', TOK_IS], ['for', TOK_FOR], ['let', TOK_LET],
  ['var', TOK_VAR], ['new', TOK_NEW], ['try', TOK_TRY], ['get', TOK_GET],
  ['set', TOK_SET], ['any', TOK_ANY], ['else', TOK_ELSE], ['case', TOK_CASE],
  ['this', TOK_THIS], ['true', TOK_TRUE], ['null', TOK_NULL], ['void', TOK_VOID],
  ['with', TOK_WITH], ['from', TOK_FROM], ['type', TOK_TYPE], ['enum', TOK_ENUM],
  ['while', TOK_WHILE], ['break', TOK_BREAK], ['catch', TOK_CATCH],
  ['throw', TOK_THROW], ['const', TOK_CONST], ['class', TOK_CLASS],
  ['super', TOK_SUPER], ['yield', TOK_YIELD], ['false', TOK_FALSE],
  ['async', TOK_ASYNC], ['await', TOK_AWAIT], ['infer', TOK_INFER],
  ['keyof', TOK_KEYOF], ['never', TOK_NEVER], ['return', TOK_RETURN],
  ['switch', TOK_SWITCH], ['typeof', TOK_TYPEOF], ['delete', TOK_DELETE],
  ['import', TOK_IMPORT], ['export', TOK_EXPORT], ['static', TOK_STATIC],
  ['public', TOK_PUBLIC], ['module', TOK_MODULE], ['default', TOK_DEFAULT],
  ['finally', TOK_FINALLY], ['extends', TOK_EXTENDS], ['private', TOK_PRIVATE],
  ['declare', TOK_DECLARE], ['unknown', TOK_UNKNOWN], ['asserts', TOK_ASSERTS],
  ['function', TOK_FUNCTION], ['continue', TOK_CONTINUE], ['debugger', TOK_DEBUGGER],
  ['abstract', TOK_ABSTRACT], ['readonly', TOK_READONLY], ['override', TOK_OVERRIDE],
  ['interface', TOK_INTERFACE], ['protected', TOK_PROTECTED], ['namespace', TOK_NAMESPACE],
  ['undefined', TOK_UNDEFINED], ['satisfies', TOK_SATISFIES],
  ['implements', TOK_IMPLEMENTS], ['instanceof', TOK_INSTANCEOF],
]);

export const lookupKeyword = (str) => KEYWORDS.get(str) ?? TOK_IDENT;

// --- Regex-start context (can / start a regex after this token?) ---

const REGEX_PREV = new Set([
  TOK_EOF, TOK_LPAREN, TOK_LBRACE, TOK_LBRACKET,
  TOK_COMMA, TOK_SEMI, TOK_COLON, TOK_QUESTION,
  TOK_EQ, TOK_PLUSEQ, TOK_MINUSEQ, TOK_STAREQ, TOK_SLASHEQ, TOK_PERCENTEQ,
  TOK_LTLTEQ, TOK_GTGTEQ, TOK_GTGTGTEQ, TOK_AMPEQ, TOK_PIPEEQ, TOK_CARETEQ,
  TOK_AMPAMPEQ, TOK_PIPEPIPEEQ, TOK_QUESTIONQUESTIONEQ,
  TOK_EQEQ, TOK_EQEQEQ, TOK_BANGEQ, TOK_BANGEQEQ,
  // Not TOK_LT or TOK_GT — JSX closing tags like </Component> would be misread as regex
  TOK_LTEQ, TOK_GTEQ,
  TOK_AMPAMP, TOK_PIPEPIPE, TOK_QUESTIONQUESTION,
  TOK_PLUS, TOK_MINUS, TOK_STAR, TOK_PERCENT, TOK_STARSTAR,
  TOK_AMP, TOK_PIPE, TOK_CARET, TOK_TILDE, TOK_BANG,
  TOK_LTLT, TOK_GTGT, TOK_GTGTGT,
  TOK_RETURN, TOK_CASE, TOK_THROW, TOK_NEW, TOK_IN, TOK_OF,
  TOK_TYPEOF, TOK_INSTANCEOF, TOK_VOID, TOK_DELETE, TOK_AWAIT, TOK_YIELD,
  TOK_ARROW,
]);

export const canStartRegex = (prevType) => REGEX_PREV.has(prevType);
