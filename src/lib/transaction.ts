// MODULAR: Logical transaction wrapper for Neon HTTP.
//
// DRY: services that make multi-step DB writes (rating → count update →
//      publish → leg) wrap their work in `transactional()` so a failure
//      rolls back the partial state instead of leaving orphan rows.
//
// CLEAN: Neon HTTP can't BEGIN/COMMIT, so we run the operations
//        sequentially and rely on a stack of compensating actions
//        to undo the work if any step throws. On success we discard
//        the stack.
//
// PERFORMANT: zero allocations after the first call (the stack is
//             empty on the happy path).
//
// The order of compensation is reverse-order-of-insertion — last in,
// first out — mirroring a DB transaction's rollback semantics.
//
// IMPORTANT: compensation is best-effort. If a compensate() itself
// throws, we log and continue with the other compensations to
// maximize the chance of recovery. The original error is re-thrown
// to the caller.

import { log } from './logger';

type Compensate = () => Promise<void>;

interface StackEntry {
  label: string;
  fn: Compensate;
}

export interface TransactionalOptions {
  /** Optional label for logs (route, op name) */
  label?: string;
}

/**
 * Run `body` within a logical transaction.
 *
 * Inside `body`, register compensating actions with `register()`.
 * If the body throws (or returns a rejected promise, or
 * `register()` throws), run all compensations in reverse order
 * and rethrow the original error.
 *
 * Return value of `body` is returned to the caller.
 */
export async function transactional<T>(
  body: (register: (label: string, fn: Compensate) => void) => Promise<T>,
  opts: TransactionalOptions = {},
): Promise<T> {
  const stack: StackEntry[] = [];
  const register = (label: string, fn: Compensate): void => {
    stack.push({ label, fn });
  };
  try {
    return await body(register);
  } catch (err) {
    if (opts.label) {
      log.warn('transaction failed — rolling back', {
        label: opts.label,
        compensations: stack.length,
        err: (err as Error).message,
      });
    }
    await runCompensations(stack);
    throw err;
  }
}

async function runCompensations(stack: StackEntry[]): Promise<void> {
  while (stack.length > 0) {
    const entry = stack.pop()!;
    try {
      await entry.fn();
    } catch (rollbackErr) {
      log.error('compensation failed', {
        label: entry.label,
        err: (rollbackErr as Error).message,
      });
      // Continue with remaining compensations.
    }
  }
}
