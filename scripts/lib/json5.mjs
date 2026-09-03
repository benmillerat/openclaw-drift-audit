const IDENTIFIER_START = /[A-Za-z_$\u0080-\uFFFF]/u;
const IDENTIFIER_PART = /[A-Za-z0-9_$\-\u0080-\uFFFF]/u;

export class Json5SyntaxError extends SyntaxError {
  constructor(message, line, column) {
    super(`${message} at ${line}:${column}`);
    this.name = "Json5SyntaxError";
    this.line = line;
    this.column = column;
  }
}

class Parser {
  constructor(input, options = {}) {
    this.input = input.replace(/^\uFEFF/u, "");
    this.index = 0;
    this.line = 1;
    this.column = 1;
    this.depth = 0;
    this.nodes = 0;
    this.maxDepth = options.maxDepth ?? 128;
    this.maxNodes = options.maxNodes ?? 100_000;
    this.maxStringLength = options.maxStringLength ?? 1024 * 1024;
  }

  parse() {
    this.skipTrivia();
    const value = this.parseValue();
    this.skipTrivia();
    if (!this.eof()) this.fail(`Unexpected token ${JSON.stringify(this.peek())}`);
    return value;
  }

  eof() {
    return this.index >= this.input.length;
  }

  peek(offset = 0) {
    return this.input[this.index + offset];
  }

