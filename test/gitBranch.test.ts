import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { readGitBranchAtPath, invalidateGitBranchCache } from '../src/gitBranch';

/**
 * These tests exercise the direct .git/HEAD parser used as a fallback when
 * the built-in VS Code git extension hasn't adopted a repo. They use real
 * filesystem fixtures created in a tmpdir per test.
 */

function makeTmpRepo(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'roam-git-'));
}

function writeGit(repo: string, structure: Record<string, string>): void {
  const gitDir = path.join(repo, '.git');
  fs.mkdirSync(gitDir, { recursive: true });
  for (const [rel, contents] of Object.entries(structure)) {
    const target = path.join(gitDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }
}

describe('readGitBranchAtPath', () => {
  let tmp: string;

  beforeEach(() => {
    invalidateGitBranchCache();
    tmp = makeTmpRepo();
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('returns the branch name for a symbolic ref HEAD', () => {
    writeGit(tmp, { HEAD: 'ref: refs/heads/main\n' });
    expect(readGitBranchAtPath(tmp)).toBe('main');
  });

  it('parses branches with slashes ("feat/roam")', () => {
    writeGit(tmp, { HEAD: 'ref: refs/heads/feat/roam\n' });
    expect(readGitBranchAtPath(tmp)).toBe('feat/roam');
  });

  it('returns a short SHA prefix for a detached HEAD', () => {
    writeGit(tmp, { HEAD: 'abcdef1234567890abcdef1234567890abcdef12\n' });
    expect(readGitBranchAtPath(tmp)).toBe('@abcdef1');
  });

  it('returns undefined when no .git exists', () => {
    expect(readGitBranchAtPath(tmp)).toBeUndefined();
  });

  it('returns undefined when .git/HEAD is missing', () => {
    fs.mkdirSync(path.join(tmp, '.git'));
    expect(readGitBranchAtPath(tmp)).toBeUndefined();
  });

  it('follows a .git file (worktree pointer)', () => {
    // Create a real gitdir elsewhere, then a .git file pointing at it.
    const realGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'roam-gitdir-'));
    fs.writeFileSync(path.join(realGitDir, 'HEAD'), 'ref: refs/heads/worktree-branch\n');
    fs.writeFileSync(path.join(tmp, '.git'), `gitdir: ${realGitDir}\n`);
    try {
      expect(readGitBranchAtPath(tmp)).toBe('worktree-branch');
    } finally {
      fs.rmSync(realGitDir, { recursive: true, force: true });
    }
  });

  it('caches results within the TTL', () => {
    writeGit(tmp, { HEAD: 'ref: refs/heads/main\n' });
    expect(readGitBranchAtPath(tmp)).toBe('main');

    // Change on disk; cache should still return the old value.
    fs.writeFileSync(path.join(tmp, '.git', 'HEAD'), 'ref: refs/heads/other\n');
    expect(readGitBranchAtPath(tmp)).toBe('main');

    // After invalidation, the fresh value is picked up.
    invalidateGitBranchCache();
    expect(readGitBranchAtPath(tmp)).toBe('other');
  });
});
