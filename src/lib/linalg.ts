/**
 * The small amount of dense linear algebra the rating fit needs, and nothing
 * more. The prediction model (`predict.ts`) solves a penalised least-squares /
 * logistic system by Newton's method; every step is `H x = g` for a symmetric
 * positive-definite `H` (a ridge penalty `λ > 0` guarantees the definiteness).
 * That's exactly the case Cholesky handles fastest and most stably, so that's
 * all that lives here.
 *
 * Kept dependency-free on purpose: the site builds to static files with no
 * runtime, the graphics renderer runs the same `.ts` under Node, and a matrix
 * library would have to be vendored into both. Forty lines of Cholesky is less
 * to reason about than that, and the matrices are tiny (one row/column per
 * rated player, ~50 at most).
 */

/**
 * Cholesky factor `L` (lower-triangular) of a symmetric positive-definite `A`,
 * so that `A = L Lᵀ`. Only the lower triangle of `A` is read.
 *
 * Throws if `A` is not positive-definite — a non-positive pivot means the
 * caller handed over a matrix the ridge penalty should have made SPD, which is
 * a bug worth surfacing rather than papering over with a pseudo-inverse.
 */
export function cholesky(A: number[][]): number[][] {
  const n = A.length;
  const L: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 0) {
          throw new Error(`cholesky: matrix not positive-definite (pivot ${sum} at ${i})`);
        }
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  return L;
}

/**
 * Solve `A x = b` for a symmetric positive-definite `A`, via Cholesky and two
 * triangular solves. `A` is not modified; `b` is not modified.
 */
export function solveSPD(A: number[][], b: number[]): number[] {
  const L = cholesky(A);
  const n = A.length;
  // Forward substitution: L y = b.
  const y = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    let sum = b[i];
    for (let k = 0; k < i; k++) sum -= L[i][k] * y[k];
    y[i] = sum / L[i][i];
  }
  // Back substitution: Lᵀ x = y.
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = y[i];
    for (let k = i + 1; k < n; k++) sum -= L[k][i] * x[k];
    x[i] = sum / L[i][i];
  }
  return x;
}
