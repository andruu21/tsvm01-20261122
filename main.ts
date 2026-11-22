// Tiny stack VM entry for tiny-stack-vm-01-run-20261122: a faithful port of the kit's
// reference VM (generator/subject/vm.mjs) to TypeScript, with the entry's file I/O. It reads
// /input/<id>/program.bin and input.bin (MAKEFUN_INPUT_DIR override), runs the bytecode and
// writes /output/<id>/stdout.bin and exit.txt (MAKEFUN_OUTPUT_DIR override). Wrapping 32-bit
// arithmetic, a 256-value data stack, a 64-frame call stack, 256 words of memory, input and
// output, ten traps and the step and output limits, in the order the ISA states them.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// [immediate byte count, pops, pushes] per opcode byte; the byte itself is the switch case.
const OPS = new Map([
  [0x00, [0, 0, 0]], [0x01, [1, 0, 1]], [0x02, [4, 0, 1]], [0x03, [0, 1, 0]],
  [0x04, [0, 1, 2]], [0x05, [0, 2, 2]], [0x06, [0, 2, 3]], [0x07, [0, 3, 3]],
  [0x10, [0, 2, 1]], [0x11, [0, 2, 1]], [0x12, [0, 2, 1]], [0x13, [0, 2, 1]],
  [0x14, [0, 2, 1]], [0x15, [0, 2, 1]], [0x16, [0, 2, 1]], [0x17, [0, 1, 1]],
  [0x18, [0, 2, 1]], [0x19, [0, 2, 1]], [0x1a, [0, 2, 1]], [0x1b, [0, 1, 1]],
  [0x1c, [0, 2, 1]], [0x1d, [0, 2, 1]], [0x1e, [0, 2, 1]], [0x20, [0, 2, 1]],
  [0x21, [0, 2, 1]], [0x22, [0, 2, 1]], [0x30, [2, 0, 0]], [0x31, [2, 1, 0]],
  [0x32, [2, 1, 0]], [0x33, [2, 0, 0]], [0x34, [0, 0, 0]], [0x40, [0, 1, 1]],
  [0x41, [0, 2, 0]], [0x50, [0, 1, 0]], [0x51, [0, 1, 0]], [0x52, [0, 0, 1]],
  [0x53, [0, 1, 0]],
]);

function run(p: Uint8Array, input: Uint8Array): { stdout: Uint8Array; exit: number } {
  const n = p.length, D = new Int32Array(256), M = new Int32Array(256),
    C = new Int32Array(64), out = new Uint8Array(65536);
  let sp = 0, csp = 0, olen = 0, inPos = 0, pc = 0, steps = 0;
  const done = (exit: number) => ({ stdout: out.slice(0, olen), exit });
  for (;;) {
    if (steps === 1e6) return done(10);            // step limit
    if (pc < 0 || pc >= n) return done(9);         // pc outside the program
    const op = OPS.get(p[pc]);
    if (!op) return done(5);                       // unknown opcode
    const [imm, pops, pushes] = op;
    if (pc + imm >= n) return done(9);             // immediate cut off
    steps++;
    const next = pc + 1 + imm;
    if (sp < pops) return done(2);                 // underflow
    if (sp - pops + pushes > 256) return done(3);  // overflow
    pc = next;
    const a = D[sp - 2], b = D[sp - 1], op0 = p[next - 1 - imm];
    switch (op0) {
      case 0x00: return done(0);
      case 0x01: D[sp++] = (p[next - 1] << 24) >> 24; break;
      case 0x02: D[sp++] = p[next - 4] | (p[next - 3] << 8) | (p[next - 2] << 16) | (p[next - 1] << 24); break;
      case 0x03: sp--; break;
      case 0x04: D[sp] = b; sp++; break;
      case 0x05: D[sp - 1] = a, D[sp - 2] = b; break;
      case 0x06: D[sp] = a; sp++; break;
      case 0x07: { const c = D[sp - 3]; D[sp - 3] = a, D[sp - 2] = b, D[sp - 1] = c; break; }
      case 0x10: D[sp - 2] = a + b | 0; sp--; break;
      case 0x11: D[sp - 2] = a - b | 0; sp--; break;
      case 0x12: D[sp - 2] = Math.imul(a, b); sp--; break;
      case 0x13: if (!b) return done(4);
        D[sp - 2] = a === -2147483648 && b === -1 ? a : a / b | 0; sp--; break;
      case 0x14: if (!b) return done(4); D[sp - 2] = b === -1 ? 0 : a % b | 0; sp--; break;
      case 0x15: if (!b) return done(4); D[sp - 2] = Math.floor((a >>> 0) / (b >>> 0)) | 0; sp--; break;
      case 0x16: if (!b) return done(4); D[sp - 2] = (a >>> 0) % (b >>> 0) | 0; sp--; break;
      case 0x17: D[sp - 1] = -b | 0; break;
      case 0x18: D[sp - 2] = a & b; sp--; break;
      case 0x19: D[sp - 2] = a | b; sp--; break;
      case 0x1a: D[sp - 2] = a ^ b; sp--; break;
      case 0x1b: D[sp - 1] = ~b; break;
      case 0x1c: D[sp - 2] = a << (b & 31); sp--; break;
      case 0x1d: D[sp - 2] = a >> (b & 31); sp--; break;
      case 0x1e: D[sp - 2] = a >>> (b & 31) | 0; sp--; break;
      case 0x20: D[sp - 2] = a === b ? 1 : 0; sp--; break;
      case 0x21: D[sp - 2] = a < b ? 1 : 0; sp--; break;
      case 0x22: D[sp - 2] = a >>> 0 < b >>> 0 ? 1 : 0; sp--; break;
      case 0x30:
      case 0x31:
      case 0x32: {
        const rel = ((p[next - 2] | (p[next - 1] << 8)) << 16) >> 16;
        let take = true;
        if (op0 !== 0x30) { const v = D[--sp]; take = op0 === 0x31 ? v === 0 : v !== 0; }
        if (take) pc = next + rel;
        break;
      }
      case 0x33: if (csp === 64) return done(7); C[csp++] = next; pc = p[next - 2] | (p[next - 1] << 8); break;
      case 0x34: if (!csp) return done(8); pc = C[--csp]; break;
      case 0x40: if (b < 0 || b > 255) return done(6); D[sp - 1] = M[b]; break;
      case 0x41: if (b < 0 || b > 255) return done(6); sp -= 2; M[b] = a; break;
      case 0x50: {
        const bytes = new TextEncoder().encode(String(b));
        if (olen + bytes.length > 65536) return done(11);
        sp--; out.set(bytes, olen); olen += bytes.length;
        break;
      }
      case 0x51: if (olen + 1 > 65536) return done(11); out[olen++] = D[--sp] & 255; break;
      case 0x52: D[sp++] = inPos < input.length ? input[inPos++] : -1; break;
      case 0x53: return done(D[--sp] & 255);
    }
  }
}

const I = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const O = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(I).sort()) {
  const r = run(new Uint8Array(readFileSync(join(I, id, 'program.bin'))),
    new Uint8Array(readFileSync(join(I, id, 'input.bin'))));
  mkdirSync(join(O, id), { recursive: true });
  writeFileSync(join(O, id, 'stdout.bin'), r.stdout);
  writeFileSync(join(O, id, 'exit.txt'), `${r.exit}\n`);
}
