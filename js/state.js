// GitState — Core state management for Git simulation
// All mutations go through named methods. No external code should modify state directly.

var GitTutorial = window.GitTutorial || {};

(function() {
  'use strict';

  function generateHash() {
    var chars = '0123456789abcdef';
    var hash = '';
    for (var i = 0; i < 7; i++) {
      hash += chars[Math.floor(Math.random() * 16)];
    }
    return hash;
  }

  function GitState() {
    this.initialized = false;
    this.workingDir = {};    // { filename: { content, status } }
    this.staging = {};       // { filename: { content } }
    this.commits = [];       // [{ hash, message, files, parent, timestamp }]
    this.branches = {};      // { name: commitHash }
    this.currentBranch = 'main';
    this.HEAD = null;        // commitHash
    this.remote = {          // simulated remote
      commits: [],
      branches: {},
      url: null              // set by `git remote add <name> <url>`
    };
    this.stash = [];
    this.tags = {};          // { name: commitHash }
    this.config = {          // `git config` values, local + global
      local: {},
      global: {}
    };
    this.mergeConflict = null;  // [filenames] with unresolved <<<<<<< markers
    this.mergeConflictKinds = null;  // { path: 'content' | 'modify/delete' | 'add/add' }
    this.pendingMerge = null;   // { branch, targetHash } waiting for a resolution commit
    this.commandHistory = [];
    this.lastCommand = null;
  }

  // === Init ===
  GitState.prototype.init = function() {
    if (this.initialized) {
      return { success: true, output: '仓库已经初始化过了，无需重复操作。' };
    }
    this.initialized = true;
    this.currentBranch = 'main';
    this.branches['main'] = null;
    return { success: true, output: 'Initialized empty Git repository' };
  };

  // === File operations ===
  GitState.prototype.createFile = function(filename, content) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    // Only a genuinely missing value falls back to the placeholder. An empty
    // string is a legitimate file body (`touch f` and `echo "" > f` both
    // create an empty file), so it must not be overwritten.
    if (content === undefined || content === null) {
      content = 'hello world';
    }
    this.workingDir[filename] = { content: content, status: 'new' };
    return { success: true, output: '创建文件: ' + filename };
  };

  GitState.prototype.modifyFile = function(filename, content) {
    if (!this.workingDir[filename]) {
      return { success: false, output: '文件不存在: ' + filename };
    }
    this.workingDir[filename].content = content;
    this.workingDir[filename].status = 'modified';
    return { success: true, output: '修改文件: ' + filename };
  };

  GitState.prototype.deleteFile = function(filename) {
    if (!this.workingDir[filename]) {
      return { success: false, output: '文件不存在: ' + filename };
    }

    // A tracked file stays in the tree as a pending deletion so `git status`
    // can report it and `git add` can stage the removal. Only untracked files
    // disappear outright.
    var headCommit = this.HEAD ? this._getCommit(this.HEAD) : null;
    var tracked = !!(headCommit && headCommit.files && headCommit.files[filename]);

    if (tracked) {
      this.workingDir[filename].status = 'deleted';
      return { success: true, output: '删除文件: ' + filename + ' (已跟踪，需 git add 暂存删除)' };
    }

    delete this.workingDir[filename];
    if (this.staging[filename]) {
      delete this.staging[filename];
    }
    return { success: true, output: '删除文件: ' + filename };
  };

  // === Git Add ===
  // Stage a single path. Returns true when the file actually had a change to stage.
  GitState.prototype._stagePath = function(filename) {
    var wd = this.workingDir[filename];
    if (!wd) return false;

    if (wd.status === 'deleted') {
      this.staging[filename] = { content: '', deleted: true };
      return true;
    }

    // Nothing to do when the file is already committed and unchanged.
    if (wd.status === 'committed') return false;

    this.staging[filename] = { content: wd.content };
    wd.status = 'staged';
    return true;
  };

  // Mark a conflicted file as resolved once it is staged again.
  GitState.prototype._resolveConflict = function(filename) {
    if (!this.mergeConflict || this.mergeConflict.length === 0) return;
    var idx = this.mergeConflict.indexOf(filename);
    if (idx !== -1) {
      this.mergeConflict.splice(idx, 1);
      if (this.mergeConflictKinds) delete this.mergeConflictKinds[filename];
    }
  };

  GitState.prototype.add = function(filename) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    if (filename === '.') {
      // add all — only count files that actually have a change to stage
      var count = 0;
      var names = [];
      for (var f in this.workingDir) {
        if (this._stagePath(f)) {
          count++;
          names.push(f);
          this._resolveConflict(f);
        }
      }
      if (count === 0) {
        return { success: false, output: '没有文件可以暂存' };
      }
      var suffix = this.mergeConflict && this.mergeConflict.length > 0
        ? '\n仍有冲突未解决: ' + this.mergeConflict.join(', ')
        : '';
      return { success: true, output: '暂存了 ' + count + ' 个文件: ' + names.join(', ') + suffix };
    }

    if (!this.workingDir[filename]) {
      return { success: false, output: '文件不存在: ' + filename };
    }

    this._stagePath(filename);
    this._resolveConflict(filename);

    var msg = '暂存文件: ' + filename;
    if (this.mergeConflict && this.mergeConflict.length > 0) {
      msg += '\n仍有冲突未解决: ' + this.mergeConflict.join(', ');
    } else if (this.mergeConflict && this.mergeConflict.length === 0) {
      msg += '\n所有冲突已解决，现在可以 git commit 完成合并。';
    }
    return { success: true, output: msg };
  };

  // === Git Commit ===
  GitState.prototype.commit = function(message) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    // A merge with unresolved conflicts must be finished before committing.
    if (this.mergeConflict && this.mergeConflict.length > 0) {
      return {
        success: false,
        output: 'error: 存在未解决的合并冲突，无法提交。\n' +
                '冲突文件: ' + this.mergeConflict.join(', ') + '\n' +
                '请编辑文件删除 <<<<<<< / ======= / >>>>>>> 标记，然后 git add <file> 标记为已解决。'
      };
    }

    var stagedFiles = Object.keys(this.staging);
    if (stagedFiles.length === 0) {
      return { success: true, output: 'nothing to commit, working tree clean' };
    }

    var userMessage = message;
    message = message || 'update';

    // Build the snapshot by starting from the current HEAD tree and applying the
    // staged changes on top. A Git commit is a *cumulative* snapshot: it must keep
    // every file already tracked, not only the ones staged this time. Building it
    // from staging alone silently drops all previously committed files.
    var files = {};
    var headCommit = this.HEAD ? this._getCommit(this.HEAD) : null;
    if (headCommit && headCommit.files) {
      for (var hf in headCommit.files) {
        files[hf] = { content: headCommit.files[hf].content };
      }
    }

    for (var i = 0; i < stagedFiles.length; i++) {
      var fname = stagedFiles[i];
      var entry = this.staging[fname];
      if (entry && entry.deleted) {
        delete files[fname];
      } else {
        files[fname] = { content: entry.content };
      }
    }

    var hash = generateHash();
    var commit = {
      hash: hash,
      message: message,
      files: files,
      parent: this.HEAD,
      timestamp: Date.now(),
      branch: this.currentBranch,
      author: this._authorName()
    };

    // If a conflicted merge was just resolved, record the second parent so the
    // graph shows a real merge commit. The user's own message is kept — real git
    // only falls back to "Merge branch 'x'" when no -m is supplied.
    var pending = this.pendingMerge;
    if (pending) {
      commit.mergeParent = pending.targetHash;
      if (!userMessage) {
        commit.message = "Merge branch '" + pending.branch + "' into " + this.currentBranch;
      }
      this.pendingMerge = null;
    }

    this.commits.push(commit);
    this.HEAD = hash;
    // In detached HEAD there is no branch to advance.
    if (this.currentBranch) {
      this.branches[this.currentBranch] = hash;
    }

    // Clear staging and settle the working dir into committed state.
    this.staging = {};
    for (var f in this.workingDir) {
      if (this.workingDir[f].status !== 'committed') {
        this.workingDir[f].status = 'committed';
      }
    }
    // Files deleted in this commit leave the working dir entirely.
    for (var df in this.workingDir) {
      if (!(df in files)) {
        delete this.workingDir[df];
      }
    }

    var branchLabel = this.currentBranch || 'detached HEAD';
    return {
      success: true,
      output: '[' + branchLabel + ' ' + hash + '] ' + message,
      hash: hash,
      files: Object.keys(files)
    };
  };

  // === Git Status ===
  GitState.prototype.getStatus = function() {
    if (!this.initialized) {
      return { success: true, output: '尚未初始化仓库。请输入 git init 开始。' };
    }

    var lines = [];
    var headCommit = this.HEAD ? this._getCommit(this.HEAD) : null;
    if (this.currentBranch) {
      lines.push('On branch ' + this.currentBranch);
    } else {
      lines.push('HEAD detached at ' + (this.HEAD ? this.HEAD.substring(0, 7) : '(none)'));
    }

    if (this.mergeConflict && this.mergeConflict.length > 0) {
      lines.push('');
      lines.push('You have unmerged paths.');
      lines.push('  (fix conflicts and run "git commit")');
      lines.push('  (use "git add <file>..." to mark resolution)');
      lines.push('');
      for (var mc = 0; mc < this.mergeConflict.length; mc++) {
        var cPath = this.mergeConflict[mc];
        var kind = (this.mergeConflictKinds && this.mergeConflictKinds[cPath]) || 'content';
        var label = kind === 'modify/delete' ? 'deleted by them:' :
                    kind === 'add/add' ? 'both added:' : 'both modified:';
        lines.push('\t' + label + '   ' + cPath);
      }
    }

    var staged = [];
    var modified = [];
    var untracked = [];
    var deleted = [];

    for (var f in this.workingDir) {
      var st = this.workingDir[f].status;
      // A conflicted path is reported only under "Unmerged paths".
      if (this.mergeConflict && this.mergeConflict.indexOf(f) !== -1) {
        continue;
      }
      if (st === 'staged') {
        staged.push(f);
      } else if (st === 'modified') {
        modified.push(f);
      } else if (st === 'new') {
        untracked.push(f);
      } else if (st === 'deleted') {
        // A deletion that is already staged belongs under "to be committed",
        // not under the unstaged changes.
        if (this.staging[f] && this.staging[f].deleted) {
          staged.push(f);
        } else {
          deleted.push(f);
        }
      }
    }

    // Staged deletions of files no longer in the working dir
    for (var sf in this.staging) {
      if (this.staging[sf].deleted && staged.indexOf(sf) === -1) {
        staged.push(sf);
      }
    }

    var hasConflict = this.mergeConflict && this.mergeConflict.length > 0;
    if (!hasConflict && staged.length === 0 && modified.length === 0 && untracked.length === 0 && deleted.length === 0) {
      lines.push('nothing to commit, working tree clean');
    } else if (hasConflict && staged.length === 0 && modified.length === 0 && untracked.length === 0 && deleted.length === 0) {
      // Unmerged paths alone still mean the tree is not clean.
      lines.push('');
      lines.push('no changes added to commit (resolve conflicts and run "git commit")');
    } else {
      if (staged.length > 0) {
        lines.push('\nChanges to be committed:');
        for (var i = 0; i < staged.length; i++) {
          lines.push('  (use "git restore --staged <file>..." to unstage)');
          var entry = this.staging[staged[i]];
          var inHead = !!(headCommit && headCommit.files && headCommit.files[staged[i]]);
          var label;
          if (entry && entry.deleted) {
            label = 'deleted:   ';
          } else if (inHead) {
            label = 'modified:  ';
          } else {
            label = 'new file:  ';
          }
          lines.push('\t' + label + staged[i]);
        }
      }
      if (modified.length > 0) {
        lines.push('\nChanges not staged for commit:');
        for (var j = 0; j < modified.length; j++) {
          lines.push('  (use "git add <file>..." to update what will be committed)');
          lines.push('\tmodified:   ' + modified[j]);
        }
      }
      if (deleted.length > 0) {
        lines.push('\nChanges not staged for commit:');
        for (var d = 0; d < deleted.length; d++) {
          lines.push('  (use "git add/rm <file>..." to update what will be committed)');
          lines.push('\tdeleted:    ' + deleted[d]);
        }
      }
      if (untracked.length > 0) {
        lines.push('\nUntracked files:');
        for (var k = 0; k < untracked.length; k++) {
          lines.push('\t' + untracked[k]);
        }
      }
    }

    return { success: true, output: lines.join('\n') };
  };

  // === Diff Helper: LCS-based line diff with hunk grouping ===
  GitState.prototype._formatDiff = function(fname, oldContent, newContent) {
    var oldLines = oldContent === '' ? [] : oldContent.split('\n');
    var newLines = newContent === '' ? [] : newContent.split('\n');
    var m = oldLines.length, n = newLines.length;

    // LCS table
    var dp = [];
    for (var i = 0; i <= m; i++) {
      dp[i] = [];
      for (var j = 0; j <= n; j++) {
        if (i === 0 || j === 0) dp[i][j] = 0;
        else if (oldLines[i - 1] === newLines[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
        else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }

    // Backtrack to produce diff entries
    var raw = [];
    i = m; j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        raw.unshift({ type: ' ', line: oldLines[i - 1], oldLine: i, newLine: j });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        raw.unshift({ type: '+', line: newLines[j - 1], newLine: j });
        j--;
      } else {
        raw.unshift({ type: '-', line: oldLines[i - 1], oldLine: i });
        i--;
      }
    }

    // Group into hunks (3 lines context)
    var CONTEXT = 3;
    var hunks = [];
    var current = null;

    for (var k = 0; k < raw.length; k++) {
      if (raw[k].type !== ' ') {
        // Change line — start or extend hunk
        var start = Math.max(0, k - CONTEXT);
        var end = Math.min(raw.length - 1, k + CONTEXT);
        if (!current || start > current.end + 1) {
          if (current) hunks.push(current);
          current = { start: start, end: end };
        } else {
          current.end = end;
        }
      }
    }
    if (current) hunks.push(current);

    // Build output
    var result = [];
    result.push('diff --git a/' + fname + ' b/' + fname);
    result.push('--- a/' + fname);
    result.push('+++ b/' + fname);

    for (var h = 0; h < hunks.length; h++) {
      var hunk = hunks[h];
      var oldStart = -1, oldCount = 0, newStart = -1, newCount = 0;

      for (var l = hunk.start; l <= hunk.end; l++) {
        var e = raw[l];
        if (e.type === ' ' || e.type === '-') {
          if (oldStart === -1) oldStart = e.oldLine;
          oldCount++;
        }
        if (e.type === ' ' || e.type === '+') {
          if (newStart === -1) newStart = e.newLine;
          newCount++;
        }
      }

      if (oldStart === -1) oldStart = 0;
      if (newStart === -1) newStart = 0;
      result.push('@@ -' + oldStart + ',' + oldCount + ' +' + newStart + ',' + newCount + ' @@');
      for (var l = hunk.start; l <= hunk.end; l++) {
        // Unified diff prefixes carry no separator: context is a single leading
        // space, additions start with '+' and deletions with '-'.
        result.push(raw[l].type + raw[l].line);
      }
    }

    return result.join('\n');
  };

  // === Git Diff ===
  GitState.prototype.diff = function(filename) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }

    var result = [];
    var files = filename ? [filename] : Object.keys(this.workingDir);
    for (var i = 0; i < files.length; i++) {
      var fname = files[i];
      var wd = this.workingDir[fname];
      var st = this.staging[fname];

      if (!wd) continue;

      var wdContent = wd.content || '';
      var stContent = st ? st.content : '';
      var committedContent = '';

      if (this.HEAD) {
        var lastCommit = this._getCommit(this.HEAD);
        if (lastCommit && lastCommit.files[fname]) {
          committedContent = lastCommit.files[fname].content || '';
        }
      }

      var compareContent = st ? stContent : committedContent;
      if (wdContent !== compareContent) {
        result.push(this._formatDiff(fname, compareContent, wdContent));
      }
    }

    if (result.length === 0) {
      return { success: true, output: '' };
    }
    return { success: true, output: result.join('\n') };
  };

  // === Git Diff --staged ===
  GitState.prototype.diffStaged = function() {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }

    var result = [];
    for (var fname in this.staging) {
      var stContent = this.staging[fname].content || '';
      var committedContent = '';

      if (this.HEAD) {
        var lastCommit = this._getCommit(this.HEAD);
        if (lastCommit && lastCommit.files[fname]) {
          committedContent = lastCommit.files[fname].content || '';
        }
      }

      if (stContent !== committedContent) {
        result.push(this._formatDiff(fname, committedContent, stContent));
      }
    }

    if (result.length === 0) {
      return { success: true, output: '' };
    }
    return { success: true, output: result.join('\n') };
  };

  // === Git Log ===
  GitState.prototype.log = function(count) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    if (!this.HEAD) {
      return { success: true, output: '还没有提交记录' };
    }

    var lines = [];
    var current = this.HEAD;
    var limit = count || 20;
    var shown = 0;

    while (current && shown < limit) {
      var commit = this._getCommit(current);
      if (!commit) break;

      var decorations = [];
      if (commit.hash === this.HEAD) {
        decorations.push('HEAD');
      }
      // A commit that is the tip of a branch gets that branch name
      for (var b in this.branches) {
        if (this.branches[b] === commit.hash) decorations.push(b);
      }
      // First parent is the primary branch; later parents are merged-in branches
      var prefix = decorations.length > 0 ? ' (' + decorations.join(', ') + ')' : '';
      lines.push('commit ' + commit.hash + prefix);
      if (commit.mergeParent) {
        lines.push('Merge: ' + commit.parent.substring(0, 7) + ' ' + commit.mergeParent.substring(0, 7));
      }
      lines.push('    ' + commit.message);
      lines.push('');
      current = commit.parent;
      shown++;
    }

    return { success: true, output: lines.join('\n') };
  };

  // === Git Branch ===
  GitState.prototype.branch = function(name) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }

    if (!name) {
      // List branches
      var lines = [];
      for (var b in this.branches) {
        var prefix = (b === this.currentBranch) ? '* ' : '  ';
        lines.push(prefix + b);
      }
      return { success: true, output: lines.join('\n') };
    }

    if (name in this.branches) {
      return { success: false, output: "fatal: A branch named '" + name + "' already exists." };
    }

    if (!this.HEAD) {
      return { success: false, output: "fatal: Not a valid object name: '" + this.currentBranch + "'." };
    }

    this.branches[name] = this.HEAD;
    return { success: true, output: "创建分支: " + name };
  };

  // === Git Checkout / Switch ===
  GitState.prototype.checkout = function(target) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }

    if (!(target in this.branches)) {
      return { success: false, output: "error: pathspec '" + target + "' did not match any file(s) known to git" };
    }

    this.currentBranch = target;
    this.HEAD = this.branches[target];
    this.mergeConflict = null;
    this.mergeConflictKinds = null;
    this.pendingMerge = null;

    // Update working dir to match the commit
    this._syncWorkingDirToCommit(this.HEAD);

    return { success: true, output: "Switched to branch '" + target + "'" };
  };

  GitState.prototype.checkoutCommit = function(hash){
    if(!this.initialized){
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    var commit = this._resolveRevision(hash);
    if (commit && commit.error) return { success: false, output: commit.error };
    if(!commit){
      return { success: false, output: "fatal: Not a valid object name: '" + hash + "'." };
    }
    this.HEAD = commit.hash;
    this.currentBranch = null;
    this.mergeConflict = null;
    this.mergeConflictKinds = null;
    this.pendingMerge = null;
    this._syncWorkingDirToCommit(commit.hash);
    return {
      success: true,
      output: "Note: switching to '" + commit.hash.substring(0, 7) + "'.\n" +
              "You are in 'detached HEAD' state.\n" +
              "Switched to commit '" + commit.hash.substring(0, 7) + "'"
    };

  }

  GitState.prototype.checkoutCommitNewBranch = function(name, hash){
    if(!this.initialized){
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    var commit = this._resolveRevision(hash);
    if (commit && commit.error) return { success: false, output: commit.error };
    if(!commit){
      return { success: false, output: "fatal: Not a valid object name: '" + hash + "'." };
    }
    if (name in this.branches) {
      return { success: false, output: "fatal: A branch named '" + name + "' already exists." };
    }
    this.HEAD = commit.hash;
    this.branches[name] = commit.hash;
    this.currentBranch = name;
    this.mergeConflict = null;
    this.mergeConflictKinds = null;
    this.pendingMerge = null;
    this._syncWorkingDirToCommit(commit.hash);
    return { success: true, output: "Switched to a new branch '" + name + "'" };
  }

  GitState.prototype.checkoutNewBranch = function(name) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    if (name in this.branches) {
      return { success: false, output: "fatal: A branch named '" + name + "' already exists." };
    }

    this.branches[name] = this.HEAD;
    this.currentBranch = name;
    return { success: true, output: "Switched to a new branch '" + name + "'" };
  };

  GitState.prototype.switchCmd = function(target) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }

    if (target === '-c') {
      return { success: false, output: '用法: git switch -c <branch-name>' };
    }

    if (!(target in this.branches)) {
      return { success: false, output: "fatal: invalid branch name: '" + target + "'" };
    }

    return this.checkout(target);
  };

  GitState.prototype.switchNewBranch = function(name) {
    return this.checkoutNewBranch(name);
  };

  // === Git Merge ===
  GitState.prototype.merge = function(branch) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    if (!(branch in this.branches)) {
      return { success: false, output: "error: The branch '" + branch + "' is not found." };
    }
    if (!this.branches[branch]) {
      return { success: false, output: "error: branch '" + branch + "' does not have any commits yet." };
    }
    if (branch === this.currentBranch) {
      return { success: false, output: "Already on '" + this.currentBranch + "'" };
    }

    var targetHash = this.branches[branch];
    var currentHash = this.HEAD;

    if (!currentHash) {
      // Nothing on our side yet — fast-forward onto the target.
      this.HEAD = targetHash;
      if (this.currentBranch) this.branches[this.currentBranch] = targetHash;
      this._syncWorkingDirToCommit(targetHash);
      return {
        success: true,
        output: "Fast-forward\nMerge complete: " + branch + " → " + this.currentBranch
      };
    }

    // Check if fast-forward possible
    if (this._isAncestor(currentHash, targetHash)) {
      // Fast-forward
      this.HEAD = targetHash;
      if (this.currentBranch) this.branches[this.currentBranch] = targetHash;
      this._syncWorkingDirToCommit(targetHash);

      return {
        success: true,
        output: "Updating " + currentHash.substring(0, 7) + ".." + targetHash.substring(0, 7) + "\nFast-forward\nMerge complete: " + branch + " → " + this.currentBranch
      };
    }

    // Already up to date when the target is an ancestor of HEAD
    if (this._isAncestor(targetHash, currentHash)) {
      return { success: true, output: "Already up to date." };
    }

    var targetCommit = this._getCommit(targetHash);
    var currentCommit = this._getCommit(currentHash);

    if (!targetCommit || !currentCommit) {
      return { success: false, output: 'merge: 无法找到提交' };
    }

    // === Real three-way merge against the common ancestor ===
    var baseHash = this._mergeBase(currentHash, targetHash);
    var baseCommit = baseHash ? this._getCommit(baseHash) : null;
    var baseFiles = (baseCommit && baseCommit.files) || {};
    var ourFiles = currentCommit.files || {};
    var theirFiles = targetCommit.files || {};

    // Union of every path touched by either side
    var allPaths = {};
    for (var bp in baseFiles) allPaths[bp] = true;
    for (var op in ourFiles) allPaths[op] = true;
    for (var tp in theirFiles) allPaths[tp] = true;

    var mergedFiles = {};
    var conflicts = [];
    var conflictKinds = {};   // path → 'content' | 'modify/delete' | 'add/add'

    for (var path in allPaths) {
      var baseEntry = baseFiles[path];
      var ourEntry = ourFiles[path];
      var theirEntry = theirFiles[path];

      var baseContent = baseEntry ? baseEntry.content : '';
      var ourContent = ourEntry ? ourEntry.content : '';
      var theirContent = theirEntry ? theirEntry.content : '';

      var baseExists = !!baseEntry;
      var ourExists = !!ourEntry;
      var theirExists = !!theirEntry;

      // Deletion handling
      if (ourExists !== theirExists) {
        var deletedSide = ourExists ? 'theirs' : 'ours';
        var keptContent = ourExists ? ourContent : theirContent;
        var baseForKept = baseContent;
        var keptExists = ourExists || theirExists;

        if (!baseExists) {
          // Added on one side only
          mergedFiles[path] = { content: keptContent };
          continue;
        }
        // One side deleted, the other left it untouched → accept the deletion
        if (keptContent === baseForKept) {
          continue;
        }
        // One side deleted while the other modified → conflict
        conflicts.push(path);
        conflictKinds[path] = 'modify/delete';
        mergedFiles[path] = {
          content: ourExists
            ? '<<<<<<< HEAD\n' + ourContent + '\n=======\n>>>>>>> ' + branch
            : '<<<<<<< HEAD\n=======\n' + theirContent + '\n>>>>>>> ' + branch
        };
        continue;
      }

      if (!ourExists && !theirExists) {
        // Deleted on both sides
        continue;
      }

      if (!baseExists && ourExists && theirExists) {
        // Added on both sides
        if (ourContent === theirContent) {
          mergedFiles[path] = { content: ourContent };
        } else {
          conflicts.push(path);
          conflictKinds[path] = 'add/add';
          mergedFiles[path] = {
            content: '<<<<<<< HEAD\n' + ourContent + '\n=======\n' + theirContent + '\n>>>>>>> ' + branch
          };
        }
        continue;
      }

      var res = this._mergeFileContent(baseContent, ourContent, theirContent, branch);
      mergedFiles[path] = { content: res.content };
      if (res.conflict) {
        conflicts.push(path);
        conflictKinds[path] = 'content';
      }
    }

    // Apply the merged result to the working dir
    this.workingDir = {};
    this.staging = {};
    for (var mf in mergedFiles) {
      var isConflicted = conflicts.indexOf(mf) !== -1;
      this.workingDir[mf] = {
        content: mergedFiles[mf].content,
        status: isConflicted ? 'modified' : 'committed'
      };
    }

    if (conflicts.length > 0) {
      // Block the merge: the user must resolve conflicts, add, then commit.
      this.mergeConflict = conflicts;
      this.mergeConflictKinds = conflictKinds;
      this.pendingMerge = { branch: branch, targetHash: targetHash };
      var conflictLines = [];
      for (var ci = 0; ci < conflicts.length; ci++) {
        conflictLines.push('CONFLICT (' + (conflictKinds[conflicts[ci]] || 'content') + '): Merge conflict in ' + conflicts[ci]);
      }
      var msg = [
        'Auto-merging failed. Fix conflicts and then commit the result.',
        ''
      ].concat(conflictLines).concat([
        '',
        '冲突标记说明:',
        '  <<<<<<< HEAD        ← 当前分支的内容',
        '  =======',
        '  >>>>>>> ' + branch + '  ← 要合并进来的内容',
        '',
        '解决步骤:',
        '  1. 双击工作区里的冲突文件，编辑内容并删除冲突标记',
        '  2. git add <file>   标记为已解决',
        '  3. git commit -m "msg"   完成合并'
      ]).join('\n');
      return { success: false, output: msg };
    }

    // Clean merge — create the merge commit
    var hash = generateHash();
    var mergeCommit = {
      hash: hash,
      message: "Merge branch '" + branch + "' into " + this.currentBranch,
      files: mergedFiles,
      parent: currentHash,
      timestamp: Date.now(),
      branch: this.currentBranch,
      mergeParent: targetHash
    };

    this.commits.push(mergeCommit);
    this.HEAD = hash;
    if (this.currentBranch) this.branches[this.currentBranch] = hash;

    return {
      success: true,
      output: "Merge made by the 'ort' strategy.\nMerge made: '" + branch + "' → '" + this.currentBranch + "'\ncommit " + hash
    };
  };

  // Replace the working dir + index with the tree of a commit.
  GitState.prototype._syncWorkingDirToCommit = function(hash) {
    var commit = this._getCommit(hash);
    this.workingDir = {};
    this.staging = {};
    if (commit && commit.files) {
      for (var f in commit.files) {
        this.workingDir[f] = { content: commit.files[f].content, status: 'committed' };
      }
    }
  };

  // Pull remote-only commits into the local object store.
  GitState.prototype._importRemoteCommits = function() {
    for (var j = 0; j < this.remote.commits.length; j++) {
      var rc = this.remote.commits[j];
      if (!this._getCommit(rc.hash)) {
        this.commits.push(rc);
      }
    }
  };

  // === Git Push ===
  GitState.prototype.push = function(remote, branch) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    remote = remote || 'origin';
    // Default to the current branch, but a named branch must actually be pushed.
    branch = branch || this.currentBranch;

    if (!branch) {
      return { success: false, output: 'error: 处于 detached HEAD，请指定要推送的分支名' };
    }
    if (!(branch in this.branches)) {
      return { success: false, output: "error: src refspec " + branch + " does not match any" };
    }

    var branchHash = this.branches[branch];
    if (!branchHash) {
      return { success: false, output: 'error: 分支 ' + branch + ' 还没有任何提交' };
    }

    // A push that would drop remote commits must be refused, exactly like git.
    var remoteTip = this.remote.branches[branch];
    if (remoteTip && remoteTip !== branchHash && !this._isAncestor(remoteTip, branchHash)) {
      return {
        success: false,
        output: 'To ' + remote + '\n' +
                ' ! [rejected]        ' + branch + ' -> ' + branch + ' (non-fast-forward)\n' +
                'error: failed to push some refs to \'' + remote + '\'\n' +
                'hint: 远程包含你本地没有的提交，请先 git pull 再推送。'
      };
    }

    if (remoteTip === branchHash) {
      return { success: true, output: 'Everything up-to-date' };
    }

    // Collect every commit reachable from the branch tip that the remote lacks.
    var current = branchHash;
    var commitsToPush = [];
    while (current) {
      var found = false;
      for (var i = 0; i < this.remote.commits.length; i++) {
        if (this.remote.commits[i].hash === current) { found = true; break; }
      }
      if (found) break;

      var commit = this._getCommit(current);
      if (!commit) break;
      commitsToPush.unshift(commit);
      current = commit.parent;
    }

    for (var j = 0; j < commitsToPush.length; j++) {
      this.remote.commits.push(commitsToPush[j]);
    }

    var isNew = !remoteTip;
    this.remote.branches[branch] = branchHash;

    return {
      success: true,
      output: 'Enumerating objects: ' + commitsToPush.length + '\n' +
              'Writing objects: 100%\n' +
              'To ' + remote + '\n' +
              ' * [' + (isNew ? 'new branch' : 'updated') + ']      ' + branch + ' -> ' + branch
    };
  };

  // === Git Pull ===
  GitState.prototype.pull = function(remote, branch) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    remote = remote || 'origin';
    branch = branch || this.currentBranch;

    if (!this.remote.branches[branch]) {
      return { success: false, output: "couldn't find remote ref " + branch };
    }

    var remoteHash = this.remote.branches[branch];
    var remoteCommit = null;
    for (var i = 0; i < this.remote.commits.length; i++) {
      if (this.remote.commits[i].hash === remoteHash) {
        remoteCommit = this.remote.commits[i];
        break;
      }
    }

    if (!remoteCommit) {
      return { success: false, output: '远程没有新的提交' };
    }

    // Guard 1: uncommitted work must not be silently destroyed by the checkout
    // that a pull performs. Real git aborts before touching the working tree.
    var dirty = [];
    for (var df in this.workingDir) {
      if (this.workingDir[df].status !== 'committed') dirty.push(df);
    }
    for (var sf in this.staging) {
      if (dirty.indexOf(sf) === -1) dirty.push(sf);
    }
    if (dirty.length > 0) {
      return {
        success: false,
        output: 'error: 本地有未提交的修改，pull 会覆盖它们。\n' +
                '  ' + dirty.join('\n  ') + '\n' +
                '请先 git commit 或 git stash，再 pull。'
      };
    }

    var localHash = this.HEAD;

    // Guard 2: only fast-forward when the local branch really is behind.
    // If HEAD is not an ancestor of the remote tip the histories diverged, and
    // blindly resetting to the remote hash would orphan local commits.
    if (localHash && !this._isAncestor(localHash, remoteHash)) {
      if (this._isAncestor(remoteHash, localHash)) {
        return { success: true, output: 'Already up to date.' };
      }
      // Merge the remote tip into the current branch instead of discarding work.
      this._importRemoteCommits();
      var baseHash = this._mergeBase(localHash, remoteHash);
      var baseCommit = baseHash ? this._getCommit(baseHash) : null;
      var baseFiles = (baseCommit && baseCommit.files) || {};
      var ourCommit = this._getCommit(localHash);
      var ourFiles = (ourCommit && ourCommit.files) || {};
      var mergedFiles = {};
      var conflicts = [];
      var paths = {};
      for (var bp in baseFiles) paths[bp] = true;
      for (var op in ourFiles) paths[op] = true;
      for (var tp in remoteCommit.files) paths[tp] = true;

      for (var path in paths) {
        var b = baseFiles[path] ? baseFiles[path].content : undefined;
        var o = ourFiles[path] ? ourFiles[path].content : undefined;
        var th = remoteCommit.files[path] ? remoteCommit.files[path].content : undefined;
        if (o === th || th === undefined) {
          if (o !== undefined) mergedFiles[path] = { content: o };
          continue;
        }
        if (o === undefined || b === o) {
          if (th !== undefined) mergedFiles[path] = { content: th };
          continue;
        }
        var res = this._mergeFileContent(b || '', o, th, 'origin/' + branch);
        mergedFiles[path] = { content: res.content };
        if (res.conflict) conflicts.push(path);
      }

      this.workingDir = {};
      this.staging = {};
      for (var mf in mergedFiles) {
        this.workingDir[mf] = {
          content: mergedFiles[mf].content,
          status: conflicts.indexOf(mf) !== -1 ? 'modified' : 'committed'
        };
      }

      if (conflicts.length > 0) {
        this.mergeConflict = conflicts;
        this.mergeConflictKinds = null;
        this.pendingMerge = { branch: 'origin/' + branch, targetHash: remoteHash };
        return {
          success: false,
          output: 'From ' + remote + '\n * branch            ' + branch + '     -> FETCH_HEAD\n' +
                  'error: 合并远程更新时产生冲突。\n冲突文件: ' + conflicts.join(', ') + '\n' +
                  '解决后 git add <file> 并 git commit。'
        };
      }

      var mergeHash = generateHash();
      this.commits.push({
        hash: mergeHash,
        message: "Merge branch '" + branch + "' of " + remote + " into " + this.currentBranch,
        files: mergedFiles,
        parent: localHash,
        mergeParent: remoteHash,
        timestamp: Date.now(),
        branch: this.currentBranch,
        author: this._authorName()
      });
      this.HEAD = mergeHash;
      if (this.currentBranch) this.branches[this.currentBranch] = mergeHash;

      return {
        success: true,
        output: 'From ' + remote + '\n * branch            ' + branch + '     -> FETCH_HEAD\n' +
                'Merge made by the \'ort\' strategy.\ncommit ' + mergeHash
      };
    }

    // Genuine fast-forward: the local tip is an ancestor of the remote tip.
    this.HEAD = remoteHash;
    if (this.currentBranch) this.branches[this.currentBranch] = remoteHash;

    this.workingDir = {};
    this.staging = {};
    if (remoteCommit.files) {
      for (var f in remoteCommit.files) {
        this.workingDir[f] = { content: remoteCommit.files[f].content, status: 'committed' };
      }
    }

    this._importRemoteCommits();

    return {
      success: true,
      output: "From " + remote + "\n * branch            " + branch + "     -> FETCH_HEAD\nFast-forward\n更新 " + remoteHash.substring(0, 7)
    };
  };

  // === Git Fetch ===
  GitState.prototype.fetch = function(remote) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    remote = remote || 'origin';

    if (this.remote.commits.length === 0) {
      return { success: true, output: '远程没有新的提交' };
    }

    return {
      success: true,
      output: "From " + remote + "\n * [new branch]      main       -> origin/main\n获取完成（未合并到本地）"
    };
  };

  // === Git Clone (simulated) ===
  GitState.prototype.clone = function(url) {
    // Reset state to simulate cloning into a fresh directory
    this.resetAll();
    this.initialized = true;
    this.currentBranch = 'main';

    // Create a sample commit
    var hash = generateHash();
    var sampleFiles = {
      'README.md': { content: '# ' + (url || 'My Project') + '\n\nWelcome to the project.' },
      'example.py': { content: 'def hello():\n    print("Hello from example.py")\n\nhello()\n' }
    };
    var commit = {
      hash: hash,
      message: 'Initial commit',
      files: sampleFiles,
      parent: null,
      timestamp: Date.now(),
      branch: 'main'
    };
    this.commits.push(commit);
    this.HEAD = hash;
    this.branches['main'] = hash;

    for (var f in sampleFiles) {
      this.workingDir[f] = { content: sampleFiles[f].content, status: 'committed' };
    }

    // Also set up remote
    this.remote.commits.push(commit);
    this.remote.branches['main'] = hash;

    return { success: true, output: "Cloning into '" + (url || 'repo') + "'...\ndone." };
  };

  // === Git Rebase ===
  GitState.prototype.rebase = function(target) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    if (!(target in this.branches)) {
      return { success: false, output: "invalid branch: " + target };
    }
    if (!this.branches[target]) {
      return { success: false, output: "error: branch '" + target + "' does not have any commits yet." };
    }
    if (target === this.currentBranch) {
      return { success: false, output: "Cannot rebase onto self" };
    }

    var targetHash = this.branches[target];
    var currentHash = this.HEAD;

    if (this._isAncestor(targetHash, currentHash)) {
      return { success: true, output: "Current branch is already up-to-date." };
    }

    // Rebase replays every commit unique to our branch on top of the target.
    var baseHash = this._mergeBase(currentHash, targetHash);
    var toReplay = [];
    var walk = currentHash;
    while (walk && walk !== baseHash) {
      var c = this._getCommit(walk);
      if (!c) break;
      toReplay.unshift(c);
      walk = c.parent;
    }

    var newHead = targetHash;
    var applied = 0;

    for (var i = 0; i < toReplay.length; i++) {
      var src = toReplay[i];
      var srcParent = src.parent ? this._getCommit(src.parent) : null;
      var baseFiles = (srcParent && srcParent.files) || {};
      var srcFiles = src.files || {};

      var headCommit = this._getCommit(newHead);
      var curFiles = (headCommit && headCommit.files) || {};

      var nextFiles = {};
      for (var k in curFiles) nextFiles[k] = { content: curFiles[k].content };

      var touched = {};
      for (var tf in srcFiles) touched[tf] = true;
      for (var bf in baseFiles) touched[bf] = true;

      var replayedConflicts = [];

      for (var path in touched) {
        var baseEntry = baseFiles[path];
        var srcEntry = srcFiles[path];
        var baseContent = baseEntry ? baseEntry.content : '';
        var srcContent = srcEntry ? srcEntry.content : '';
        var curContent = nextFiles[path] ? nextFiles[path].content : '';

        // Compare presence as well as content: a commit that ADDS an empty file
        // has baseContent === srcContent === '' but is still a real change.
        var baseExists = !!baseEntry;
        var srcExists = !!srcEntry;
        if (baseExists === srcExists && baseContent === srcContent) continue;

        // Explicit add / delete
        if (!baseExists && srcExists) {
          nextFiles[path] = { content: srcContent };
          continue;
        }
        if (baseExists && !srcExists) {
          delete nextFiles[path];
          continue;
        }

        var res = this._mergeFileContent(baseContent, curContent, srcContent, 'rebase');
        if (res.conflict) replayedConflicts.push(path);
        if (res.content === '' && srcContent === '') {
          delete nextFiles[path];
        } else {
          nextFiles[path] = { content: res.content };
        }
      }

      // A replayed commit that conflicts must stop the rebase, exactly like
      // git. Committing the markers would bake them into history and report a
      // successful rebase for work that never actually applied.
      if (replayedConflicts.length > 0) {
        // Keep the commits replayed so far: move the branch to the last one
        // that applied cleanly, then stop and hand control back to the user.
        this.HEAD = newHead;
        if (this.currentBranch) this.branches[this.currentBranch] = newHead;
        this.workingDir = {};
        this.staging = {};
        for (var wf in nextFiles) {
          this.workingDir[wf] = {
            content: nextFiles[wf].content,
            status: replayedConflicts.indexOf(wf) !== -1 ? 'modified' : 'committed'
          };
        }
        this.mergeConflict = replayedConflicts;
        this.mergeConflictKinds = null;
        this.pendingMerge = { branch: target, targetHash: targetHash };
        this._rebaseRemaining = toReplay.slice(i + 1);
        return {
          success: false,
          output: 'error: 无法应用 ' + src.hash.substring(0, 7) + '... ' + src.message + '\n' +
                  'CONFLICT (content): 冲突文件 ' + replayedConflicts.join(', ') + '\n' +
                  'rebase 已暂停。请解决冲突后 git add <file>，再 git commit 继续。'
        };
      }

      var newHash = generateHash();
      this.commits.push({
        hash: newHash,
        message: src.message,
        files: nextFiles,
        parent: newHead,
        timestamp: Date.now(),
        branch: this.currentBranch,
        author: src.author || this._authorName()
      });
      newHead = newHash;
      applied++;
    }

    this.HEAD = newHead;
    if (this.currentBranch) this.branches[this.currentBranch] = newHead;
    this._syncWorkingDirToCommit(newHead);

    return {
      success: true,
      output: "Successfully rebased and updated refs/heads/" + this.currentBranch + ".\n" +
              "replayed " + applied + " commit(s) onto " + target + "\ncommit " + newHead
    };
  };

  // === Git Stash ===
  GitState.prototype.stashSave = function(message) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }

    var hasChanges = false;
    for (var f in this.workingDir) {
      if (this.workingDir[f].status !== 'committed') {
        hasChanges = true;
        break;
      }
    }
    if (!hasChanges && Object.keys(this.staging).length === 0) {
      return { success: true, output: 'No local changes to save' };
    }

    this.stash.push({
      workingDir: JSON.parse(JSON.stringify(this.workingDir)),
      staging: JSON.parse(JSON.stringify(this.staging)),
      message: message || 'WIP on ' + this.currentBranch,
      branch: this.currentBranch
    });

    // Clean working dir of uncommitted changes
    for (var wf in this.workingDir) {
      if (this.workingDir[wf].status !== 'committed') {
        delete this.workingDir[wf];
      }
    }
    this.staging = {};

    return { success: true, output: "Saved working directory and index state " + (message || 'WIP on ' + this.currentBranch) };
  };

  GitState.prototype.stashPop = function() {
    if (this.stash.length === 0) {
      return { success: false, output: 'No stash entries found.' };
    }

    // Refuse to clobber committed work that changed since the stash was taken.
    var entry = this.stash[this.stash.length - 1];
    var headCommit = this.HEAD ? this._getCommit(this.HEAD) : null;
    var headFiles = (headCommit && headCommit.files) || {};
    var wouldClobber = [];
    for (var cf in entry.workingDir) {
      var stashed = entry.workingDir[cf];
      if (stashed.status === 'committed') continue;
      var current = this.workingDir[cf];
      if (!current) continue;
      // The file changed on this branch since the stash was created.
      if (current.status === 'committed' && headFiles[cf] &&
          headFiles[cf].content !== (stashed.content || '')) {
        wouldClobber.push(cf);
      }
    }
    if (wouldClobber.length > 0) {
      return {
        success: false,
        output: 'error: 恢复 stash 会覆盖这些文件在当前分支上的已提交内容:\n  ' +
                wouldClobber.join('\n  ') + '\n' +
                '请先提交或备份，再 git stash pop。'
      };
    }

    this.stash.pop();
    // Restore
    for (var f in entry.workingDir) {
      if (entry.workingDir[f].status !== 'committed') {
        this.workingDir[f] = entry.workingDir[f];
      }
    }
    for (var sf in entry.staging) {
      this.staging[sf] = entry.staging[sf];
    }

    return { success: true, output: "On branch " + this.currentBranch + "\nChanges restored:\n  " + Object.keys(entry.workingDir).join('\n  ') };
  };

  GitState.prototype.stashList = function() {
    if (this.stash.length === 0) {
      return { success: true, output: 'No stash entries found.' };
    }
    // git numbers stashes newest-first: the entry `pop` would take is always
    // stash@{0}.
    var lines = [];
    var n = 0;
    for (var i = this.stash.length - 1; i >= 0; i--) {
      lines.push('stash@{' + n + '}: ' + this.stash[i].message);
      n++;
    }
    return { success: true, output: lines.join('\n') };
  };

  // === Git Cherry-pick ===
  GitState.prototype.cherryPick = function(hash) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }

    var target = this._resolveRevision(hash);
    if (target && target.error) return { success: false, output: target.error };
    if (!target) {
      return { success: false, output: "error: bad object " + hash };
    }

    // cherry-pick re-applies the *changes* introduced by the target commit
    // (its diff against its own parent) on top of the current HEAD.
    var parentCommit = target.parent ? this._getCommit(target.parent) : null;
    var baseFiles = (parentCommit && parentCommit.files) || {};
    var targetFiles = target.files || {};

    var headCommit = this._getCommit(this.HEAD);
    var ourFiles = (headCommit && headCommit.files) || {};

    var newFiles = {};
    for (var hf in ourFiles) {
      newFiles[hf] = { content: ourFiles[hf].content };
    }

    var touched = {};
    for (var tf in targetFiles) touched[tf] = true;
    for (var bf in baseFiles) touched[bf] = true;

    var conflicts = [];
    for (var path in touched) {
      var baseEntry = baseFiles[path];
      var targetEntry = targetFiles[path];
      var baseContent = baseEntry ? baseEntry.content : '';
      var targetContent = targetEntry ? targetEntry.content : '';
      var ourContent = newFiles[path] ? newFiles[path].content : '';

      // Compare presence too: a commit that only adds an EMPTY file has
      // baseContent === targetContent === '' but is still a change to apply.
      var baseExists = !!baseEntry;
      var targetExists = !!targetEntry;
      if (baseExists === targetExists && (!baseExists || baseContent === targetContent)) continue;

      // Pure add / delete carried over from the picked commit.
      if (!baseExists && targetExists) {
        newFiles[path] = { content: targetContent };
        continue;
      }
      if (baseExists && !targetExists) {
        delete newFiles[path];
        continue;
      }

      var res = this._mergeFileContent(baseContent, ourContent, targetContent, 'cherry-pick ' + target.hash.substring(0, 7));
      if (res.conflict) {
        conflicts.push(path);
        newFiles[path] = { content: res.content };
      } else if (res.content === '' && ourContent === '' && targetContent === '') {
        delete newFiles[path];
      } else {
        newFiles[path] = { content: res.content };
      }
    }

    if (conflicts.length > 0) {
      this.workingDir = {};
      for (var cf in newFiles) {
        this.workingDir[cf] = {
          content: newFiles[cf].content,
          status: conflicts.indexOf(cf) !== -1 ? 'modified' : 'committed'
        };
      }
      this.staging = {};
      // Record the conflict so commit/checkout stay blocked until it is resolved.
      this.mergeConflict = conflicts;
      this.mergeConflictKinds = null;
      this.pendingMerge = { branch: 'cherry-pick ' + target.hash.substring(0, 7), targetHash: target.hash };
      return {
        success: false,
        output: 'error: could not apply ' + target.hash.substring(0, 7) + '... ' + target.message +
                '\nCONFLICT (content): 冲突文件 ' + conflicts.join(', ') +
                '\n请手动解决冲突后 git add <file> 并 git commit。'
      };
    }

    var newHash = generateHash();
    var newCommit = {
      hash: newHash,
      message: target.message,
      files: newFiles,
      parent: this.HEAD,
      timestamp: Date.now(),
      branch: this.currentBranch
    };

    this.commits.push(newCommit);
    this.HEAD = newHash;
    if (this.currentBranch) this.branches[this.currentBranch] = newHash;

    this.workingDir = {};
    this.staging = {};
    for (var wf in newFiles) {
      this.workingDir[wf] = { content: newFiles[wf].content, status: 'committed' };
    }

    return { success: true, output: "[" + (this.currentBranch || 'detached HEAD') + " " + newHash + "] " + target.message };
  };

  // === Git Reset ===
  GitState.prototype.reset = function(mode, target) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }

    // Parse: git reset --soft/--mixed/--hard <commit>
    if (!target) {
      target = mode;
      mode = '--mixed';
    }
    if (!target) target = 'HEAD';

    var commit = this._resolveRevision(target);
    if (commit && commit.error) {
      return { success: false, output: commit.error };
    }
    if (!commit) {
      return { success: false, output: "fatal: ambiguous argument '" + target + "': unknown revision" };
    }

    this.HEAD = commit.hash;
    if (this.currentBranch) {
      this.branches[this.currentBranch] = commit.hash;
    }
    this.mergeConflict = null;
    this.mergeConflictKinds = null;
    this.pendingMerge = null;

    if (mode === '--hard') {
      // Reset working dir and staging to exactly this commit's tree
      this.workingDir = {};
      this.staging = {};
      if (commit.files) {
        for (var f in commit.files) {
          this.workingDir[f] = { content: commit.files[f].content, status: 'committed' };
        }
      }
    } else if (mode === '--mixed') {
      // Reset staging; keep working dir content but re-derive its status so that
      // files no longer present in the target commit are reported as deleted.
      this.staging = {};
      var targetFiles = commit.files || {};
      for (var wf in this.workingDir) {
        if (this.workingDir[wf].status === 'staged') {
          this.workingDir[wf].status = targetFiles[wf] ? 'modified' : 'new';
        }
      }
    } else if (mode === '--soft') {
      // Only move HEAD. The index and working dir keep the newer content, so the
      // difference between the new HEAD and the working dir becomes staged work.
      var softTarget = commit.files || {};
      for (var sf in this.workingDir) {
        var wdEntry = this.workingDir[sf];
        if (wdEntry.status === 'deleted') {
          this.staging[sf] = { content: '', deleted: true };
          continue;
        }
        var targetEntry = softTarget[sf];
        if (!targetEntry || targetEntry.content !== wdEntry.content) {
          this.staging[sf] = { content: wdEntry.content };
          wdEntry.status = 'staged';
        }
      }
    }

    return { success: true, output: "HEAD is now at " + commit.hash + " " + commit.message };
  };

  // === Git Revert ===
  GitState.prototype.revert = function(hash) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }

    var target = this._resolveRevision(hash);
    if (target && target.error) return { success: false, output: target.error };
    if (!target) {
      return { success: false, output: "error: bad object " + hash };
    }

    var headCommit = this._getCommit(this.HEAD);
    var headFiles = (headCommit && headCommit.files) || {};
    var targetFiles = target.files || {};
    var parentCommit = target.parent ? this._getCommit(target.parent) : null;
    var parentFiles = (parentCommit && parentCommit.files) || {};

    // Revert means: take the inverse of the target commit's diff and apply it on
    // top of HEAD. For each file the target touched, restore the content it had
    // before the target commit — unless a later commit changed it again.
    var newFiles = {};
    for (var hf in headFiles) {
      newFiles[hf] = { content: headFiles[hf].content };
    }

    var touched = {};
    for (var tf in targetFiles) touched[tf] = true;
    for (var pf in parentFiles) touched[pf] = true;

    for (var path in touched) {
      var before = parentFiles[path] ? parentFiles[path].content : undefined;
      var after = targetFiles[path] ? targetFiles[path].content : undefined;
      var current = newFiles[path] ? newFiles[path].content : undefined;

      // Only revert when HEAD still matches what the target commit produced;
      // otherwise a later commit owns this content and we leave it alone.
      if (current !== after) continue;

      if (before === undefined) {
        delete newFiles[path];
      } else {
        newFiles[path] = { content: before };
      }
    }

    var newHash = generateHash();
    var newCommit = {
      hash: newHash,
      message: "Revert '" + target.message + "'",
      files: newFiles,
      parent: this.HEAD,
      timestamp: Date.now(),
      branch: this.currentBranch
    };

    this.commits.push(newCommit);
    this.HEAD = newHash;
    if (this.currentBranch) this.branches[this.currentBranch] = newHash;

    this.workingDir = {};
    this.staging = {};
    for (var wf in newFiles) {
      this.workingDir[wf] = { content: newFiles[wf].content, status: 'committed' };
    }

    return { success: true, output: "[" + (this.currentBranch || 'detached HEAD') + " " + newHash + "] Revert '" + target.message + "'" };
  };

  // === Git Tag ===
  GitState.prototype.tag = function(name) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    if (!this.HEAD) {
      return { success: false, output: 'error: 没有可以打标签的提交' };
    }
    if (!name) {
      // List tags
      var tagNames = Object.keys(this.tags);
      if (tagNames.length === 0) return { success: true, output: '' };
      return { success: true, output: tagNames.join('\n') };
    }
    // Reject names git would refuse, and never treat a flag as a tag name.
    if (name.charAt(0) === '-') {
      return { success: false, output: "error: 未知选项 '" + name + "'，用法: git tag <name>" };
    }
    if (/[\s~^:?*\[\\]/.test(name) || name.indexOf('..') !== -1) {
      return { success: false, output: "fatal: '" + name + "' is not a valid tag name." };
    }
    if (this.tags[name]) {
      return { success: false, output: "fatal: tag '" + name + "' already exists" };
    }
    this.tags[name] = this.HEAD;
    return { success: true, output: '创建标签: ' + name };
  };

  // === Git Rm ===
  GitState.prototype.rm = function(filename) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    if (!this.workingDir[filename]) {
      return { success: false, output: "fatal: pathspec '" + filename + "' did not match any files" };
    }
    this.workingDir[filename].status = 'deleted';
    this.staging[filename] = { content: '', deleted: true };
    this._resolveConflict(filename);
    return { success: true, output: "rm '" + filename + "'" };
  };

  // git rm --cached <file>: stop tracking but keep the file on disk.
  GitState.prototype.rmCached = function(filename) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    if (!this.workingDir[filename]) {
      return { success: false, output: "fatal: pathspec '" + filename + "' did not match any files" };
    }
    this.workingDir[filename].status = 'new';
    this.staging[filename] = { content: '', deleted: true };
    return { success: true, output: "rm '" + filename + "' (仅从跟踪中移除，文件保留)" };
  };

  // === Git Restore ===
  // git restore <file>: restore the WORKING TREE from the index (staging area).
  // For files that were never staged the index equals HEAD, so unstaged edits
  // are discarded and the file returns to its last-committed content. The
  // staging area itself is left untouched (real `git restore` writes worktree only).
  GitState.prototype.restore = function(filename) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    var commit = this.HEAD ? this._getCommit(this.HEAD) : null;
    var headContent = (commit && commit.files && commit.files[filename])
      ? commit.files[filename].content : null;
    // index content = staged version if present, otherwise HEAD
    var indexContent = this.staging[filename] ? this.staging[filename].content : headContent;

    if (indexContent === null) {
      return { success: false, output: 'error: 未跟踪的文件: ' + filename + '\n（git restore 不能恢复未跟踪文件，请先 git add 或 rm）' };
    }

    if (!this.workingDir[filename]) {
      // deleted from worktree — resurrect it from the index
      this.workingDir[filename] = {
        content: indexContent,
        status: this.staging[filename] ? 'modified' : 'committed'
      };
    } else {
      this.workingDir[filename].content = indexContent;
      this.workingDir[filename].status = this.staging[filename] ? 'modified' : 'committed';
    }
    // staging area unchanged
    return { success: true, output: '已恢复工作区 (来自暂存区/HEAD): ' + filename };
  };

  // git restore --source=<rev> <file>: restore the file from a revision.
  // Without --staged it writes only the WORKING TREE; with --staged it writes
  // only the index. The other area is left untouched.
  GitState.prototype.restoreFrom = function(rev, filename, staged) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    var commit = this._resolveRevision(rev);
    if (commit && commit.error) return { success: false, output: commit.error };
    if (!commit) {
      return { success: false, output: "fatal: ambiguous argument '" + rev + "': unknown revision" };
    }
    var revContent = (commit.files && commit.files[filename])
      ? commit.files[filename].content : null;
    if (revContent === null) {
      return { success: false, output: "error: 路径 '" + filename + "' 在 " + rev + " 中不存在，无法恢复" };
    }

    if (staged) {
      this.staging[filename] = { content: revContent, status: 'modified' };
      return { success: true, output: '已从 ' + rev + ' 恢复暂存区: ' + filename };
    }

    if (!this.workingDir[filename]) {
      this.workingDir[filename] = { content: revContent, status: 'modified' };
    } else {
      this.workingDir[filename].content = revContent;
      this.workingDir[filename].status = this.staging[filename] ? 'modified' : 'committed';
    }
    return { success: true, output: '已从 ' + rev + ' 恢复工作区: ' + filename };
  };

  // git restore --staged <file>: unstage, keeping working dir content (real `git restore --staged`).
  GitState.prototype.restoreStaged = function(filename) {    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    if (!this.staging[filename]) {
      return { success: false, output: 'error: 该文件没有已暂存的修改' };
    }
    var commit = this.HEAD ? this._getCommit(this.HEAD) : null;
    var inHead = !!(commit && commit.files && commit.files[filename]);
    delete this.staging[filename];
    if (this.workingDir[filename]) {
      if (this.workingDir[filename].status === 'deleted') {
        this.workingDir[filename].status = inHead ? 'committed' : 'new';
      } else {
        this.workingDir[filename].status = inHead ? 'modified' : 'new';
      }
    }
    return { success: true, output: '已取消暂存: ' + filename };
  };

  // git restore --staged --worktree <file>: reset BOTH index and worktree to HEAD.
  GitState.prototype.restoreAll = function(filename) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    var commit = this.HEAD ? this._getCommit(this.HEAD) : null;
    var headContent = (commit && commit.files && commit.files[filename])
      ? commit.files[filename].content : null;
    if (headContent === null) {
      return { success: false, output: 'error: 未跟踪的文件: ' + filename };
    }
    delete this.staging[filename];
    this.workingDir[filename] = { content: headContent, status: 'committed' };
    return { success: true, output: '已恢复到最后一次提交 (工作区+暂存区): ' + filename };
  };

  // === Helpers ===
  GitState.prototype._getCommit = function(hash) {
    for (var i = 0; i < this.commits.length; i++) {
      if (this.commits[i].hash === hash) return this.commits[i];
    }
    return null;
  };

  // Resolve a revision string to a commit.
  // Supports: HEAD, HEAD~N, HEAD^, a full hash, and an unambiguous short hash.
  // Returns null when the revision cannot be resolved.
  GitState.prototype._resolveRevision = function(rev) {
    if (!rev) return null;
    rev = String(rev).trim();
    if (!rev) return null;

    var base = rev;
    var ancestorSteps = 0;

    // Peel trailing ~N / ^ / ^N operators (HEAD~1, HEAD~2, HEAD^, abc123~1 ...)
    var match = base.match(/^([^~^]+)((?:[~^]\d*)*)$/);
    if (match) {
      base = match[1];
      var ops = match[2];
      var opRe = /([~^])(\d*)/g;
      var op;
      while ((op = opRe.exec(ops)) !== null) {
        var n = op[2] === '' ? 1 : parseInt(op[2], 10);
        ancestorSteps += n;
      }
    }

    // Resolve the base to a starting commit
    var startHash = null;
    if (base === 'HEAD' || base === '@') {
      startHash = this.HEAD;
    } else if (base === '') {
      startHash = this.HEAD;
    } else if (this.branches[base]) {
      startHash = this.branches[base];
    } else if (this.tags[base]) {
      startHash = this.tags[base];
    } else if (this._getCommit(base)) {
      startHash = base;
    } else {
      // Try a short-hash prefix match
      var candidates = [];
      for (var i = 0; i < this.commits.length; i++) {
        if (this.commits[i].hash.indexOf(base) === 0) {
          candidates.push(this.commits[i].hash);
        }
      }
      if (candidates.length === 1) {
        startHash = candidates[0];
      } else if (candidates.length > 1) {
        return { error: "fatal: ambiguous argument '" + rev + "': unknown revision" };
      }
    }

    if (!startHash) return null;

    // Walk back the requested number of first-parent steps
    var current = startHash;
    for (var s = 0; s < ancestorSteps; s++) {
      var c = this._getCommit(current);
      if (!c || !c.parent) return null;
      current = c.parent;
    }

    return this._getCommit(current);
  };

  GitState.prototype._isAncestor = function(ancestorHash, descendantHash) {
    var current = descendantHash;
    while (current) {
      if (current === ancestorHash) return true;
      var commit = this._getCommit(current);
      if (!commit) break;
      current = commit.parent;
    }
    return false;
  };

  // Collect the full ancestry of a commit (first parents + merge parents).
  GitState.prototype._ancestrySet = function(hash) {
    var seen = {};
    var stack = [hash];
    while (stack.length) {
      var h = stack.pop();
      if (!h || seen[h]) continue;
      seen[h] = true;
      var c = this._getCommit(h);
      if (!c) continue;
      if (c.parent) stack.push(c.parent);
      if (c.mergeParent) stack.push(c.mergeParent);
    }
    return seen;
  };

  // Find the best common ancestor of two commits (BFS from both sides).
  GitState.prototype._mergeBase = function(hashA, hashB) {
    if (!hashA || !hashB) return null;
    if (hashA === hashB) return hashA;
    var ancestorsA = this._ancestrySet(hashA);
    // Walk B's history breadth-first; the first commit also in A's ancestry is
    // the closest common ancestor.
    var queue = [hashB];
    var visited = {};
    while (queue.length) {
      var h = queue.shift();
      if (!h || visited[h]) continue;
      visited[h] = true;
      if (ancestorsA[h]) return h;
      var c = this._getCommit(h);
      if (!c) continue;
      if (c.parent) queue.push(c.parent);
      if (c.mergeParent) queue.push(c.mergeParent);
    }
    return null;
  };

  // Compute replacement hunks that turn baseLines into newLines.
  // Each hunk is { start, end, lines }: base[start, end) is replaced by lines.
  // Pure insertions have start === end.
  GitState.prototype._diffHunks = function(baseLines, newLines) {
    var m = baseLines.length, n = newLines.length;
    var dp = [];
    for (var i = 0; i <= m; i++) {
      dp[i] = [];
      for (var j = 0; j <= n; j++) {
        if (i === 0 || j === 0) dp[i][j] = 0;
        else if (baseLines[i - 1] === newLines[j - 1]) dp[i][j] = dp[i - 1][j - 1] + 1;
        else dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }

    // Backtrack into an ordered op list
    var raw = [];
    i = m; j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && baseLines[i - 1] === newLines[j - 1]) {
        raw.unshift({ type: ' ', baseIndex: i - 1, text: baseLines[i - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        raw.unshift({ type: '+', baseIndex: i, text: newLines[j - 1] });
        j--;
      } else {
        raw.unshift({ type: '-', baseIndex: i - 1, text: baseLines[i - 1] });
        i--;
      }
    }

    // Collapse runs of non-context ops into hunks
    var hunks = [];
    var idx = 0;
    while (idx < raw.length) {
      if (raw[idx].type === ' ') { idx++; continue; }
      var start = raw[idx].baseIndex;
      var lines = [];
      var end = start;
      while (idx < raw.length && raw[idx].type !== ' ') {
        if (raw[idx].type === '-') {
          end = raw[idx].baseIndex + 1;
        } else {
          lines.push(raw[idx].text);
        }
        idx++;
      }
      hunks.push({ start: start, end: end, lines: lines });
    }
    return hunks;
  };

  // True when two hunks touch the same region of the base file.
  // Git merges two changes cleanly only when at least one unchanged line
  // separates them, so hunks that merely abut (a.end === b.start) still
  // conflict. Using strict `<` here let adjacent-line edits auto-merge and
  // silently produced results real git would refuse.
  GitState.prototype._hunksOverlap = function(a, b) {
    return a.start <= b.end && b.start <= a.end;
  };

  // Three-way merge of one file's content.
  // Returns { content, conflict }. Non-overlapping edits from both sides are
  // merged automatically; overlapping edits produce <<<<<<< / ======= / >>>>>>>
  // markers so no change is ever silently discarded.
  GitState.prototype._mergeFileContent = function(base, ours, theirs, label) {
    base = base === undefined || base === null ? '' : base;
    ours = ours === undefined || ours === null ? '' : ours;
    theirs = theirs === undefined || theirs === null ? '' : theirs;
    label = label || 'MERGE_SOURCE';

    if (ours === theirs) return { content: ours, conflict: false };
    if (ours === base) return { content: theirs, conflict: false };
    if (theirs === base) return { content: ours, conflict: false };

    var baseLines = base === '' ? [] : base.split('\n');
    var ourLines = ours === '' ? [] : ours.split('\n');
    var theirLines = theirs === '' ? [] : theirs.split('\n');

    var ourHunks = this._diffHunks(baseLines, ourLines);
    var theirHunks = this._diffHunks(baseLines, theirLines);

    var result = [];
    var hasConflict = false;
    var cursor = 0;   // base line cursor
    var oi = 0, ti = 0;

    while (oi < ourHunks.length || ti < theirHunks.length) {
      var nextO = oi < ourHunks.length ? ourHunks[oi].start : Infinity;
      var nextT = ti < theirHunks.length ? theirHunks[ti].start : Infinity;

      // Emit untouched base lines up to the next hunk
      var nextStart = Math.min(nextO, nextT);
      while (cursor < nextStart) {
        result.push(baseLines[cursor]);
        cursor++;
      }

      // Collect every hunk from either side that overlaps this region
      var groupO = [];
      var groupT = [];
      var regionStart = nextStart;
      var regionEnd = nextStart;

      // Seed with whichever side starts first
      if (nextO <= nextT) {
        groupO.push(ourHunks[oi]);
        regionEnd = Math.max(regionEnd, ourHunks[oi].end);
        oi++;
      } else {
        groupT.push(theirHunks[ti]);
        regionEnd = Math.max(regionEnd, theirHunks[ti].end);
        ti++;
      }

      // Absorb any further hunks from either side overlapping the growing region
      var grew = true;
      while (grew) {
        grew = false;
        while (oi < ourHunks.length && this._hunksOverlap(ourHunks[oi], { start: regionStart, end: regionEnd })) {
          groupO.push(ourHunks[oi]);
          regionEnd = Math.max(regionEnd, ourHunks[oi].end);
          oi++;
          grew = true;
        }
        while (ti < theirHunks.length && this._hunksOverlap(theirHunks[ti], { start: regionStart, end: regionEnd })) {
          groupT.push(theirHunks[ti]);
          regionEnd = Math.max(regionEnd, theirHunks[ti].end);
          ti++;
          grew = true;
        }
      }

      if (groupO.length > 0 && groupT.length > 0) {
        // Both sides changed this region — emit conflict markers
        hasConflict = true;
        result.push('<<<<<<< HEAD');
        result = result.concat(this._applyHunks(baseLines, groupO, regionStart, regionEnd));
        result.push('=======');
        result = result.concat(this._applyHunks(baseLines, groupT, regionStart, regionEnd));
        result.push('>>>>>>> ' + label);
      } else if (groupO.length > 0) {
        result = result.concat(this._applyHunks(baseLines, groupO, regionStart, regionEnd));
      } else {
        result = result.concat(this._applyHunks(baseLines, groupT, regionStart, regionEnd));
      }

      cursor = Math.max(cursor, regionEnd);
    }

    // Remaining base lines
    while (cursor < baseLines.length) {
      result.push(baseLines[cursor]);
      cursor++;
    }

    return { content: result.join('\n'), conflict: hasConflict };
  };

  // Apply a set of hunks to a slice of the base file, producing the merged lines
  // for the region [regionStart, regionEnd).
  GitState.prototype._applyHunks = function(baseLines, hunks, regionStart, regionEnd) {
    hunks = hunks.slice().sort(function(a, b) { return a.start - b.start; });
    var out = [];
    var cursor = regionStart;
    for (var i = 0; i < hunks.length; i++) {
      var h = hunks[i];
      // Keep base lines before this hunk
      while (cursor < h.start && cursor < regionEnd) {
        out.push(baseLines[cursor]);
        cursor++;
      }
      out = out.concat(h.lines);
      if (h.end > cursor) cursor = h.end;
    }
    while (cursor < regionEnd) {
      out.push(baseLines[cursor]);
      cursor++;
    }
    return out;
  };

  // === Git Config ===
  // git config [--global] <key> [<value>]  /  git config [--global] --list
  GitState.prototype.config_ = function(scope, key, value) {
    var store = scope === 'global' ? this.config.global : this.config.local;
    var scopeLabel = scope === 'global' ? 'global' : 'local';

    if (!key) {
      // List everything, local first then global
      var lines = [];
      var lk = Object.keys(this.config.local);
      for (var i = 0; i < lk.length; i++) lines.push(lk[i] + '=' + this.config.local[lk[i]]);
      var gk = Object.keys(this.config.global);
      for (var j = 0; j < gk.length; j++) lines.push(gk[j] + '=' + this.config.global[gk[j]]);
      return { success: true, output: lines.join('\n') };
    }

    if (value === undefined || value === null) {
      // Read: local overrides global, like real git
      if (key in this.config.local) return { success: true, output: this.config.local[key] };
      if (key in this.config.global) return { success: true, output: this.config.global[key] };
      return { success: false, output: '' };
    }

    store[key] = value;
    return { success: true, output: '配置已保存 (' + scopeLabel + '): ' + key + ' = ' + value };
  };

  // === Git Remote ===
  GitState.prototype.remoteCmd = function(sub, name, url) {
    if (!sub || sub === '-v' || sub === '--verbose') {
      if (!this.remote.url) return { success: true, output: '' };
      return {
        success: true,
        output: 'origin\t' + this.remote.url + ' (fetch)\n' +
                'origin\t' + this.remote.url + ' (push)'
      };
    }

    if (sub === 'add') {
      if (!name || !url) {
        return { success: false, output: '用法: git remote add <name> <url>' };
      }
      if (this.remote.url) {
        return { success: false, output: "error: remote " + name + " already exists." };
      }
      this.remote.url = url;
      return { success: true, output: '已添加远程仓库: ' + name + ' -> ' + url };
    }

    if (sub === 'remove' || sub === 'rm') {
      if (!this.remote.url) {
        return { success: false, output: "error: No such remote: '" + (name || 'origin') + "'" };
      }
      this.remote.url = null;
      return { success: true, output: '已移除远程仓库: ' + (name || 'origin') };
    }

    return { success: false, output: '用法: git remote [add|remove|-v] <name> [<url>]' };
  };

  // === Git Show ===
  // Shows a commit (or a tag pointing at one) in a compact log-like form.
  GitState.prototype.show = function(rev) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    if (!rev) return { success: false, output: '用法: git show <commit|tag>' };

    var commit = this._resolveRevision(rev);
    if (commit && commit.error) return { success: false, output: commit.error };
    if (!commit) {
      return { success: false, output: "fatal: ambiguous argument '" + rev + "': unknown revision" };
    }

    var lines = [];
    lines.push('commit ' + commit.hash);
    if (commit.mergeParent) {
      lines.push('Merge: ' + commit.parent.substring(0, 7) + ' ' + commit.mergeParent.substring(0, 7));
    }
    lines.push('    ' + commit.message);
    lines.push('');

    // Show what the commit changed relative to its first parent
    var parentCommit = commit.parent ? this._getCommit(commit.parent) : null;
    var parentFiles = (parentCommit && parentCommit.files) || {};
    var files = commit.files || {};
    var touched = {};
    for (var f in files) touched[f] = true;
    for (var p in parentFiles) touched[p] = true;

    var any = false;
    for (var path in touched) {
      var beforeEntry = parentFiles[path];
      var afterEntry = files[path];
      // Presence matters as much as content: adding or removing an EMPTY file
      // is a real change even though both sides read as ''.
      var beforeExists = !!beforeEntry;
      var afterExists = !!afterEntry;
      if (beforeExists === afterExists &&
          (!beforeExists || beforeEntry.content === afterEntry.content)) continue;

      any = true;
      var before = beforeExists ? beforeEntry.content : '';
      var after = afterExists ? afterEntry.content : '';
      lines.push(this._formatDiff(path, before, after));
    }
    if (!any) lines.push('(该提交没有文件变更)');

    return { success: true, output: lines.join('\n') };
  };

  // === Git Blame ===
  // Attributes every line of a file to the commit that last changed it.
  GitState.prototype.blame = function(filename) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    if (!filename) return { success: false, output: '用法: git blame <file>' };

    var wd = this.workingDir[filename];
    if (!wd) return { success: false, output: '文件不存在: ' + filename };

    var lines = (wd.content || '').split('\n');

    // Walk history newest-first; the first commit whose content for this line
    // differs from the next-newer version owns that line.
    var history = [];
    var cursor = this.HEAD;
    while (cursor) {
      var c = this._getCommit(cursor);
      if (!c) break;
      if (c.files && c.files[filename]) history.push(c);
      cursor = c.parent;
    }

    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var owner = null;
      for (var h = 0; h < history.length; h++) {
        var content = history[h].files[filename].content || '';
        var cLines = content.split('\n');
        if (cLines[i] === lines[i]) { owner = history[h]; break; }
      }
      var hashLabel = owner ? owner.hash.substring(0, 7) : '0000000';
      var who = (owner && owner.author) || this._authorName();
      out.push(hashLabel + ' (' + who + ') ' + lines[i]);
    }
    return { success: true, output: out.join('\n') };
  };

  // Effective user name from git config, mirroring local-over-global precedence.
  GitState.prototype._authorName = function() {
    if (this.config.local['user.name']) return this.config.local['user.name'];
    if (this.config.global['user.name']) return this.config.global['user.name'];
    return 'unknown';
  };

  GitState.prototype.resetAll = function() {
    var fresh = new GitState();
    for (var key in fresh) {
      this[key] = fresh[key];
    }
  };

  // Expose
  GitTutorial.GitState = GitState;
  window.GitTutorial = GitTutorial;
})();
