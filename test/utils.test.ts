import { describe, it, expect } from 'vitest';
import {
  formatSize,
  formatRelativeTime,
  collapseHome,
  expandHome,
  guessMime,
  encodeRfc5987,
  normalizeExtensions,
  parseExtensionList,
  compareBy,
} from '../src/utils';

describe('formatSize', () => {
  it('renders bytes below 1 KiB', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(1)).toBe('1 B');
    expect(formatSize(1023)).toBe('1023 B');
  });

  it('renders one decimal for KB / MB / GB when < 10', () => {
    expect(formatSize(1024)).toBe('1.0 KB');
    expect(formatSize(2 * 1024)).toBe('2.0 KB');
    expect(formatSize(9 * 1024)).toBe('9.0 KB');
  });

  it('renders whole units when >= 10', () => {
    expect(formatSize(10 * 1024)).toBe('10 KB');
    expect(formatSize(500 * 1024)).toBe('500 KB');
  });

  it('promotes to MB / GB / TB', () => {
    expect(formatSize(2 * 1024 * 1024)).toBe('2.0 MB');
    expect(formatSize(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
    expect(formatSize(3 * 1024 ** 4)).toBe('3.0 TB');
  });

  it('caps at TB (does not overflow to PB)', () => {
    // The units table stops at TB; a huge value still reports in TB.
    expect(formatSize(5000 * 1024 ** 4)).toMatch(/TB$/);
  });
});

describe('formatRelativeTime', () => {
  const NOW = new Date('2026-06-15T12:00:00Z').getTime();

  it('renders "just now" / "now" for < 60s', () => {
    expect(formatRelativeTime(NOW - 30_000, false, NOW)).toBe('just now');
    expect(formatRelativeTime(NOW - 30_000, true, NOW)).toBe('now');
  });

  it('renders minute buckets', () => {
    expect(formatRelativeTime(NOW - 5 * 60_000, false, NOW)).toBe('5m ago');
    expect(formatRelativeTime(NOW - 5 * 60_000, true, NOW)).toBe('5m');
  });

  it('renders hour buckets', () => {
    expect(formatRelativeTime(NOW - 3 * 3_600_000, false, NOW)).toBe('3h ago');
    expect(formatRelativeTime(NOW - 3 * 3_600_000, true, NOW)).toBe('3h');
  });

  it('renders day buckets up to 6 days', () => {
    expect(formatRelativeTime(NOW - 6 * 86_400_000, false, NOW)).toBe('6d ago');
    expect(formatRelativeTime(NOW - 6 * 86_400_000, true, NOW)).toBe('6d');
  });

  it('renders month + day at 7+ days within the same year', () => {
    const t = new Date('2026-03-15T12:00:00Z').getTime();
    expect(formatRelativeTime(t, true, NOW)).toMatch(/^(Mar|March) \d+$/);
  });

  it('includes year for prior years', () => {
    const t = new Date('2024-03-15T12:00:00Z').getTime();
    expect(formatRelativeTime(t, true, NOW)).toMatch(/2024$/);
  });
});

describe('collapseHome', () => {
  it('replaces a leading HOME with ~', () => {
    expect(collapseHome('/home/pat/projects', '/home/pat')).toBe('~/projects');
  });

  it('handles HOME exactly', () => {
    expect(collapseHome('/home/pat', '/home/pat')).toBe('~');
  });

  it('does not replace substring matches', () => {
    expect(collapseHome('/home/patrick/x', '/home/pat')).toBe('/home/patrick/x');
  });

  it('leaves unrelated paths alone', () => {
    expect(collapseHome('/tmp/foo', '/home/pat')).toBe('/tmp/foo');
  });

  it('returns input verbatim when HOME is undefined', () => {
    expect(collapseHome('/anywhere', undefined)).toBe('/anywhere');
  });
});

describe('expandHome', () => {
  it('replaces a leading ~ with HOME', () => {
    expect(expandHome('~/projects', '/home/pat')).toBe('/home/pat/projects');
  });

  it('handles bare ~', () => {
    expect(expandHome('~', '/home/pat')).toBe('/home/pat');
  });

  it('leaves absolute paths alone (resolves them)', () => {
    expect(expandHome('/tmp/foo', '/home/pat')).toBe('/tmp/foo');
  });

  it('resolves relative paths against cwd when no HOME', () => {
    // Doesn't crash; produces something absolute.
    const result = expandHome('foo', undefined);
    expect(result.startsWith('/')).toBe(true);
  });
});

