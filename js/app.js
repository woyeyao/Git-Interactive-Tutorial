// App — Main entry point, event binding, orchestration
(function() {
  'use strict';

  var GT = window.GitTutorial;

  // Initialize state
  var state = new GT.GitState();

  // Initialize renderer
  var renderer = new GT.Renderer(state);

  // Initialize parser with commands
  var parser = new GT.Parser(state, GT.commands);

  // Tutorial state
  var currentCardIndex = 0;
  var allCards = GT.tutorials;

  // Arrow reveal mapping: command → arrow name(s)
  var ARROW_MAP = {
    'add': ['add'],
    'commit': ['commit'],
    'push': ['push'],
    'pull': ['pull'],
    'fetch': ['pull'],
    'clone': ['clone'],
    'restore': ['restore'],
    'checkout': ['restore']
  };

  // === Terminal Input ===
  var inputEl = document.getElementById('terminal-input');
  var mirrorEl = document.getElementById('terminal-input-mirror');

  // Command lists for Tab completion
  var GIT_SUBCOMMANDS = ['init', 'clone', 'add', 'status', 'commit', 'diff', 'log',
    'branch', 'checkout', 'switch', 'merge', 'push', 'pull', 'fetch', 'rebase',
    'stash', 'cherry-pick', 'reset', 'revert', 'tag', 'rm', 'restore', 'config',
    'remote', 'show', 'blame'];
  var HELPER_COMMANDS = ['touch', 'echo', 'cat', 'clear', 'help', 'reset-tutorial'];

  // Option flags offered after each git subcommand (Tab completion).
  var GIT_FLAGS = {
    'add': ['--all', '--update', '--patch', '--intent-to-add'],
    'restore': ['--staged', '--worktree', '--source', '--cached', '-s'],
    'rm': ['--cached', '--force', '-r'],
    'reset': ['--soft', '--mixed', '--hard'],
    'commit': ['--message', '--amend', '-m'],
    'checkout': ['-b', '--'],
    'switch': ['-c', '-C', '--'],
    'merge': ['--no-ff', '--abort', '--'],
    'tag': ['-a', '-d', '-l'],
    'branch': ['-d', '-D', '-m', '-M'],
    'stash': ['push', 'pop', 'list', 'apply', 'drop', 'show', 'clear', '-u'],
    'diff': ['--staged', '--cached', '--name-only', '--stat'],
    'log': ['--oneline', '--stat', '--graph', '-p'],
    'remote': ['-v', 'add', 'remove', 'rename', 'show'],
    'fetch': ['--all', '--prune'],
    'pull': ['--rebase', '--no-ff'],
    'push': ['--force', '-u', '--set-upstream', '--delete'],
    'rebase': ['--continue', '--abort', '--skip'],
    'cherry-pick': ['--continue', '--abort', '-x']
  };

  function commonPrefix(arr) {
    if (!arr.length) return '';
    var p = arr[0];
    for (var i = 1; i < arr.length; i++) {
      while (arr[i].indexOf(p) !== 0) { p = p.slice(0, -1); if (!p) return ''; }
    }
    return p;
  }

  function colorizeCommand(value) {
    var esc = function(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    var parts = value.split(/\s+/);
    if (parts[0] === 'git') {
      var h = '<span class="git-cmd">git</span>';
      if (parts[1]) h += ' <span class="git-subcmd">' + esc(parts[1]) + '</span>';
      if (parts.length > 2) h += ' <span class="cmd-arg">' + esc(parts.slice(2).join(' ')) + '</span>';
      return h;
    }
    if (HELPER_COMMANDS.indexOf(parts[0]) !== -1) {
      var h2 = '<span class="helper-cmd">' + esc(parts[0]) + '</span>';
      if (parts.length > 1) h2 += ' <span class="cmd-arg">' + esc(parts.slice(1).join(' ')) + '</span>';
      return h2;
    }
    return esc(value);
  }

  function updateMirror() {
    if (mirrorEl) mirrorEl.innerHTML = colorizeCommand(inputEl.value);
  }

  function applyCompletion(newTokens) {
    var v = newTokens.join(' ');
    if (newTokens.length === 1) v += ' ';
    inputEl.value = v;
    updateMirror();
  }

  function doTabCompletion() {
    var val = inputEl.value;
    var trailingSpace = /\s$/.test(val);
    var tokens = val.split(/\s+/).filter(Boolean);
    var prefix, candidates;
    if (tokens.length === 0) {
      candidates = ['git'].concat(HELPER_COMMANDS); prefix = '';
    } else if (tokens[0] === 'git') {
      if (tokens.length === 1) {
        candidates = GIT_SUBCOMMANDS; prefix = '';
      } else if (tokens.length === 2 && tokens[1].charAt(0) !== '-' && GIT_SUBCOMMANDS.indexOf(tokens[1]) === -1) {
        // partial subcommand (e.g. "git resto") -> complete to a subcommand
        candidates = GIT_SUBCOMMANDS; prefix = tokens[1];
      } else {
        var sub = tokens[1];
        var lastTok = trailingSpace ? '' : tokens[tokens.length - 1];
        var hasFlag = tokens.slice(1).some(function(t) { return t.charAt(0) === '-'; });
        var flags = GIT_FLAGS[sub] || [];
        if (lastTok.charAt(0) === '-') {
          // currently typing a flag -> complete from this subcommand's flags
          candidates = flags; prefix = lastTok;
        } else if (trailingSpace && !hasFlag && flags.length) {
          // fresh token right after the subcommand -> offer flags first
          candidates = flags; prefix = '';
        } else {
          candidates = Object.keys(state.workingDir);
          prefix = trailingSpace ? '' : lastTok;
        }
      }
    } else if (HELPER_COMMANDS.indexOf(tokens[0]) !== -1) {
      candidates = Object.keys(state.workingDir);
      prefix = trailingSpace ? '' : tokens[tokens.length - 1];
    } else {
      candidates = []; prefix = '';
    }
    var matches = candidates.filter(function(c) { return c.indexOf(prefix) === 0; });
    // When the caret sits right after a space the user is starting a NEW token,
    // so the completion is appended; otherwise it replaces the last token.
    var append = trailingSpace;
    if (matches.length === 1) {
      if (append) tokens.push(matches[0]); else tokens[tokens.length - 1] = matches[0];
      applyCompletion(tokens);
    } else if (matches.length > 1) {
      // 仅做输入框内联补全：扩展到最长公共前缀，不向终端打印候选清单
      var cp = commonPrefix(matches);
      if (cp.length > prefix.length) {
        if (append) tokens.push(cp); else tokens[tokens.length - 1] = cp;
        applyCompletion(tokens);
      }
    }
  }

  inputEl.addEventListener('input', updateMirror);

  function executeCommand(input) {
    if (!input || !input.trim()) return;

    // Show input in terminal
    renderer.renderTerminalInput(input);

    // Special: clear command (only clears terminal, not zones/arrows)
    if (input.trim() === 'clear') {
      parser.history.push(input.trim());
      parser.historyIndex = parser.history.length;
      renderer.terminalOutput.innerHTML = '';
      renderer.scrollTerminalToBottom();
      return;
    }

    // Parse and execute
    var result = parser.parse(input);

    if (result) {
      renderer.renderTerminalOutput(result);

      // Determine command name
      var parts = input.trim().split(/\s+/);
      var gitCmd = parts[0] === 'git' ? parts[1] : parts[0];

      // Refresh zones
      renderer.renderAll();

      // Special: reset-tutorial also clears arrows
      if (gitCmd === 'reset-tutorial') {
        renderer.visibleArrows = {};
        renderer.drawArrows();
      }

      // Reveal arrows based on command
      revealArrows(gitCmd);

      // Check if current task is completed
      checkTaskCompletion(input.trim());
    }

    renderer.scrollTerminalToBottom();
    inputEl.focus();
  }

  function revealArrows(cmd) {
    var arrowNames = ARROW_MAP[cmd];
    if (!arrowNames) return;
    for (var i = 0; i < arrowNames.length; i++) {
      renderer.showArrow(arrowNames[i]);
    }
  }

  inputEl.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') {
      var input = inputEl.value;
      inputEl.value = '';
      updateMirror();
      executeCommand(input);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      doTabCompletion();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      inputEl.value = parser.getPrevHistory();
      updateMirror();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      inputEl.value = parser.getNextHistory();
      updateMirror();
    }
  });

  // Focus terminal input on click, but only if no text is selected
  document.querySelector('.terminal').addEventListener('click', function(e) {
    var selection = window.getSelection();
    if (selection && selection.toString().length > 0) return;
    // Don't steal focus if user clicked on a link or button
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;
    inputEl.focus();
  });

  // === Tutorial Navigation ===
  function showCard(index) {
    if (index < 0 || index >= allCards.length) return;
    currentCardIndex = index;
    var card = allCards[index];

    renderer.renderCard(card);
    renderer.renderSidebar(GT.chapters, card.id);
    renderer.updateProgress(index + 1, allCards.length);

    document.getElementById('btn-prev').disabled = index === 0;
    document.getElementById('btn-next').disabled = index === allCards.length - 1;

    bindSidebarEvents();
  }

  function checkTaskCompletion(input) {
    var card = allCards[currentCardIndex];
    if (!card || !card.task) return;

    var expected = card.task.prompt;
    var codeMatch = expected.match(/<code>([^<]+)<\/code>/g);
    if (!codeMatch) return;

    var normalizedInput = input.replace(/\s+/g, ' ').trim();

    for (var i = 0; i < codeMatch.length; i++) {
      var expectedCmd = codeMatch[i].replace(/<\/?code>/g, '').trim();
      if (!expectedCmd) continue;

      var normalizedExpected = expectedCmd.replace(/\s+/g, ' ');

      // Exact match, or the user typed the expected command with trailing
      // arguments. Compare token-wise so `git commit -m "first"` does not
      // satisfy a task that only asked for `git commit`.
      if (normalizedInput === normalizedExpected) {
        renderer.markTaskCompleted();
        if (card.id === 'ch5-pull') celebrate();
        return;
      }

      // A prompt with no flags (e.g. `git status`) also accepts extra args.
      var expectsFlags = /\s-/.test(normalizedExpected);
      if (!expectsFlags && normalizedInput.indexOf(normalizedExpected + ' ') === 0) {
        renderer.markTaskCompleted();
        if (card.id === 'ch5-pull') celebrate();
        return;
      }
    }
  }

  function celebrate() {
    // 1. 终端庆祝文字
    var lines = [
      '',
      '  ╔══════════════════════════════════════╗',
      '  ║                                      ║',
      '  ║   🎉 恭喜！你已掌握 Git 核心工作流     ║',
      '  ║                                      ║',
      '  ║      add → commit → push & pull      ║',
      '  ║                                      ║',
      '  ╚══════════════════════════════════════╝',
      ''
    ];
    var out = document.getElementById('terminal-output');
    lines.forEach(function(line) {
      var div = document.createElement('div');
      div.className = 'terminal-line celebrate-msg';
      div.textContent = line;
      out.appendChild(div);
    });
    renderer.scrollTerminalToBottom();

    // 2. 箭头逐个点亮，最后全部亮
    var arrows = ['add', 'commit', 'push', 'pull', 'clone', 'restore'];
    var delay = 0;
    var step = 1000;

    // 先熄灭所有箭头
    arrows.forEach(function(name) { renderer.hideArrow(name); });

    // 逐个点亮
    arrows.forEach(function(name, i) {
      setTimeout(function() {
        // 熄灭前一个，亮当前
        if (i > 0) renderer.hideArrow(arrows[i - 1]);
        renderer.showArrow(name);
      }, delay);
      delay += step;
    });

    // 最后全部亮
    setTimeout(function() {
      arrows.forEach(function(name) { renderer.showArrow(name); });
    }, delay);
  }

  // Nav buttons
  document.getElementById('btn-prev').addEventListener('click', function() {
    showCard(currentCardIndex - 1);
  });

  document.getElementById('btn-next').addEventListener('click', function() {
    showCard(currentCardIndex + 1);
  });

  // Sidebar events (delegated)
  function bindSidebarEvents() {
    var sidebar = document.getElementById('sidebar-chapters');

    sidebar.onclick = function(e) {
      var chapterTitle = e.target.closest('.chapter-title');
      if (chapterTitle) {
        var chapterCards = chapterTitle.parentElement.querySelector('.chapter-cards');
        if (chapterCards.style.display === 'none') {
          chapterCards.style.display = '';
          chapterTitle.classList.add('expanded');
        } else {
          chapterCards.style.display = 'none';
          chapterTitle.classList.remove('expanded');
        }
        return;
      }

      var cardItem = e.target.closest('.card-item');
      if (cardItem) {
        var cardId = cardItem.getAttribute('data-card-id');
        for (var i = 0; i < allCards.length; i++) {
          if (allCards[i].id === cardId) {
            showCard(i);
            break;
          }
        }
      }
    };
  }


  //right-click context menu
  function handleRightCtxAction(x, y, target) {
    var ctxMenu = document.getElementById('ctx-menu');
    ctxMenu.style.left = x + 'px';
    ctxMenu.style.top = y + 'px';
    ctxMenu.hidden = false;
    if (target!==null && target.classList.contains('zone-file')) {
      document.getElementById('ctx-create').hidden = true;
      document.getElementById('ctx-delete').hidden = false;
    } else {
      document.getElementById('ctx-create').hidden = false;
      document.getElementById('ctx-delete').hidden = true;
    }
  }
  var ctxMenu = document.getElementById('zone-working-files');
  var target = null;
  ctxMenu.addEventListener('contextmenu', function(e) {
    if(!state.initialized) return;
    e.preventDefault();
    target = e.target.closest('.zone-file, .zone-folder');
    handleRightCtxAction(e.clientX, e.clientY,target);
  });

  // Double-click any file in the Working Directory OR Staging Area to view its
  // content in the modal. Staging-area files open read-only (view only); the
  // working-directory file opens editable.
  function openFileModal(e) {
    e.stopPropagation();
    var target = e.target.closest('.zone-file');
    if (!target) return;
    var nameEl = target.querySelector('.file-name');
    if (!nameEl) return;
    var fileName = nameEl.textContent;
    var inIndex = !!target.closest('#zone-index-files');
    var file = inIndex ? state.staging[fileName] : state.workingDir[fileName];
    if (!file) return;

    var content = file.content || '';
    var committedContent = '';
    if (state.HEAD) {
      var lastCommit = state._getCommit(state.HEAD);
      if (lastCommit && lastCommit.files[fileName]) committedContent = lastCommit.files[fileName].content || '';
    }

    var baseContent, diff;
    if (inIndex) {
      // Staging view: diff against the last committed version (HEAD).
      baseContent = committedContent;
    } else {
      // Working view: diff against staging if staged, else against HEAD.
      var st = state.staging[fileName];
      baseContent = st ? st.content : committedContent;
    }
    diff = computeFileDiff(fileName, baseContent, content);

    document.getElementById('modal-title').textContent = fileName + (inIndex ? '（暂存区）' : '');
    document.getElementById('modal-editor').value = content;
    document.getElementById('modal-diff').innerHTML = diff || '';
    document.getElementById('ctx-menu').hidden = true;

    // Staging files are view-only.
    document.getElementById('modal-editor').readOnly = inIndex;
    document.getElementById('modal-save').disabled = inIndex;

    currentEditFile = fileName;
    currentEditZone = inIndex ? 'index' : 'work';
    document.getElementById('file-modal').hidden = false;
  }

  document.getElementById('zone-working-files').addEventListener('dblclick', openFileModal);
  document.getElementById('zone-index-files').addEventListener('dblclick', openFileModal);

  // Render a diff preview (baseContent -> targetContent) using the same LCS diff
  // the terminal's `git diff` uses, so the modal and command output never
  // disagree. An index-by-index comparison would repaint every line after an
  // insertion as changed. Callers pass the appropriate base (HEAD / staging).
  function computeFileDiff(fileName, baseContent, targetContent) {
    if (targetContent === baseContent) return '';

    // Reuse the state's line diff: feed it the two versions and keep only the
    // body lines (skip the diff --git / --- / +++ / @@ headers).
    var raw = state._formatDiff(fileName, baseContent, targetContent);
    var lines = raw.split('\n');
    var html = '';
    var started = false;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!started) {
        if (line.charAt(0) === '@') started = true;   // first hunk header
        continue;
      }
      if (line.charAt(0) === '@') continue;           // later hunk headers

      var cls = 'diff-line';
      var text = line;
      if (line.charAt(0) === '+') { cls += ' diff-add'; text = line.substring(1); }
      else if (line.charAt(0) === '-') { cls += ' diff-del'; text = line.substring(1); }
      else if (line.charAt(0) === ' ') { text = line.substring(1); }

      html += '<span class="' + cls + '">' + escapeHtml(text) + '</span>\n';
    }
    return html;
  }

  function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  var currentEditFile = null;
  var currentEditZone = null;
  function closeFileModal() {
    document.getElementById('file-modal').hidden = true;
    document.getElementById('modal-editor').readOnly = false;
    document.getElementById('modal-save').disabled = false;
    currentEditFile = null;
    currentEditZone = null;
  }
  document.getElementById('modal-save').addEventListener('click', function() {
    // Only the working-directory file is editable; staging files open read-only.
    if (currentEditZone === 'work' && currentEditFile) {
      var newContent = document.getElementById('modal-editor').value;
      state.modifyFile(currentEditFile, newContent);
      renderer.renderAll();
    }
    closeFileModal();
  });
  document.getElementById('modal-cancel').addEventListener('click', closeFileModal);
  document.getElementById('modal-close').addEventListener('click', closeFileModal);

  document.getElementById('ctx-create').addEventListener('click', function(e) {
    e.stopPropagation();
    var fileName = prompt('请输入文件名');
    if (!fileName) 
    {
      document.getElementById('ctx-menu').hidden = true;
      return;
    }
    state.createFile(fileName);
    document.getElementById('ctx-menu').hidden = true;
    renderer.renderAll();
  });
  document.getElementById('ctx-delete').addEventListener('click', function() {
    // `target` is the element captured on right-click; guard against it being
    // stale (e.g. the menu was opened before a re-render).
    if (target) {
      var nameEl = target.querySelector('.file-name');
      if (nameEl) {
        var res = state.deleteFile(nameEl.textContent);
        if (res && res.output) renderer.renderTerminalOutput(res);
      }
    }
    document.getElementById('ctx-menu').hidden = true;
    renderer.renderAll();
  });

  document.addEventListener('click', function() {
    document.getElementById('ctx-menu').hidden = true;
  });

  // === LocalStorage ===
  function saveState() {
    try {
      localStorage.setItem('git-tutorial-state', JSON.stringify({
        initialized: state.initialized,
        workingDir: state.workingDir,
        staging: state.staging,
        commits: state.commits,
        branches: state.branches,
        currentBranch: state.currentBranch,
        HEAD: state.HEAD,
        remote: state.remote,
        stash: state.stash,
        tags: state.tags,
        config: state.config,
        mergeConflict: state.mergeConflict,
        mergeConflictKinds: state.mergeConflictKinds,
        pendingMerge: state.pendingMerge,
        visibleArrows: renderer.visibleArrows
      }));
    } catch (e) {}
  }

  function loadState() {
    try {
      var saved = localStorage.getItem('git-tutorial-state');
      if (!saved) return;
      var parsed = JSON.parse(saved);
      for (var key in parsed) {
        if (key === 'visibleArrows') {
          renderer.visibleArrows = parsed[key] || {};
        } else if (key in state) {
          state[key] = parsed[key];
        }
      }
      renderer.renderAll();
      renderer.drawArrows();
    } catch (e) {}
  }

  // === Initial Render ===
  function init() {
    renderer.renderAll();
    showCard(0);
    inputEl.focus();
    updateMirror();

    renderer.renderTerminalOutput({
      success: true,
      output: '欢迎使用 Git 交互式教程！\n输入 git help 查看所有命令，输入 reset-tutorial 重置所有状态。\n跟随左侧教程卡片，在终端中实践操作。\n'
    });
    renderer.scrollTerminalToBottom();

    // Restore saved state
    loadState();

    // Redraw arrows after layout settles
    setTimeout(function() { renderer.drawArrows(); }, 100);

    // Periodic save
    setInterval(saveState, 2000);
  }

  init();
})();
