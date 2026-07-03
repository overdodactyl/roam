import * as fs from 'fs';
import * as path from 'path';

const REF_HEAD_PREFIX = 'ref: refs/heads/';
const TTL_MS = 15_000;

interface CacheEntry {
  branch: string | undefined;
  timestamp: number;
}

/**
 * Best-effort git branch lookup by reading .git/HEAD directly. Used as a
 * fallback when the built-in git extension hasn't adopted a repo — which
 * happens for repos outside the currently-open workspace (i.e. most of
 * our bookmarks).
 *
 * Only looks at the bookmark path itself. If .git isn't there, returns
 * undefined — we deliberately don't walk up to find an enclosing repo,
 * because a bookmark "inside" a repo isn't really the repo's root and
 * showing the branch there would be misleading.
 */
const cache = new Map<string, CacheEntry>();

export function readGitBranchAtPath(dirPath: string): string | undefined {
  const cached = cache.get(dirPath);
  if (cached && Date.now() - cached.timestamp < TTL_MS) {
    return cached.branch;
  }
  const branch = compute(dirPath);
  cache.set(dirPath, { branch, timestamp: Date.now() });
  return branch;
}

export function invalidateGitBranchCache(): void {
  cache.clear();
}

function compute(dirPath: string): string | undefined {
  const gitPath = path.join(dirPath, '.git');
  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(gitPath, { throwIfNoEntry: false }) ?? undefined;
  } catch {
    return undefined;
  }
  if (!stat) {
    return undefined;
  }

  // .git can be a directory (normal repo) or a file (worktree / submodule
  // pointer). Both cases resolve HEAD via a file at gitDir/HEAD.
  let gitDir = gitPath;
  if (stat.isFile()) {
    try {
      const pointer = fs.readFileSync(gitPath, 'utf8').trim();
      const match = pointer.match(/^gitdir:\s*(.+)$/);
      if (!match) {
        return undefined;
      }
      const target = match[1];
      gitDir = path.isAbsolute(target) ? target : path.resolve(dirPath, target);
    } catch {
      return undefined;
    }
  }

  const headPath = path.join(gitDir, 'HEAD');
  let head: string;
  try {
    head = fs.readFileSync(headPath, 'utf8').trim();
  } catch {
    return undefined;
  }

  if (head.startsWith(REF_HEAD_PREFIX)) {
    return head.slice(REF_HEAD_PREFIX.length);
  }
  // Detached HEAD — show short SHA prefixed to distinguish from a branch.
  return `@${head.slice(0, 7)}`;
}