describe('guessMime', () => {
  it('returns known types for common extensions', () => {
    expect(guessMime('foo.txt')).toBe('text/plain');
    expect(guessMime('foo.CSV')).toBe('text/csv');
    expect(guessMime('foo.PDF')).toBe('application/pdf');
    expect(guessMime('foo.png')).toBe('image/png');
  });

  it('falls through to octet-stream for unknowns', () => {
    expect(guessMime('foo.qmd')).toBe('application/octet-stream');
    expect(guessMime('foo')).toBe('application/octet-stream');
    expect(guessMime('foo.')).toBe('application/octet-stream');
  });
});

describe('encodeRfc5987', () => {
  it('passes ASCII printable through unchanged', () => {
    expect(encodeRfc5987('foo bar 1.txt')).toBe('foo bar 1.txt');
  });

  it('escapes non-ASCII characters', () => {
    expect(encodeRfc5987('café.md')).toContain('_e9_');
  });
});

describe('normalizeExtensions', () => {
  it('adds a leading dot and lowercases', () => {
    expect(normalizeExtensions(['R', '.py', 'QMD'])).toEqual(['.py', '.qmd', '.r']);
  });

  it('deduplicates', () => {
    expect(normalizeExtensions(['.R', 'r'])).toEqual(['.r']);
  });

  it('skips empty strings', () => {
    expect(normalizeExtensions(['', '  ', '.R'])).toEqual(['.r']);
  });

  it('handles trailing / leading whitespace', () => {
    expect(normalizeExtensions([' .R  '])).toEqual(['.r']);
  });
});

describe('parseExtensionList', () => {
  it('splits on commas', () => {
    expect(parseExtensionList('.R,.py,.qmd')).toEqual(['.R', '.py', '.qmd']);
  });

  it('splits on whitespace', () => {
    expect(parseExtensionList('.R .py .qmd')).toEqual(['.R', '.py', '.qmd']);
  });

  it('splits on mixed separators and trims', () => {
    expect(parseExtensionList('.R,  .py .qmd,')).toEqual(['.R', '.py', '.qmd']);
  });

  it('returns empty for a blank string', () => {
    expect(parseExtensionList('')).toEqual([]);
    expect(parseExtensionList('   ')).toEqual([]);
  });
});

describe('compareBy', () => {
  const entries = [
    { name: 'apple.txt', mtime: 100, size: 200 },
    { name: 'Banana.txt', mtime: 50, size: 50 },
    { name: 'cherry.txt', mtime: 200, size: 100 },
  ];

  it('sorts by name ascending, case-insensitive', () => {
    const sorted = [...entries].sort((a, b) => compareBy('name', 'asc', a, b));
    expect(sorted.map(e => e.name)).toEqual(['apple.txt', 'Banana.txt', 'cherry.txt']);
  });

  it('sorts by name descending', () => {
    const sorted = [...entries].sort((a, b) => compareBy('name', 'desc', a, b));
    expect(sorted.map(e => e.name)).toEqual(['cherry.txt', 'Banana.txt', 'apple.txt']);
  });

  it('sorts by modified: asc = oldest first', () => {
    const sorted = [...entries].sort((a, b) => compareBy('modified', 'asc', a, b));
    expect(sorted.map(e => e.mtime)).toEqual([50, 100, 200]);
  });

  it('sorts by modified: desc = newest first', () => {
    const sorted = [...entries].sort((a, b) => compareBy('modified', 'desc', a, b));
    expect(sorted.map(e => e.mtime)).toEqual([200, 100, 50]);
  });

  it('sorts by size: desc = largest first', () => {
    const sorted = [...entries].sort((a, b) => compareBy('size', 'desc', a, b));
    expect(sorted.map(e => e.size)).toEqual([200, 100, 50]);
  });

  it('falls back to name for ties in modified', () => {
    const tied = [
      { name: 'b.txt', mtime: 100 },
      { name: 'a.txt', mtime: 100 },
    ];
    const sorted = [...tied].sort((a, b) => compareBy('modified', 'asc', a, b));
    expect(sorted.map(e => e.name)).toEqual(['a.txt', 'b.txt']);
  });

  it('handles missing mtime / size (treats as 0)', () => {
    const mixed = [{ name: 'a', mtime: 100 }, { name: 'b' }];
    const sorted = [...mixed].sort((a, b) => compareBy('modified', 'asc', a, b));
    expect(sorted[0].name).toBe('b');
  });

  it('sorts numerically ("file2" before "file10")', () => {
    const numeric = [
      { name: 'file10.txt' },
      { name: 'file2.txt' },
    ];
    const sorted = [...numeric].sort((a, b) => compareBy('name', 'asc', a, b));
    expect(sorted.map(e => e.name)).toEqual(['file2.txt', 'file10.txt']);
  });
});
