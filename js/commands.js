// Commands — All git command handlers
var GitTutorial = window.GitTutorial || {};

(function() {
  'use strict';

  // Helper: extract the value of a flag like -m / --message.
  // Handles `-m msg`, `-m "multi word msg"`, `-m"msg"` and `--message=msg`.
  // Only the words belonging to the message are consumed: a trailing option
  // such as `git commit -m "msg" --no-verify` must not leak into the message.
  function getMessage(args, flag) {
    for (var i = 0; i < args.length; i++) {
      var a = args[i];

      // --message=msg
      var eq = a.indexOf('=');
      if (eq !== -1 && a.substring(0, eq) === flag) {
        return a.substring(eq + 1);
      }

      if (a === flag) {
        var words = [];
        for (var j = i + 1; j < args.length; j++) {
          if (args[j].charAt(0) === '-' && args[j].length > 1) break;
          words.push(args[j]);
        }
        return words.length > 0 ? words.join(' ') : null;
      }

      // Attached form: -m"msg" / -mmsg
      if (a.length > flag.length && a.substring(0, flag.length) === flag) {
        var rest = a.substring(flag.length);
        rest = rest.replace(/^["']|["']$/g, '');
        return rest;
      }
    }
    return null;
  }

  var commands = {
    // === init ===
    'init': function(state, args) {
      return state.init();
    },

    // === clone ===
    'clone': function(state, args) {
      var url = args[0] || 'https://github.com/example/repo.git';
      return state.clone(url);
    },

    // === add ===
    'add': function(state, args) {
      if (args.length === 0) {
        return { success: false, output: '用法: git add <file>... 或 git add .' };
      }
      // git add -A / --all / -u behave like `add .` in this simulator
      if (args[0] === '-A' || args[0] === '--all' || args[0] === '-u') {
        return state.add('.');
      }
      // Stage every path given, not just the first.
      var stagedCount = 0;
      var errors = [];
      for (var i = 0; i < args.length; i++) {
        if (args[i].charAt(0) === '-') continue;
        var res = state.add(args[i]);
        if (res.success) stagedCount++;
        else errors.push(res.output);
      }
      if (stagedCount === 0) {
        return { success: false, output: errors.join('\n') || '没有文件可以暂存' };
      }
      if (errors.length > 0) {
        return { success: true, output: '暂存了 ' + stagedCount + ' 个文件\n' + errors.join('\n') };
      }
      return { success: true, output: '暂存了 ' + stagedCount + ' 个文件' };
    },

    // === status ===
    'status': function(state, args) {
      return state.getStatus();
    },

    // === commit ===
    'commit': function(state, args) {
      var msg = getMessage(args, '-m');
      if (!msg) msg = getMessage(args, '--message');
      if (!msg) {
        // Finishing a resolved merge may omit -m: Git supplies the default
        // merge message. Any other commit needs an explicit message.
        if (state.pendingMerge) {
          return state.commit(null);
        }
        return {
          success: false,
          output: '请提供提交信息: git commit -m "你的提交说明"'
        };
      }
      return state.commit(msg);
    },

    // === diff ===
    'diff': function(state, args) {
      if (args.length > 0 && (args[0] === '--staged' || args[0] === '--cached')) {
        return state.diffStaged();
      }
      return state.diff(args[0]);
    },

    // === log ===
    'log': function(state, args) {
      var count = null;
      var nIdx = args.indexOf('-n');
      if (nIdx !== -1) {
        var raw = args[nIdx + 1];
        if (raw === undefined || isNaN(parseInt(raw, 10))) {
          return { success: false, output: 'fatal: -n requires an argument' };
        }
        count = parseInt(raw, 10);
      } else if (args.length > 0 && !isNaN(parseInt(args[0], 10))) {
        count = parseInt(args[0], 10);
      }
      // Unknown flags are ignored, matching git's tolerance for display flags
      // this simulator does not model (--oneline, --stat, ...).
      return state.log(count);
    },

    // === branch ===
    'branch': function(state, args) {
      if (args.length === 0) {
        return state.branch(null);
      }
      // Listing / inspection flags behave like a bare `git branch`.
      if (args[0] === '-v' || args[0] === '-a' || args[0] === '--list' ||
          args[0] === '-r' || args[0] === '-vv' || args[0] === '--all') {
        return state.branch(null);
      }
      // Handle -d (delete)
      if (args[0] === '-d' || args[0] === '-D') {
        var delName = args[1];
        if (!delName) {
          return { success: false, output: '用法: git branch -d <name>' };
        }
        if (delName === state.currentBranch) {
          return { success: false, output: "error: Cannot delete branch '" + delName + "' checked out" };
        }
        // Use an `in` check: a branch created before the first commit maps to
        // null and would otherwise look like a missing branch.
        if (!(delName in state.branches)) {
          return { success: false, output: "error: branch '" + delName + "' not found." };
        }
        // -d refuses to drop a branch holding commits not merged into HEAD.
        if (args[0] === '-d' && state.branches[delName] && state.HEAD) {
          var tip = state.branches[delName];
          if (!state._isAncestor(tip, state.HEAD)) {
            return {
              success: false,
              output: "error: The branch '" + delName + "' is not fully merged.\n" +
                      "If you are sure you want to delete it, run 'git branch -D " + delName + "'."
            };
          }
        }
        delete state.branches[delName];
        return { success: true, output: "Deleted branch " + delName + "." };
      }
      if (args[0] === '-m' || args[0] === '-M') {
        // Rename a branch. With one name, rename the current branch.
        var from = args.length >= 3 ? args[1] : state.currentBranch;
        var to = args.length >= 3 ? args[2] : args[1];
        if (!to) return { success: false, output: '用法: git branch -m [<old>] <new>' };
        if (!(from in state.branches)) {
          return { success: false, output: "error: branch '" + from + "' not found." };
        }
        if (to in state.branches) {
          return { success: false, output: "fatal: A branch named '" + to + "' already exists." };
        }
        state.branches[to] = state.branches[from];
        delete state.branches[from];
        if (state.currentBranch === from) state.currentBranch = to;
        return { success: true, output: "已重命名分支: " + from + " -> " + to };
      }
      // Reject anything else that starts with a dash instead of creating a
      // branch literally named "-x".
      if (args[0].charAt(0) === '-') {
        return { success: false, output: "error: 未知选项 '" + args[0] + "'，用法: git branch [-d|-D|-m] [<name>]" };
      }
      return state.branch(args[0]);
    },

    // === checkout ===
    'checkout': function(state, args) {
      if (args.length === 0) {
        return { success: false, output: '用法: git checkout <branch> 或 git checkout -b <branch>' };
      }
      if (state.mergeConflict && state.mergeConflict.length > 0) {
        return {
          success: false,
          output: 'error: 你有未解决的合并冲突，请先解决并 commit，或运行 git reset --hard HEAD 放弃合并。\n冲突文件: ' + state.mergeConflict.join(', ')
        };
      }
      if (args[0] === '-b') {
        if (args.length < 2) {
          return { success: false, output: '用法: git checkout -b <branch-name> [<start-point>]' };
        }
        if (args.length === 2) {
          return state.checkoutNewBranch(args[1]);
        }
        // `git checkout -b <name> <start-point>` — extra trailing args are ignored.
        return state.checkoutCommitNewBranch(args[1], args[2]);
      }
      if (!(args[0] in state.branches)) {
        return state.checkoutCommit(args[0]);
      }
      return state.checkout(args[0]);
    },

    // === switch ===
    'switch': function(state, args) {
      if (args.length === 0) {
        return { success: false, output: '用法: git switch <branch> 或 git switch -c <branch>' };
      }
      if (state.mergeConflict && state.mergeConflict.length > 0) {
        return {
          success: false,
          output: 'error: 你有未解决的合并冲突，请先解决并 commit，或运行 git reset --hard HEAD 放弃合并。\n冲突文件: ' + state.mergeConflict.join(', ')
        };
      }
      if (args[0] === '-c') {
        if (args.length < 2) {
          return { success: false, output: '用法: git switch -c <branch-name>' };
        }
        return state.switchNewBranch(args[1]);
      }
      return state.switchCmd(args[0]);
    },

    // === merge ===
    'merge': function(state, args) {
      if (args.length === 0) {
        return { success: false, output: '用法: git merge <branch>' };
      }
      if (state.mergeConflict && state.mergeConflict.length > 0) {
        return {
          success: false,
          output: 'error: 上一个合并还有未解决的冲突，请先处理。\n冲突文件: ' + state.mergeConflict.join(', ')
        };
      }
      return state.merge(args[0]);
    },

    // === push ===
    'push': function(state, args) {
      var remote = args[0] || 'origin';
      var branch = args[1] || state.currentBranch;
      return state.push(remote, branch);
    },

    // === pull ===
    'pull': function(state, args) {
      var remote = args[0] || 'origin';
      var branch = args[1] || state.currentBranch;
      return state.pull(remote, branch);
    },

    // === fetch ===
    'fetch': function(state, args) {
      return state.fetch(args[0]);
    },

    // === rebase ===
    'rebase': function(state, args) {
      if (args.length === 0) {
        return { success: false, output: '用法: git rebase <branch>' };
      }
      return state.rebase(args[0]);
    },

    // === stash ===
    'stash': function(state, args) {
      if (args.length === 0 || args[0] === 'save') {
        var msg = args.length > 1 ? args.slice(1).join(' ') : null;
        return state.stashSave(msg);
      }
      if (args[0] === 'pop') {
        return state.stashPop();
      }
      if (args[0] === 'list') {
        return state.stashList();
      }
      return { success: false, output: '用法: git stash [save|pop|list]' };
    },

    // === cherry-pick ===
    'cherry-pick': function(state, args) {
      if (args.length === 0) {
        return { success: false, output: '用法: git cherry-pick <commit-hash>' };
      }
      return state.cherryPick(args[0]);
    },

    // === reset ===
    'reset': function(state, args) {
      var mode = '--mixed';
      var target = null;
      var KNOWN = { '--soft': 1, '--mixed': 1, '--hard': 1, '--keep': 1, '--merge': 1 };

      for (var i = 0; i < args.length; i++) {
        if (KNOWN[args[i]]) {
          mode = (args[i] === '--keep' || args[i] === '--merge') ? '--mixed' : args[i];
        } else if (args[i].charAt(0) === '-' && args[i].length > 1) {
          // An unrecognised option is an option error, not a revision.
          return { success: false, output: "error: unknown option `" + args[i].replace(/^--?/, '') + "'" };
        } else if (!target) {
          target = args[i];
        }
      }

      // `git reset` with no revision defaults to HEAD (unstage everything).
      if (!target) target = 'HEAD';

      return state.reset(mode, target);
    },

    // === revert ===
    'revert': function(state, args) {
      if (args.length === 0) {
        return { success: false, output: '用法: git revert <commit-hash>' };
      }
      return state.revert(args[0]);
    },

    // === tag ===
    'tag': function(state, args) {
      // `git tag` / `git tag -l` list; `-a <name> -m <msg>` creates a tag named
      // <name> (the flags must never become the tag name itself).
      var name = null;
      for (var i = 0; i < args.length; i++) {
        var a = args[i];
        if (a === '-l' || a === '--list') return state.tag(null);
        if (a === '-a' || a === '-s' || a === '-m' || a === '--message' || a === '-d' || a === '-f') {
          // Skip this flag and, for -m/--message, its value.
          if (a === '-m' || a === '--message') i++;
          continue;
        }
        if (a.charAt(0) === '-') continue;
        if (!name) name = a;
      }
      return state.tag(name);
    },

    // === rm ===
    'rm': function(state, args) {
      if (args.length === 0) {
        return { success: false, output: '用法: git rm <file>... 或 git rm --cached <file>' };
      }
      if (args[0] === '--cached') {
        if (!args[1]) return { success: false, output: '用法: git rm --cached <file>' };
        return state.rmCached(args[1]);
      }
      // Remove every path given, not just the first.
      var removed = 0;
      var errors = [];
      for (var i = 0; i < args.length; i++) {
        if (args[i].charAt(0) === '-') continue;
        var res = state.rm(args[i]);
        if (res.success) removed++;
        else errors.push(res.output);
      }
      if (removed === 0) {
        return { success: false, output: errors.join('\n') || '没有文件被删除' };
      }
      if (errors.length > 0) {
        return { success: true, output: "rm '" + removed + "' 个文件\n" + errors.join('\n') };
      }
      return { success: true, output: "rm " + removed + " 个文件" };
    },

    // === restore ===
    'restore': function(state, args) {
      if (args.length === 0) {
        return { success: false, output: '用法: git restore <file> | git restore --staged <file> | git restore --staged --worktree <file> | git restore --source=<rev> <file>' };
      }
      var staged = false, worktree = false, source = null, fileArg = null;
      for (var i = 0; i < args.length; i++) {
        var a = args[i];
        if (a === '--staged' || a === '--cached') staged = true;
        else if (a === '--worktree') worktree = true;
        else if (a.indexOf('--source=') === 0) source = a.substring('--source='.length);
        else if (a === '--source' || a === '-s') { source = args[i + 1]; i++; }
        else fileArg = a;
      }
      if (!fileArg) {
        return { success: false, output: '用法: git restore <file>' };
      }
      if (source) {
        return state.restoreFrom(source, fileArg, staged);
      }
      if (staged && worktree) return state.restoreAll(fileArg);
      if (staged) return state.restoreStaged(fileArg);
      return state.restore(fileArg);
    },

    // === config ===
    'config': function(state, args) {
      var scope = 'local';
      var rest = [];
      for (var i = 0; i < args.length; i++) {
        if (args[i] === '--global' || args[i] === '--system') scope = 'global';
        else if (args[i] === '--local') scope = 'local';
        else if (args[i] === '--list' || args[i] === '-l') { /* list via no-key path */ }
        else rest.push(args[i]);
      }
      var value = rest.length > 1 ? rest.slice(1).join(' ') : undefined;
      return state.config_(scope, rest[0], value);
    },

    // === remote ===
    'remote': function(state, args) {
      if (args.length === 0) return state.remoteCmd(null);
      if (args[0] === '-v' || args[0] === '--verbose') return state.remoteCmd('-v');
      if (args[0] === 'add') return state.remoteCmd('add', args[1], args[2]);
      if (args[0] === 'remove' || args[0] === 'rm') return state.remoteCmd('remove', args[1]);
      if (args[0] === 'show' || args[0] === 'get-url') return state.remoteCmd('-v');
      return { success: false, output: '用法: git remote [add|remove|-v] <name> [<url>]' };
    },

    // === show ===
    'show': function(state, args) {
      if (args.length === 0) return { success: false, output: '用法: git show <commit|tag>' };
      return state.show(args[0]);
    },

    // === blame ===
    'blame': function(state, args) {
      // Tolerate `git blame -L 10,20 file` by taking the last non-flag argument.
      var file = null;
      for (var k = args.length - 1; k >= 0; k--) {
        if (args[k].charAt(0) !== '-') { file = args[k]; break; }
      }
      if (!file) return { success: false, output: '用法: git blame <file>' };
      return state.blame(file);
    },

    // === touch (helper: create file) ===
    'touch': function(state, args) {
      if (args.length === 0) {
        return { success: false, output: '用法: touch <filename>' };
      }
      return state.createFile(args[0], args.length > 1 ? args.slice(1).join(' ') : '');
    },

    // === echo (helper: write content to file) ===
    'echo': function(state, args) {
      // echo "content" > filename  or  echo content >> filename
      var full = args.join(' ');
      var append = full.indexOf('>>') !== -1;
      var parts = full.split(append ? '>>' : '>');

      if (parts.length < 2) {
        return { success: false, output: '用法: echo "content" > <file>' };
      }

      var content = parts[0].trim().replace(/^["']|["']$/g, '');
      var filename = parts[1].trim();

      if (append && state.workingDir[filename]) {
        state.workingDir[filename].content += '\n' + content;
        state.workingDir[filename].status = 'modified';
        return { success: true, output: '追加到: ' + filename };
      }

      if (state.workingDir[filename]) {
        return state.modifyFile(filename, content);
      }
      return state.createFile(filename, content);
    },

    // === cat (helper: show file content) ===
    'cat': function(state, args) {
      if (args.length === 0) {
        return { success: false, output: '用法: cat <file>' };
      }
      var f = state.workingDir[args[0]];
      if (!f) {
        return { success: false, output: '文件不存在: ' + args[0] };
      }
      return { success: true, output: f.content };
    },

    // === help ===
    'help': function(state, args) {
      return {
        success: true,
        output: [
          '可用命令:',
          '  git init              初始化仓库',
          '  git clone <url>       克隆远程仓库',
          '  git add <file>        暂存文件',
          '  git status            查看状态',
          '  git commit -m "msg"   提交更改',
          '  git diff              查看差异',
          '  git log               查看提交历史',
          '  git branch [name]     创建/列出分支',
          '  git checkout <branch> 切换分支',
          '  git switch <branch>   切换分支(新命令)',
          '  git merge <branch>    合并分支',
          '  git push [remote]     推送到远程',
          '  git pull [remote]     拉取远程更新',
          '  git fetch [remote]    获取远程更新',
          '  git rebase <branch>   变基',
          '  git stash [save|pop|list] 暂存工作',
          '  git cherry-pick <hash> 拣选提交',
          '  git reset [mode] <commit> 重置 (支持 HEAD~1 / 短 hash)',
          '  git revert <hash>     撤销提交',
          '  git tag [name]        创建/列出标签',
          '  git rm <file>         删除文件 (--cached 仅取消跟踪)',
          '  git restore <file>    恢复文件 (--staged 取消暂存)',
          '  git config [--global] <key> [<value>]  配置用户信息',
          '  git remote [add|remove|-v] <name> [<url>]  管理远程仓库',
          '  git show <commit|tag> 查看提交详情',
          '  git blame <file>      逐行追溯修改者',
          '',
          '辅助命令:',
          '  touch <file>          创建文件',
          '  echo "content" > file 写入文件',
          '  cat <file>            查看文件内容',
          '  clear                 清空终端',
          '  reset-tutorial        重置教程状态'
        ].join('\n')
      };
    },

    // === clear ===
    'clear': function(state, args) {
      return { success: true, output: '__CLEAR__' };
    },

    // === reset-tutorial ===
    'reset-tutorial': function(state, args) {
      state.resetAll();
      return { success: true, output: '教程状态已重置！' };
    }
  };

  // Expose
  GitTutorial.commands = commands;
  window.GitTutorial = GitTutorial;
})();