  take() {
    const char = this.input[this.index++];
    if (char === "\n") {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    return char;
  }

  fail(message) {
    throw new Json5SyntaxError(message, this.line, this.column);
  }

  skipTrivia() {
    for (;;) {
      while (!this.eof() && /\s/u.test(this.peek())) this.take();
      if (this.peek() === "/" && this.peek(1) === "/") {
        this.take();
        this.take();
        while (!this.eof() && this.peek() !== "\n" && this.peek() !== "\r") this.take();
        continue;
      }
      if (this.peek() === "/" && this.peek(1) === "*") {
        this.take();
        this.take();
        let closed = false;
        while (!this.eof()) {
          if (this.peek() === "*" && this.peek(1) === "/") {
            this.take();
            this.take();
            closed = true;
            break;
          }
          this.take();
        }
        if (!closed) this.fail("Unterminated block comment");
        continue;
      }
      break;
    }
  }

  parseValue() {
    this.skipTrivia();
    this.nodes += 1;
    if (this.nodes > this.maxNodes) this.fail(`JSON5 node limit exceeded (${this.maxNodes})`);
    const char = this.peek();
    if (char === "{") return this.parseObject();
    if (char === "[") return this.parseArray();
    if (char === '"' || char === "'") return this.parseString();
    if (char === "+" || char === "-" || char === "." || /[0-9]/u.test(char ?? "")) {
      return this.parseNumber();
    }
    if (char && IDENTIFIER_START.test(char)) {
      const identifier = this.parseIdentifier();
      if (identifier === "true") return true;
      if (identifier === "false") return false;
      if (identifier === "null") return null;
      if (identifier === "Infinity") return Infinity;
      if (identifier === "NaN") return Number.NaN;
      this.fail(`Unexpected identifier ${JSON.stringify(identifier)}`);
    }
    this.fail(`Unexpected token ${JSON.stringify(char)}`);
  }

  parseObject() {
    if (this.depth >= this.maxDepth) this.fail(`JSON5 depth limit exceeded (${this.maxDepth})`);
    this.depth += 1;
    this.take();
    const result = Object.create(null);
    this.skipTrivia();
    if (this.peek() === "}") {
      this.take();
      this.depth -= 1;
      return result;
    }
    for (;;) {
      this.skipTrivia();
      const char = this.peek();
      const key = char === '"' || char === "'" ? this.parseString() : this.parseIdentifier();
      this.skipTrivia();
      if (this.take() !== ":") this.fail("Expected ':' after object key");
      result[key] = this.parseValue();
      this.skipTrivia();
      const separator = this.take();
      if (separator === "}") {
        this.depth -= 1;
        return result;
      }
      if (separator !== ",") this.fail("Expected ',' or '}' in object");
      this.skipTrivia();
      if (this.peek() === "}") {
        this.take();
        this.depth -= 1;
        return result;
      }
    }
  }

  parseArray() {
    if (this.depth >= this.maxDepth) this.fail(`JSON5 depth limit exceeded (${this.maxDepth})`);
    this.depth += 1;
    this.take();
    const result = [];
    this.skipTrivia();
    if (this.peek() === "]") {
      this.take();
      this.depth -= 1;
      return result;
    }
    for (;;) {
      result.push(this.parseValue());
      this.skipTrivia();
      const separator = this.take();
      if (separator === "]") {
        this.depth -= 1;
        return result;
      }
      if (separator !== ",") this.fail("Expected ',' or ']' in array");
      this.skipTrivia();
      if (this.peek() === "]") {
        this.take();
        this.depth -= 1;
        return result;
      }
    }
  }

  parseIdentifier() {
    let value = "";
    const first = this.peek();
    if (!first || !IDENTIFIER_START.test(first)) this.fail("Expected an identifier");
    value += this.take();
    while (!this.eof() && IDENTIFIER_PART.test(this.peek())) {
      value += this.take();
      if (value.length > this.maxStringLength) this.fail(`JSON5 string limit exceeded (${this.maxStringLength})`);
    }
    return value;
  }

  parseString() {
    const quote = this.take();
    let value = "";
    while (!this.eof()) {
      if (value.length > this.maxStringLength) {
        this.fail(`JSON5 string limit exceeded (${this.maxStringLength})`);
      }
      const char = this.take();
      if (char === quote) {
        if (value.length > this.maxStringLength) {
          this.fail(`JSON5 string limit exceeded (${this.maxStringLength})`);
        }
        return value;
      }
      if (char === "\n" || char === "\r") this.fail("Unescaped newline in string");
      if (char !== "\\") {
        value += char;
        continue;
      }
      if (this.eof()) this.fail("Unterminated escape sequence");
      const escaped = this.take();
      if (escaped === "\n") continue;
      if (escaped === "\r") {
        if (this.peek() === "\n") this.take();
        continue;
      }
      const simple = {
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t",
        v: "\v",
        0: "\0",
        "\\": "\\",
        "'": "'",
        '"': '"',
      };
      if (Object.hasOwn(simple, escaped)) {
        if (escaped === "0" && /[0-9]/u.test(this.peek() ?? "")) {
          this.fail("Octal escape sequences are not supported");
        }
        value += simple[escaped];
        continue;
      }
      if (escaped === "x") {
        value += String.fromCodePoint(this.takeHex(2));
        continue;
      }
      if (escaped === "u") {
        value += String.fromCodePoint(this.takeHex(4));
        continue;
      }
      value += escaped;
    }
    this.fail("Unterminated string");
  }

  takeHex(length) {
    let digits = "";
    for (let index = 0; index < length; index += 1) {
      const char = this.take();
      if (!/[0-9A-Fa-f]/u.test(char ?? "")) this.fail("Invalid hexadecimal escape");
      digits += char;
    }
    return Number.parseInt(digits, 16);
  }

  parseNumber() {
    const remaining = this.input.slice(this.index);
    const match = remaining.match(
      /^[+-]?(?:Infinity|NaN|0[xX][0-9A-Fa-f]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/u,
    );
    if (!match) this.fail("Invalid number");
    for (const _char of match[0]) this.take();
    if (/^[+-]?Infinity$/u.test(match[0])) return match[0].startsWith("-") ? -Infinity : Infinity;
    if (/^[+-]?NaN$/u.test(match[0])) return Number.NaN;
    const sign = match[0].startsWith("-") ? -1 : 1;
    const unsigned = match[0].replace(/^[+-]/u, "");
    if (/^0[xX]/u.test(unsigned)) return sign * Number.parseInt(unsigned.slice(2), 16);
    return Number(match[0]);
  }
}

function validateParsedLimits(value, options = {}) {
  const maxDepth = options.maxDepth ?? 128;
  const maxNodes = options.maxNodes ?? 100_000;
  const maxStringLength = options.maxStringLength ?? 1024 * 1024;
  const stack = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length > 0) {
    const current = stack.pop();
    nodes += 1;
    if (nodes > maxNodes) throw new Json5SyntaxError(`JSON5 node limit exceeded (${maxNodes})`, 1, 1);
    if (current.depth > maxDepth) throw new Json5SyntaxError(`JSON5 depth limit exceeded (${maxDepth})`, 1, 1);
    if (typeof current.value === "string" && current.value.length > maxStringLength) {
      throw new Json5SyntaxError(`JSON5 string limit exceeded (${maxStringLength})`, 1, 1);
    }
    if (!current.value || typeof current.value !== "object") continue;
    for (const [key, child] of Object.entries(current.value)) {
      if (key.length > maxStringLength) {
        throw new Json5SyntaxError(`JSON5 string limit exceeded (${maxStringLength})`, 1, 1);
      }
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
  return value;
}

export function parseJson5(input, options = {}) {
  if (typeof input !== "string") throw new TypeError("JSON5 input must be a string");
  try {
    return validateParsedLimits(JSON.parse(input), options);
  } catch {
    return validateParsedLimits(new Parser(input, options).parse(), options);
  }
}
