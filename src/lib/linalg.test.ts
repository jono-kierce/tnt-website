import { describe, expect, it } from 'vitest';
import { cholesky, solveSPD } from './linalg.ts';

describe('cholesky', () => {
  it('factors a symmetric positive-definite matrix so that L Lᵀ = A', () => {
    const A = [
      [4, 2, -2],
      [2, 10, 2],
      [-2, 2, 5],
    ];
    const L = cholesky(A);
    const n = A.length;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let s = 0;
        for (let k = 0; k < n; k++) s += L[i][k] * L[j][k];
        expect(s).toBeCloseTo(A[i][j], 10);
      }
    }
    // Lower triangular: nothing above the diagonal.
    expect(L[0][1]).toBe(0);
    expect(L[0][2]).toBe(0);
    expect(L[1][2]).toBe(0);
  });

  it('refuses a matrix that is not positive-definite', () => {
    // Indefinite: a ridge penalty is what keeps the real Hessian out of here.
    expect(() => cholesky([[1, 2], [2, 1]])).toThrow(/positive-definite/);
  });
});

describe('solveSPD', () => {
  it('solves A x = b and leaves the inputs untouched', () => {
    const A = [
      [4, 1, 0],
      [1, 3, 1],
      [0, 1, 2],
    ];
    const x = [1, -2, 3];
    const b = A.map((row) => row.reduce((s, a, j) => s + a * x[j], 0));
    const Abefore = JSON.stringify(A);
    const bbefore = JSON.stringify(b);
    const got = solveSPD(A, b);
    got.forEach((v, i) => expect(v).toBeCloseTo(x[i], 10));
    expect(JSON.stringify(A)).toBe(Abefore);
    expect(JSON.stringify(b)).toBe(bbefore);
  });

  it('handles the 1×1 case', () => {
    expect(solveSPD([[5]], [10])[0]).toBeCloseTo(2, 12);
  });
});
