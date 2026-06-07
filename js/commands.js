// Commands — All git command handlers
var GitTutorial = window.GitTutorial || {};

(function() {
  'use strict';

  // Helper: get last command arg (for flags like -m, -b)
  function getMessage(args, flag) {
    var idx = args.indexOf(flag);
    if (idx !== -1 && idx + 1 < args.length) {
      return args[idx + 1];
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
        return { success: false, output: '用法: git add <file> 或 git add .' };
      }
      return state.add(args[0]);
    },

    // === status ===
    'status': function(state, args) {
      return state.getStatus();
    },

    // === commit ===
    'commit': function(state, args) {
      var msg = getMessage(args, '-m');
      if (!msg && args.length > 0 && args[0].startsWith('-m')) {
        // Handle -m"message" or -m message
        if (args[0].length > 2) {
          msg = args[0].substring(2);
        } else if (args.length > 1) {
          msg = args[1];
        }
      }
      if (!msg) {
        // Check if all args after -m form the message
        var mIdx = args.indexOf('-m');
        if (mIdx !== -1) {
          msg = args.slice(mIdx + 1).join(' ');
        }
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
      if (nIdx !== -1 && nIdx + 1 < args.length) {
        count = parseInt(args[nIdx + 1], 10);
      }
      if (args.length > 0 && !isNaN(parseInt(args[0], 10))) {
        count = parseInt(args[0], 10);
      }
      return state.log(count);
    },

    // === branch ===
    'branch': function(state, args) {
      if (args.length === 0) {
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
        if (!state.branches[delName]) {
          return { success: false, output: "error: branch '" + delName + "' not found." };
        }
        delete state.branches[delName];
        return { success: true, output: "Deleted branch " + delName + "." };
      }
      return state.branch(args[0]);
    },

    // === checkout ===
    'checkout': function(state, args) {
      if (args.length === 0) {
        return { success: false, output: '用法: git checkout <branch> 或 git checkout -b <branch>' };
      }
      if (args[0] === '-b') {
        if (args.length < 2) {
          return { success: false, output: '用法: git checkout -b <branch-name>' };
        }
        if(args.length === 2)
        {
          return state.checkoutNewBranch(args[1]);
        }
        if(args.length === 3)
        {
          return state.checkoutCommitNewBranch(args[1], args[2]);
        }
      }else if(!(args[0] in state.branches))
      {
        return state.checkoutCommit(args[0]);
      }
      return state.checkout(args[0]);
    },

    // === switch ===
    'switch': function(state, args) {
      if (args.length === 0) {
        return { success: false, output: '用法: git switch <branch> 或 git switch -c <branch>' };
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
      if (args.length === 0) {
        return { success: false, output: '用法: git reset [--soft|--mixed|--hard] <commit>' };
      }
      var mode = '--mixed';
      var target = args[0];
      if (args[0].startsWith('--')) {
        mode = args[0];
        target = args[1];
      }
      if (!target) {
        // reset HEAD is the default
        target = 'HEAD';
      }
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
      return state.tag(args[0]);
    },

    // === rm ===
    'rm': function(state, args) {
      if (args.length === 0) {
        return { success: false, output: '用法: git rm <file>' };
      }
      return state.rm(args[0]);
    },

    // === restore ===
    'restore': function(state, args) {
      if (args.length === 0) {
        return { success: false, output: '用法: git restore <file>' };
      }
      return state.restore(args[0]);
    },

    // === touch (helper: create file) ===
    'touch': function(state, args) {
      if (args.length === 0) {
        return { success: false, output: '用法: touch <filename>' };
      }
      return state.createFile(args[0], args.slice(1).join(' ') || 'hello world');
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
          '  git reset [mode] <commit> 重置',
          '  git revert <hash>     撤销提交',
          '  git tag [name]        创建/列出标签',
          '  git rm <file>         删除文件',
          '  git restore <file>    恢复文件',
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
