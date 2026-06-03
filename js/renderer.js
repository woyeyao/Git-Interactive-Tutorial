// Renderer — Manages all UI rendering
var GitTutorial = window.GitTutorial || {};

(function() {
  'use strict';

  function Renderer(state) {
    this.state = state;

    // Arrow visibility state — once shown, stays shown
    this.visibleArrows = {};

    // Cache DOM refs
    this.zones = {
      working: document.getElementById('zone-working-files'),
      index: document.getElementById('zone-index-files'),
      local: document.getElementById('zone-local-files'),
      remote: document.getElementById('zone-remote-files')
    };

    this.zoneContainers = {
      working: document.getElementById('zone-working'),
      index: document.getElementById('zone-index'),
      local: document.getElementById('zone-local'),
      remote: document.getElementById('zone-remote')
    };

    this.arrowsSvg = document.getElementById('arrows-overlay');
    this.terminalOutput = document.getElementById('terminal-output');
    this.cardContent = document.getElementById('card-content');
    this.taskPrompt = document.getElementById('task-prompt');
    this.cardTask = document.getElementById('card-task');
    this.cardProgress = document.getElementById('card-progress');
    this.sidebarChapters = document.getElementById('sidebar-chapters');

    // Redraw arrows on resize
    var self = this;
    window.addEventListener('resize', function() { self.drawArrows(); });
  }

  // === Zone Rendering ===
  Renderer.prototype.renderZones = function() {
    this._renderWorkingDir();
    this._renderStaging();
    this._renderLocalRepo();
    this._renderRemote();
  };

  Renderer.prototype._renderWorkingDir = function() {
    var el = this.zones.working;
    if (!this.state.initialized) {
      el.innerHTML = '<div class="zone-empty">尚未初始化<br><span style="font-size:11px;color:var(--text-muted)">运行 git init 开始</span></div>';
      return;
    }

    var files = Object.keys(this.state.workingDir);
    // Show .git folder indicator when initialized
    var html = '<div class="zone-file"><span class="file-name" style="color:var(--text-muted)">.git/</span><span class="file-status staged">dir</span></div>';

    if (files.length === 0) {
      html += '<div class="zone-empty" style="padding-top:8px">工作区干净</div>';
    } else {
      for (var i = 0; i < files.length; i++) {
        var fname = files[i];
        var f = this.state.workingDir[fname];
        var statusClass = f.status || '';
        var statusText = this._statusLabel(f.status);
        html += '<div class="zone-file">' +
          '<span class="file-name">' + this._escapeHtml(fname) + '</span>' +
          (statusText ? '<span class="file-status ' + statusClass + '">' + statusText + '</span>' : '') +
          '</div>';
      }
    }
    el.innerHTML = html;
  };

  Renderer.prototype._renderStaging = function() {
    var el = this.zones.index;
    if (!this.state.initialized) {
      el.innerHTML = '<div class="zone-empty">尚未初始化</div>';
      return;
    }

    var files = Object.keys(this.state.staging);
    if (files.length === 0) {
      el.innerHTML = '<div class="zone-empty">暂存区为空</div>';
      return;
    }

    var html = '';
    for (var i = 0; i < files.length; i++) {
      var fname = files[i];
      var f = this.state.staging[fname];
      var statusText = f.deleted ? 'deleted' : 'staged';
      html += '<div class="zone-file">' +
        '<span class="file-name">' + this._escapeHtml(fname) + '</span>' +
        '<span class="file-status staged">' + statusText + '</span>' +
        '</div>';
    }
    el.innerHTML = html;
  };

  Renderer.prototype._renderLocalRepo = function() {
    var el = this.zones.local;
    if (!this.state.initialized) {
      el.innerHTML = '<div class="zone-empty">尚未初始化</div>';
      return;
    }

    if (this.state.commits.length === 0) {
      el.innerHTML = '<div class="zone-empty">暂无提交<br><span style="font-size:11px;color:var(--text-muted)">运行 git commit 提交</span></div>';
      return;
    }

    var commits = this.state.commits.slice(-5).reverse();
    var html = '';
    for (var i = 0; i < commits.length; i++) {
      var c = commits[i];
      var isHead = c.hash === this.state.HEAD;
      html += '<div class="zone-file">' +
        '<span class="file-name" style="color:' + (isHead ? 'var(--accent)' : 'var(--text-secondary)') + '">' +
        c.hash.substring(0, 7) + ' ' + this._escapeHtml(c.message) +
        '</span>' +
        (isHead ? '<span class="file-status staged">HEAD</span>' : '') +
        '</div>';
    }

    var branchHtml = '<div style="font-size:11px;color:var(--text-muted);padding:4px 8px;margin-bottom:4px">📋 ' +
      this.state.currentBranch + ' · ' + this.state.commits.length + ' commits</div>';
    el.innerHTML = branchHtml + html;
  };

  Renderer.prototype._renderRemote = function() {
    var el = this.zones.remote;
    if (!this.state.initialized) {
      el.innerHTML = '<div class="zone-empty">尚未初始化</div>';
      return;
    }

    if (this.state.remote.commits.length === 0) {
      el.innerHTML = '<div class="zone-empty">远程仓库为空<br><span style="font-size:11px;color:var(--text-muted)">运行 git push 推送</span></div>';
      return;
    }

    var commits = this.state.remote.commits.slice(-5).reverse();
    var html = '';
    for (var i = 0; i < commits.length; i++) {
      var c = commits[i];
      html += '<div class="zone-file">' +
        '<span class="file-name" style="color:var(--text-secondary)">' +
        c.hash.substring(0, 7) + ' ' + this._escapeHtml(c.message) +
        '</span></div>';
    }

    var branchHtml = '<div style="font-size:11px;color:var(--text-muted);padding:4px 8px;margin-bottom:4px">☁️ origin/' +
      this.state.currentBranch + ' · ' + this.state.remote.commits.length + ' commits</div>';
    el.innerHTML = branchHtml + html;
  };

  Renderer.prototype._statusLabel = function(status) {
    switch (status) {
      case 'new': return 'new';
      case 'modified': return 'mod';
      case 'staged': return 'staged';
      case 'deleted': return 'del';
      case 'committed': return '';
      default: return '';
    }
  };

  // === SVG Arrow System ===
  Renderer.prototype.showArrow = function(name) {
    if (this.visibleArrows[name]) return;
    this.visibleArrows[name] = true;
    this.drawArrows();
  };

  Renderer.prototype.hideArrow = function(name) {
    if (!this.visibleArrows[name]) return;
    this.visibleArrows[name] = false;
    this.drawArrows();
  };

  Renderer.prototype.drawArrows = function() {
    if (!this.arrowsSvg) return;
    var container = this.zones.working ? this.zones.working.closest('.zones') : null;
    if (!container) return;

    var cw = container.offsetWidth;
    var ch = container.offsetHeight;
    this.arrowsSvg.setAttribute('width', cw);
    this.arrowsSvg.setAttribute('height', ch);

    var cRect = container.getBoundingClientRect();

    // Get zone positions relative to container
    var zoneNames = ['working', 'index', 'local', 'remote'];
    var pos = {};
    for (var i = 0; i < zoneNames.length; i++) {
      var el = this.zoneContainers[zoneNames[i]];
      if (!el) continue;
      var r = el.getBoundingClientRect();
      pos[zoneNames[i]] = {
        left: r.left - cRect.left,
        right: r.right - cRect.left,
        top: r.top - cRect.top,
        bottom: r.bottom - cRect.top,
        midX: (r.left + r.right) / 2 - cRect.left,
        midY: (r.top + r.bottom) / 2 - cRect.top
      };
    }

    var color = '#58a6ff';
    var ahSize = 10;
    var svg = '';

    // Arrowhead: right-pointing triangle
    function rightAh(x, y) {
      var h = ahSize * 0.7;
      return '<polygon points="' + x + ',' + y + ' ' + (x - ahSize) + ',' + (y - h / 2) + ' ' + (x - ahSize) + ',' + (y + h / 2) + '" fill="' + color + '"/>';
    }
    // Arrowhead: left-pointing triangle
    function leftAh(x, y) {
      var h = ahSize * 0.7;
      return '<polygon points="' + x + ',' + y + ' ' + (x + ahSize) + ',' + (y - h / 2) + ' ' + (x + ahSize) + ',' + (y + h / 2) + '" fill="' + color + '"/>';
    }

    // --- Adjacent arrows (horizontal, between neighboring zones) ---
    var adjArrows = [
      { name: 'add', from: 'working', to: 'index', label: 'git add' },
      { name: 'commit', from: 'index', to: 'local', label: 'git commit' },
      { name: 'push', from: 'local', to: 'remote', label: 'git push' }
    ];

    for (var a = 0; a < adjArrows.length; a++) {
      var ar = adjArrows[a];
      if (!pos[ar.from] || !pos[ar.to]) continue;

      var x1 = pos[ar.from].right;
      var x2 = pos[ar.to].left;
      var y = pos[ar.from].midY;
      var cls = this.visibleArrows[ar.name] ? 'arrow-group visible' : 'arrow-group';

      svg += '<g class="' + cls + '">';
      svg += '<line x1="' + x1 + '" y1="' + y + '" x2="' + (x2 - ahSize) + '" y2="' + y + '" stroke="' + color + '" stroke-width="2"/>';
      svg += rightAh(x2, y);
      svg += '<text x="' + ((x1 + x2) / 2) + '" y="' + (y - 12) + '" text-anchor="middle" fill="' + color + '" font-size="11">' + ar.label + '</text>';
      svg += '</g>';
    }

    // --- Cross-zone arrows (straight horizontal lines at bottom) ---
    var zoneH = pos.working.bottom - pos.working.top;
    var pullY = pos.working.bottom - zoneH * 0.15;
    var cloneY = pos.working.bottom - zoneH * 0.05;
    var mergeY = cloneY;

    var crossArrows = [
      { name: 'restore', from: 'local', to: 'working', label: 'git restore', y: mergeY },
      { name: 'pull', from: 'remote', to: 'working', label: 'git pull', y: pullY },
      { name: 'clone', from: 'remote', to: 'local', label: 'git clone', y: cloneY }
    ];

    for (var c = 0; c < crossArrows.length; c++) {
      var cr = crossArrows[c];
      if (!pos[cr.from] || !pos[cr.to]) continue;

      var x1 = pos[cr.from].left;
      var x2 = pos[cr.to].right;
      var y = cr.y;
      var cls = this.visibleArrows[cr.name] ? 'arrow-group visible' : 'arrow-group';

      svg += '<g class="' + cls + '">';
      svg += '<line x1="' + x1 + '" y1="' + y + '" x2="' + (x2 + ahSize) + '" y2="' + y + '" stroke="' + color + '" stroke-width="2"/>';
      svg += leftAh(x2, y);
      var labelX = (x1 + x2) / 2;
      svg += '<text x="' + labelX + '" y="' + (y - 8) + '" text-anchor="middle" fill="' + color + '" font-size="11">' + cr.label + '</text>';
      svg += '</g>';
    }

    this.arrowsSvg.innerHTML = svg;
  };

  // === Flash Zone (temporary highlight) ===
  Renderer.prototype.flashZone = function(name) {
    var zone = this.zoneContainers[name];
    if (!zone) return;
    zone.classList.add('active');
    setTimeout(function() {
      zone.classList.remove('active');
    }, 1200);
  };

  // === Terminal Output ===
  Renderer.prototype.renderTerminalInput = function(input) {
    var div = document.createElement('div');
    div.className = 'terminal-line input';

    if (!input.startsWith('git')) {
      div.innerHTML = '<span class="prompt-sign">$ </span>' + this._escapeHtml(input);
    } else {
      div.innerHTML = '<span class="prompt-sign">$ </span><span class="git-cmd">' +
        this._escapeHtml(input.split(' ').slice(0, 2).join(' ')) + '</span> ' +
        this._escapeHtml(input.split(' ').slice(2).join(' '));
    }

    this.terminalOutput.appendChild(div);
  };

  Renderer.prototype.renderTerminalOutput = function(result) {
    if (!result) return;

    if (result.output === '__CLEAR__') {
      this.terminalOutput.innerHTML = '';
      return;
    }

    var className = result.success ? 'output' : 'error';

    var lines = (result.output || '').split('\n');
    for (var i = 0; i < lines.length; i++) {
      var div = document.createElement('div');
      div.className = 'terminal-line ' + className;
      div.textContent = lines[i];
      this.terminalOutput.appendChild(div);
    }
  };

  Renderer.prototype.scrollTerminalToBottom = function() {
    this.terminalOutput.scrollTop = this.terminalOutput.scrollHeight;
  };

  // === Tutorial Cards ===
  Renderer.prototype.renderCard = function(card) {
    if (!card) return;

    this.cardContent.innerHTML = this._renderMarkdown(card.content);
    this.cardTask.classList.remove('completed');

    if (card.task) {
      this.taskPrompt.innerHTML = card.task.prompt;
      this.cardTask.style.display = 'flex';
    } else {
      this.cardTask.style.display = 'none';
    }
  };

  Renderer.prototype.renderSidebar = function(chapters, currentCardId) {
    var html = '';
    for (var i = 0; i < chapters.length; i++) {
      var ch = chapters[i];
      var isActive = false;
      for (var j = 0; j < ch.cards.length; j++) {
        if (ch.cards[j].id === currentCardId) {
          isActive = true;
          break;
        }
      }

      html += '<div class="chapter-group">';
      html += '<div class="chapter-title' + (isActive ? ' active expanded' : '') + '" data-chapter="' + i + '">' +
        '<span>' + (i + 1) + '. ' + ch.title + '</span>' +
        '<span class="chevron">&#9654;</span>' +
        '</div>';

      html += '<div class="chapter-cards" style="' + (isActive ? '' : 'display:none') + '">';
      for (var k = 0; k < ch.cards.length; k++) {
        var card = ch.cards[k];
        var cardActive = card.id === currentCardId ? ' active' : '';
        html += '<div class="card-item' + cardActive + '" data-card-id="' + card.id + '">' +
          card.title + '</div>';
      }
      html += '</div></div>';
    }
    this.sidebarChapters.innerHTML = html;
  };

  Renderer.prototype.updateProgress = function(current, total) {
    this.cardProgress.textContent = current + ' / ' + total;
  };

  Renderer.prototype.markTaskCompleted = function() {
    this.cardTask.classList.add('completed');
  };

  // === Helpers ===
  Renderer.prototype._escapeHtml = function(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  };

  Renderer.prototype._renderMarkdown = function(md) {
    if (!md) return '';

    // Step 1: Extract code blocks (line-by-line for reliability)
    var lines = md.split('\n');
    var blocks = [];
    var inCode = false;
    var codeLines = [];

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!inCode && /^```/.test(line)) {
        inCode = true;
        codeLines = [];
      } else if (inCode && /^```$/.test(line)) {
        inCode = false;
        blocks.push({ type: 'code', content: codeLines.join('\n') });
      } else if (inCode) {
        codeLines.push(line);
      } else {
        blocks.push({ type: 'line', content: line });
      }
    }
    // Unclosed code block
    if (inCode) {
      blocks.push({ type: 'code', content: codeLines.join('\n') });
    }

    // Step 2: Process non-code lines
    var html = '';
    for (var j = 0; j < blocks.length; j++) {
      var b = blocks[j];
      if (b.type === 'code') {
        html += '<pre><code>' + this._escapeHtml(b.content) + '</code></pre>';
      } else {
        html += this._renderInline(b.content) + '\n';
      }
    }

    // Step 3: Wrap consecutive <li> in <ul>
    html = html.replace(/(<li>[\s\S]*?<\/li>)/g, '<ul>$1</ul>');
    html = html.replace(/<\/ul>\s*<ul>/g, '');

    return html;
  };

  Renderer.prototype._renderInline = function(line) {
    if (!line) return '';

    // Headers
    if (/^### (.+)$/.test(line)) return '<h3>' + RegExp.$1 + '</h3>';
    if (/^## (.+)$/.test(line)) return '<h2>' + RegExp.$1 + '</h2>';

    // List items
    if (/^- (.+)$/.test(line)) {
      return '<li>' + this._formatInline(RegExp.$1) + '</li>';
    }

    // Blockquote
    if (/^>\s?(.+)$/.test(line)) {
      return '<blockquote>' + this._formatInline(RegExp.$1) + '</blockquote>';
    }

    // Skip empty lines
    if (/^\s*$/.test(line)) return '';

    // Regular paragraph
    return '<p>' + this._formatInline(line) + '</p>';
  };

  Renderer.prototype._formatInline = function(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%">')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" style="color:var(--accent)">$1</a>');
  };

  // === Full Render ===
  Renderer.prototype.renderAll = function() {
    this.renderZones();
  };

  // Expose
  GitTutorial.Renderer = Renderer;
  window.GitTutorial = GitTutorial;
})();
