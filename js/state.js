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
      branches: {}
    };
    this.stash = [];
    this.tags = {};          // { name: commitHash }
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
    content = content || 'hello world';
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
    delete this.workingDir[filename];
    if (this.staging[filename]) {
      delete this.staging[filename];
    }
    return { success: true, output: '删除文件: ' + filename };
  };

  // === Git Add ===
  GitState.prototype.add = function(filename) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    if (filename === '.') {
      // add all
      var count = 0;
      for (var f in this.workingDir) {
        this.staging[f] = { content: this.workingDir[f].content };
        if (this.workingDir[f].status === 'new') {
          this.workingDir[f].status = 'staged';
        } else if (this.workingDir[f].status === 'modified') {
          this.workingDir[f].status = 'staged';
        }
        count++;
      }
      if (count === 0) {
        return { success: false, output: '没有文件可以暂存' };
      }
      return { success: true, output: '暂存了 ' + count + ' 个文件' };
    }

    if (!this.workingDir[filename]) {
      // Auto-create file for tutorial convenience
      return { success: false, output: '文件不存在: ' + filename };
    }

    this.staging[filename] = { content: this.workingDir[filename].content };
    this.workingDir[filename].status = 'staged';
    return { success: true, output: '暂存文件: ' + filename };
  };

  // === Git Commit ===
  GitState.prototype.commit = function(message) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    var stagedFiles = Object.keys(this.staging);
    if (stagedFiles.length === 0) {
      return { success: true, output: 'nothing to commit, working tree clean' };
    }

    message = message || 'update';

    // Build files snapshot
    var files = {};
    for (var i = 0; i < stagedFiles.length; i++) {
      var fname = stagedFiles[i];
      files[fname] = { content: this.staging[fname].content };
    }

    var hash = generateHash();
    var commit = {
      hash: hash,
      message: message,
      files: files,
      parent: this.HEAD,
      timestamp: Date.now(),
      branch: this.currentBranch
    };

    this.commits.push(commit);
    this.HEAD = hash;
    this.branches[this.currentBranch] = hash;

    // Clear staging, remove committed files from working dir if they were new/staged
    this.staging = {};
    for (var f in this.workingDir) {
      if (this.workingDir[f].status === 'staged') {
        this.workingDir[f].status = 'committed';
      }
    }

    return {
      success: true,
      output: '[' + this.currentBranch + ' ' + hash + '] ' + message,
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
    lines.push('On branch ' + this.currentBranch);

    var staged = [];
    var modified = [];
    var untracked = [];

    for (var f in this.workingDir) {
      var st = this.workingDir[f].status;
      if (st === 'staged') {
        staged.push(f);
      } else if (st === 'modified') {
        modified.push(f);
      } else if (st === 'new') {
        untracked.push(f);
      }
    }

    if (staged.length === 0 && modified.length === 0 && untracked.length === 0) {
      lines.push('nothing to commit, working tree clean');
    } else {
      if (staged.length > 0) {
        lines.push('\nChanges to be committed:');
        for (var i = 0; i < staged.length; i++) {
          lines.push('  (use "git add <file>..." to update)');
          lines.push('\tnew file:   ' + staged[i]);
        }
      }
      if (modified.length > 0) {
        lines.push('\nChanges not staged for commit:');
        for (var j = 0; j < modified.length; j++) {
          lines.push('\tmodified:   ' + modified[j]);
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

  // === Git Diff ===
  GitState.prototype.diff = function(filename) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }

    var lines = [];
    var hasDiff = false;

    var files = filename ? [filename] : Object.keys(this.workingDir);
    for (var i = 0; i < files.length; i++) {
      var fname = files[i];
      var wd = this.workingDir[fname];
      var st = this.staging[fname];

      if (!wd) continue;

      var wdContent = wd.content || '';
      var stContent = st ? st.content : '';
      var committedContent = '';

      // Get committed content
      if (this.HEAD) {
        var lastCommit = this._getCommit(this.HEAD);
        if (lastCommit && lastCommit.files[fname]) {
          committedContent = lastCommit.files[fname].content || '';
        }
      }

      // Compare working dir with staging (or committed if nothing staged)
      var compareContent = st ? stContent : committedContent;
      if (wdContent !== compareContent) {
        hasDiff = true;
        lines.push('diff --git a/' + fname + ' b/' + fname);
        lines.push('--- a/' + fname);
        lines.push('+++ b/' + fname);

        var oldLines = compareContent.split('\n');
        var newLines = wdContent.split('\n');
        lines.push('@@ -1,' + oldLines.length + ' +1,' + newLines.length + ' @@');

        for (var ol = 0; ol < oldLines.length; ol++) {
          lines.push('- ' + oldLines[ol]);
        }
        for (var nl = 0; nl < newLines.length; nl++) {
          lines.push('+ ' + newLines[nl]);
        }
      }
    }

    if (!hasDiff) {
      return { success: true, output: '' };
    }
    return { success: true, output: lines.join('\n') };
  };

  // === Git Diff --staged ===
  GitState.prototype.diffStaged = function() {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }

    var lines = [];
    var hasDiff = false;

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
        hasDiff = true;
        lines.push('diff --git a/' + fname + ' b/' + fname);
        lines.push('--- a/' + fname);
        lines.push('+++ b/' + fname);
        var oldLines = committedContent.split('\n');
        var newLines = stContent.split('\n');
        lines.push('@@ -1,' + oldLines.length + ' +1,' + newLines.length + ' @@');
        for (var ol = 0; ol < oldLines.length; ol++) {
          lines.push('- ' + oldLines[ol]);
        }
        for (var nl = 0; nl < newLines.length; nl++) {
          lines.push('+ ' + newLines[nl]);
        }
      }
    }

    if (!hasDiff) {
      return { success: true, output: '' };
    }
    return { success: true, output: lines.join('\n') };
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
      lines.push('commit ' + commit.hash + (commit.branch === this.currentBranch ? ' (HEAD -> ' + commit.branch + ')' : ''));
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

    // Update working dir to match the commit
    var commit = this._getCommit(this.HEAD);
    this.workingDir = {};
    this.staging = {};
    if (commit && commit.files) {
      for (var f in commit.files) {
        this.workingDir[f] = { content: commit.files[f].content, status: 'committed' };
      }
    }

    return { success: true, output: "Switched to branch '" + target + "'" };
  };

  GitState.prototype.checkoutCommit = function(hash){
    if(!this.initialized){
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    var commit = this._getCommit(hash);
    if(!commit){
      return { success: false, output: "fatal: Not a valid object name: '" + hash + "'." };
    }
    this.HEAD = hash;
    this.currentBranch = null;
    this.workingDir = {};
    this.staging = {};
    if (commit && commit.files) {
      for (var f in commit.files) {
        this.workingDir[f] = { content: commit.files[f].content, status: 'committed' };
      }
    }
    return { success: true, output: "Switched to commit '" + hash + "'" };
  
  }

  GitState.prototype.checkoutCommitNewBranch = function(name, hash){
    if(!this.initialized){
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    var commit = this._getCommit(hash);
    if(!commit){
      return { success: false, output: "fatal: Not a valid object name: '" + hash + "'." };
    }
    if (name in this.branches) {
      return { success: false, output: "fatal: A branch named '" + name + "' already exists." };
    }
    this.HEAD = hash;
    this.branches[name] = hash;
    this.currentBranch = name;
    this.workingDir = {};
    this.staging = {};
    if (commit && commit.files) {
      for (var f in commit.files) {
        this.workingDir[f] = { content: commit.files[f].content, status: 'committed' };
      }
    }  
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

    // Check if fast-forward possible
    if (this._isAncestor(currentHash, targetHash)) {
      // Fast-forward
      this.HEAD = targetHash;
      this.branches[this.currentBranch] = targetHash;

      var commit = this._getCommit(targetHash);
      this.workingDir = {};
      this.staging = {};
      if (commit && commit.files) {
        for (var f in commit.files) {
          this.workingDir[f] = { content: commit.files[f].content, status: 'committed' };
        }
      }

      return {
        success: true,
        output: "Updating " + currentHash.substring(0, 7) + ".." + targetHash.substring(0, 7) + "\nFast-forward\nMerge complete: " + branch + " → " + this.currentBranch
      };
    }

    // 3-way merge (simplified: just combine files)
    var targetCommit = this._getCommit(targetHash);
    var currentCommit = this._getCommit(currentHash);

    if (!targetCommit || !currentCommit) {
      return { success: false, output: 'merge: 无法找到提交' };
    }

    // Create merge commit
    var mergedFiles = {};
    // Start with current branch files
    for (var cf in currentCommit.files) {
      mergedFiles[cf] = { content: currentCommit.files[cf].content };
    }
    // Override/add with target branch files
    for (var tf in targetCommit.files) {
      mergedFiles[tf] = { content: targetCommit.files[tf].content };
    }

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
    this.branches[this.currentBranch] = hash;

    this.workingDir = {};
    this.staging = {};
    for (var mf in mergedFiles) {
      this.workingDir[mf] = { content: mergedFiles[mf].content, status: 'committed' };
    }

    return {
      success: true,
      output: "Merge made: '" + branch + "' → '" + this.currentBranch + "'\ncommit " + hash
    };
  };

  // === Git Push ===
  GitState.prototype.push = function(remote, branch) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }
    remote = remote || 'origin';
    branch = branch || this.currentBranch;

    if (!this.HEAD) {
      return { success: false, output: 'error: 没有可以 push 的提交' };
    }

    // Copy current branch commits to remote
    var current = this.HEAD;
    var commitsToPush = [];
    while (current) {
      var found = false;
      for (var i = 0; i < this.remote.commits.length; i++) {
        if (this.remote.commits[i].hash === current) {
          found = true;
          break;
        }
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

    this.remote.branches[branch] = this.HEAD;

    return {
      success: true,
      output: "Enumerating objects: " + commitsToPush.length + "\nWriting objects: 100%\nTo " + remote + "\n * [new branch]      " + branch + " -> " + branch
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

    // Fast-forward
    this.HEAD = remoteHash;
    this.branches[this.currentBranch] = remoteHash;

    this.workingDir = {};
    this.staging = {};
    if (remoteCommit.files) {
      for (var f in remoteCommit.files) {
        this.workingDir[f] = { content: remoteCommit.files[f].content, status: 'committed' };
      }
    }

    // Also add commits to local
    for (var j = 0; j < this.remote.commits.length; j++) {
      var rc = this.remote.commits[j];
      var exists = false;
      for (var k = 0; k < this.commits.length; k++) {
        if (this.commits[k].hash === rc.hash) {
          exists = true;
          break;
        }
      }
      if (!exists) {
        this.commits.push(rc);
      }
    }

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

    // Simplified rebase: fast-forward to target
    this.HEAD = targetHash;
    this.branches[this.currentBranch] = targetHash;

    var commit = this._getCommit(targetHash);
    this.workingDir = {};
    this.staging = {};
    if (commit && commit.files) {
      for (var f in commit.files) {
        this.workingDir[f] = { content: commit.files[f].content, status: 'committed' };
      }
    }

    return {
      success: true,
      output: "Successfully rebased and updated refs/heads/" + this.currentBranch + ".\ncommit " + targetHash
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

    var entry = this.stash.pop();
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
    var lines = [];
    for (var i = this.stash.length - 1; i >= 0; i--) {
      lines.push('stash@{' + i + '}: ' + this.stash[i].message);
    }
    return { success: true, output: lines.join('\n') };
  };

  // === Git Cherry-pick ===
  GitState.prototype.cherryPick = function(hash) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }

    var commit = this._getCommit(hash);
    if (!commit) {
      return { success: false, output: "error: bad object " + hash };
    }

    // Apply the commit's files and create a new commit
    var newFiles = {};
    // Start with current HEAD files
    var headCommit = this._getCommit(this.HEAD);
    if (headCommit) {
      for (var f in headCommit.files) {
        newFiles[f] = { content: headCommit.files[f].content };
      }
    }
    // Apply cherry-picked commit's changes
    for (var cf in commit.files) {
      newFiles[cf] = { content: commit.files[cf].content };
    }

    var newHash = generateHash();
    var newCommit = {
      hash: newHash,
      message: commit.message,
      files: newFiles,
      parent: this.HEAD,
      timestamp: Date.now(),
      branch: this.currentBranch
    };

    this.commits.push(newCommit);
    this.HEAD = newHash;
    this.branches[this.currentBranch] = newHash;

    this.workingDir = {};
    this.staging = {};
    for (var wf in newFiles) {
      this.workingDir[wf] = { content: newFiles[wf].content, status: 'committed' };
    }

    return { success: true, output: "[" + this.currentBranch + " " + newHash + "] " + commit.message };
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

    var commit = this._getCommit(target);
    if (!commit) {
      return { success: false, output: "fatal: ambiguous argument '" + target + "': unknown revision" };
    }

    this.HEAD = commit.hash;
    this.branches[this.currentBranch] = commit.hash;

    if (mode === '--hard') {
      // Reset working dir and staging
      this.workingDir = {};
      this.staging = {};
      if (commit.files) {
        for (var f in commit.files) {
          this.workingDir[f] = { content: commit.files[f].content, status: 'committed' };
        }
      }
    } else if (mode === '--mixed') {
      // Reset staging only
      this.staging = {};
    }
    // --soft: only move HEAD

    return { success: true, output: "HEAD is now at " + commit.hash + " " + commit.message };
  };

  // === Git Revert ===
  GitState.prototype.revert = function(hash) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }

    var commit = this._getCommit(hash);
    if (!commit) {
      return { success: false, output: "error: bad object " + hash };
    }

    // Revert: create a new commit that undoes the changes
    var newFiles = {};
    var headCommit = this._getCommit(this.HEAD);
    if (headCommit) {
      for (var f in headCommit.files) {
        newFiles[f] = { content: headCommit.files[f].content };
      }
    }
    // Remove files from reverted commit (simplified: just remove them)
    for (var cf in commit.files) {
      if (newFiles[cf]) {
        delete newFiles[cf];
      }
    }

    var newHash = generateHash();
    var newCommit = {
      hash: newHash,
      message: "Revert '" + commit.message + "'",
      files: newFiles,
      parent: this.HEAD,
      timestamp: Date.now(),
      branch: this.currentBranch
    };

    this.commits.push(newCommit);
    this.HEAD = newHash;
    this.branches[this.currentBranch] = newHash;

    this.workingDir = {};
    this.staging = {};
    for (var wf in newFiles) {
      this.workingDir[wf] = { content: newFiles[wf].content, status: 'committed' };
    }

    return { success: true, output: "[" + this.currentBranch + " " + newHash + "] Revert '" + commit.message + "'" };
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
    return { success: true, output: "rm '" + filename + "'" };
  };

  // === Git Restore ===
  GitState.prototype.restore = function(filename) {
    if (!this.initialized) {
      return { success: false, output: '尚未初始化仓库。请先输入: git init' };
    }

    // Restore from last commit
    var commit = this._getCommit(this.HEAD);
    if (!commit || !commit.files[filename]) {
      // File didn't exist in commit, remove from working dir
      delete this.workingDir[filename];
      return { success: true, output: '已恢复: ' + filename };
    }

    this.workingDir[filename] = {
      content: commit.files[filename].content,
      status: 'committed'
    };
    return { success: true, output: '已恢复: ' + filename };
  };

  // === Helpers ===
  GitState.prototype._getCommit = function(hash) {
    for (var i = 0; i < this.commits.length; i++) {
      if (this.commits[i].hash === hash) return this.commits[i];
    }
    return null;
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
