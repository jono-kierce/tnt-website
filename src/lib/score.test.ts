import { describe, expect, it } from 'vitest';
import { scoreParts } from './score.ts';

describe('scoreParts', () => {
  it('leaves a plain scoreline alone', () => {
    expect(scoreParts('6-4')).toEqual([{ text: '6-4', tb: null }]);
  });

  it('lifts the tiebreak points out of a set', () => {
    expect(scoreParts('7-6(4)')).toEqual([{ text: '7-6', tb: '4' }]);
    expect(scoreParts('6(3)-7')).toEqual([
      { text: '6', tb: '3' },
      { text: '-7', tb: null },
    ]);
  });

  it('handles a whole line with more than one breaker', () => {
    expect(scoreParts('4-6 7-6(4) 6(3)-7')).toEqual([
      { text: '4-6 7-6', tb: '4' },
      { text: ' 6', tb: '3' },
      { text: '-7', tb: null },
    ]);
  });

  it('never returns nothing', () => {
    expect(scoreParts('')).toEqual([{ text: '', tb: null }]);
  });
});
