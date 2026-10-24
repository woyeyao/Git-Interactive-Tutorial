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
    var html = '<div class="zone-file"><span class="file-status staged">dir</span></div>';

    // Surface an unresolved merge conflict prominently
    if (this.state.mergeConflict && this.state.mergeConflict.length > 0) {
      html += '<div class="zone-empty" style="padding:6px 8px;color:var(--red);font-size:11px">' +
        '⚠️ 合并冲突待解决: ' + this.state.mergeConflict.length + ' 个文件</div>';
    }

    if (files.length === 0) {
      html += '<div class="zone-empty" style="padding-top:8px">工作区干净</div>';
    } else {
      for (var i = 0; i < files.length; i++) {
        var fname = files[i];
        var f = this.state.workingDir[fname];
        var statusClass = f.status || '';
        var statusText = this._statusLabel(f.status);
        // A conflicted file is highlighted as such
        if (this.state.mergeConflict && this.state.mergeConflict.indexOf(fname) !== -1) {
          statusClass = 'deleted';
          statusText = 'conflict';
        }
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
      // A staged deletion is red, not the blue used for staged additions.
      var statusClass = f.deleted ? 'deleted' : 'staged';
      html += '<div class="zone-file">' +
        '<span class="file-name">' + this._escapeHtml(fname) + '</span>' +
        '<span class="file-status ' + statusClass + '">' + statusText + '</span>' +
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

    // Build git graph
    var graphHtml = this._buildGitGraph();
    el.innerHTML = graphHtml;
  };

  Renderer.prototype._buildGitGraph = function() {
    var self = this;
    var commits = this.state.commits;
    var branches = this.state.branches;
    var HEAD = this.state.HEAD;
    var currentBranch = this.state.currentBranch;

    // Branch colors
    var branchColors = ['#58a6ff', '#3fb950', '#d29922', '#bc8cff', '#f85149', '#db6d28', '#8957e5'];
    var branchColorMap = {};
    var colorIndex = 0;
    for (var b in branches) {
      branchColorMap[b] = branchColors[colorIndex % branchColors.length];
      colorIndex++;
    }

    // Build commit map
    var commitMap = {};
    for (var i = 0; i < commits.length; i++) {
      commitMap[commits[i].hash] = commits[i];
    }

    // Build children map (reverse of parent)
    var childrenMap = {};
    for (var i = 0; i < commits.length; i++) {
      var c = commits[i];
      childrenMap[c.hash] = [];
    }
    for (var i = 0; i < commits.length; i++) {
      var c = commits[i];
      if (c.parent && childrenMap[c.parent]) {
        childrenMap[c.parent].push({hash: c.hash, type: 'parent'});
      }
      if (c.mergeParent && childrenMap[c.mergeParent]) {
        childrenMap[c.mergeParent].push({hash: c.hash, type: 'merge'});
      }
    }

    // Calculate lanes from HEAD backwards
    var commitLane = {};
    var nextLane = 0;
    var branchStartCommit = {};

    // Find branch start commits
    for (var branchName in branches) {
      var tipHash = branches[branchName];
      branchStartCommit[tipHash] = branchName;
    }

    // Assign lanes starting from each branch tip
    function assignLaneFromCommit(hash, preferredLane) {
      if (commitLane[hash] !== undefined) {
        return commitLane[hash];
      }

      var commit = commitMap[hash];
      if (!commit) return 0;

      // Use preferred lane or create new
      var lane = preferredLane !== undefined ? preferredLane : nextLane++;
      commitLane[hash] = lane;

      // Continue with parent
      if (commit.parent) {
        var parentCommit = commitMap[commit.parent];
        if (parentCommit) {
          // Check if parent has multiple children (branch point)
          var siblings = childrenMap[commit.parent] || [];
          if (siblings.length > 1) {
            // This is a branch point, assign parent to same lane as first child
            assignLaneFromCommit(commit.parent, lane);
          } else {
            assignLaneFromCommit(commit.parent, lane);
          }
        }
      }

      return lane;
    }

    // Process branches: main first, then others
    var branchList = Object.keys(branches);
    branchList.sort(function(a, b) {
      if (a === 'main' || a === 'master') return -1;
      if (b === 'main' || b === 'master') return 1;
      return 0;
    });

    for (var i = 0; i < branchList.length; i++) {
      var branchName = branchList[i];
      var tipHash = branches[branchName];
      assignLaneFromCommit(tipHash);
    }

    // Any commit not reachable from a branch tip (detached HEAD, or every
    // branch deleted) still belongs to history. Walk back from HEAD so the
    // whole line shares one lane instead of getting a lane per commit, which
    // drew a straight history as a staircase.
    if (HEAD && commitMap[HEAD] && commitLane[HEAD] === undefined) {
      assignLaneFromCommit(HEAD, 0);
    }
    for (var i = 0; i < commits.length; i++) {
      if (commitLane[commits[i].hash] === undefined) {
        var orphanCommit = commits[i];
        // Reuse the lane of a child that already has one, so an orphan chain
        // is drawn on a single lane.
        var orphanLane;
        var orphanChildren = childrenMap[orphanCommit.hash] || [];
        for (var oc = 0; oc < orphanChildren.length; oc++) {
          if (commitLane[orphanChildren[oc].hash] !== undefined) {
            orphanLane = commitLane[orphanChildren[oc].hash];
            break;
          }
        }
        assignLaneFromCommit(orphanCommit.hash, orphanLane);
      }
    }

    var maxLane = 0;
    for (var h in commitLane) {
      maxLane = Math.max(maxLane, commitLane[h]);
    }

    // Build ordered list (newest first for display)
    var orderedCommits = commits.slice().reverse();
    var orderedCommitIndex = {};
    for (var i = 0; i < orderedCommits.length; i++) {
      orderedCommitIndex[orderedCommits[i].hash] = i;
    }

    // Settings
    var nodeRadius = 5;
    var laneWidth = 14;
    var commitHeight = 32;
    var leftPadding = 16;
    var svgWidth = leftPadding + (maxLane + 1) * laneWidth + 8;

    var connections = [];
    for (var i = 0; i < orderedCommits.length; i++) {
      var c = orderedCommits[i];
      var fromRow = i;

      // Parent connection
      if (c.parent && commitLane[c.parent] !== undefined) {
        var toRow = orderedCommitIndex[c.parent];
        if (toRow !== undefined) {
          connections.push({
            fromHash: c.hash,
            toHash: c.parent,
            fromLane: commitLane[c.hash],
            toLane: commitLane[c.parent],
            color: branchColorMap[c.branch] || '#58a6ff',
            type: 'parent',
            fromRow: fromRow,
            toRow: toRow
          });
        }
      }

      // Merge parent connection
      if (c.mergeParent && commitLane[c.mergeParent] !== undefined) {
        var toRow = orderedCommitIndex[c.mergeParent];
        if (toRow !== undefined) {
          connections.push({
            fromHash: c.hash,
            toHash: c.mergeParent,
            fromLane: commitLane[c.hash],
            toLane: commitLane[c.mergeParent],
            color: '#f85149',
            type: 'merge',
            fromRow: fromRow,
            toRow: toRow
          });
        }
      }
    }

    // Build HTML with inline SVG for each row
    var html = '<div class="git-graph-rows">';

    for (var i = 0; i < orderedCommits.length; i++) {
      var c = orderedCommits[i];
      var lane = commitLane[c.hash] || 0;
      var isHead = c.hash === HEAD;
      var color = branchColorMap[c.branch] || '#58a6ff';

      // Find branches at this commit
      var branchNames = [];
      for (var bn in branches) {
        if (branches[bn] === c.hash) {
          branchNames.push(bn);
        }
      }

      // Build SVG for this row
      var rowSvgHeight = commitHeight;
      var rowSvg = '<svg class="git-graph-row-svg" width="' + svgWidth + '" height="' + rowSvgHeight + '">';

      // Draw all connections that pass through this row
      for (var j = 0; j < connections.length; j++) {
        var conn = connections[j];
        // This connection passes through this row if:
        // - it starts at this row (fromRow === i), draw down
        // - it passes through this row (fromRow < i && i < toRow), draw vertical through
        if (conn.fromRow === i) {
          // Starting from this row
          var x1 = leftPadding + conn.fromLane * laneWidth + nodeRadius;
          var y1 = nodeRadius + 10;
          var x2 = leftPadding + conn.toLane * laneWidth + nodeRadius;
          var y2 = rowSvgHeight + nodeRadius + 10;

          if (conn.fromLane === conn.toLane) {
            // Straight line down
            rowSvg += '<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + conn.color + '" stroke-width="2"/>';
          } else {
            // Bezier curve
            var midY = (y1 + y2) / 2;
            var dash = conn.type === 'merge' ? ' stroke-dasharray="3,2"' : '';
            rowSvg += '<path d="M' + x1 + ',' + y1 + ' C' + x1 + ',' + midY + ' ' + x2 + ',' + midY + ' ' + x2 + ',' + y2 + '" stroke="' + conn.color + '" stroke-width="2" fill="none"' + dash + '/>';
          }
        } else if (conn.fromRow < i && i < conn.toRow) {
          // Passing through this row - draw vertical line
          var x = leftPadding + conn.toLane * laneWidth + nodeRadius;
          var y1 = 0;
          var y2 = rowSvgHeight;
          rowSvg += '<line x1="' + x + '" y1="' + y1 + '" x2="' + x + '" y2="' + y2 + '" stroke="' + conn.color + '" stroke-width="2"/>';
        }
      }

      // Draw node
      var nx = leftPadding + lane * laneWidth + nodeRadius;
      var ny = nodeRadius + 12;
      if (isHead) {
        rowSvg += '<circle cx="' + nx + '" cy="' + ny + '" r="' + (nodeRadius + 2) + '" fill="none" stroke="' + color + '" stroke-width="2"/>';
      }
      rowSvg += '<circle cx="' + nx + '" cy="' + ny + '" r="' + nodeRadius + '" fill="' + color + '"/>';

      rowSvg += '</svg>';

      // Build branch tags
      var branchTags = '';
      for (var j = 0; j < branchNames.length; j++) {
        var bn = branchNames[j];
        var bc = branchColorMap[bn] || '#58a6ff';
        var isCurrent = bn === currentBranch;
        branchTags += '<span class="git-graph-branch" style="background:' + bc + (isCurrent ? ';font-weight:600' : '') + '">' + (isCurrent ? 'HEAD → ' : '') + this._escapeHtml(bn) + '</span>';
      }

      // Build row
      html += '<div class="git-graph-row' + (isHead ? ' head' : '') + '">' +
        rowSvg +
        '<div class="git-graph-info">' +
        '<span class="commit-hash">' + c.hash.substring(0, 7) + '</span>' +
        '<span class="commit-message">' + this._escapeHtml(c.message) + '</span>' +
        branchTags +
        '</div>' +
        '</div>';
    }

    html += '</div>';
    return html;
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
      (this.state.currentBranch || 'HEAD') + ' · ' + this.state.remote.commits.length + ' commits</div>';
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

      // When the layout wraps (narrow viewport), two zones that are adjacent in
      // the flow can end up on different rows. Drawing the arrow anyway would
      // run a line off-canvas and stack labels on one spot.
      if (!this._sameRow(pos[ar.from], pos[ar.to])) continue;

      var x1 = pos[ar.from].right;
      var x2 = pos[ar.to].left;
      var y = pos[ar.from].midY;
      if (x2 <= x1) continue;   // wrapped past the right edge
      var cls = this.visibleArrows[ar.name] ? 'arrow-group visible' : 'arrow-group';

      svg += '<g class="' + cls + '">';
      svg += '<line x1="' + x1 + '" y1="' + y + '" x2="' + (x2 - ahSize) + '" y2="' + y + '" stroke="' + color + '" stroke-width="2"/>';
      svg += rightAh(x2, y);
      svg += '<text x="' + ((x1 + x2) / 2) + '" y="' + (y - 12) + '" text-anchor="middle" fill="' + color + '" font-size="11">' + ar.label + '</text>';
      svg += '</g>';
    }

    // --- Cross-zone arrows (straight horizontal lines at bottom) ---
    var zoneH = pos.working ? (pos.working.bottom - pos.working.top) : 0;
    var pullY = pos.working ? pos.working.bottom - zoneH * 0.15 : 0;
    var cloneY = pos.working ? pos.working.bottom - zoneH * 0.05 : 0;
    var mergeY = cloneY;

    var crossArrows = [
      { name: 'restore', from: 'local', to: 'working', label: 'git restore', yKey: 'mergeY' },
      { name: 'pull', from: 'remote', to: 'working', label: 'git pull', yKey: 'pullY' },
      { name: 'clone', from: 'remote', to: 'local', label: 'git clone', yKey: 'cloneY' }
    ];

    for (var c = 0; c < crossArrows.length; c++) {
      var cr = crossArrows[c];
      if (!pos[cr.from] || !pos[cr.to]) continue;
      // These span distant zones, so only draw them when every zone shares one
      // row; otherwise the line would cut across unrelated rows.
      if (!this._sameRow(pos.working, pos.index) || !this._sameRow(pos.index, pos.local) ||
          !this._sameRow(pos.local, pos.remote)) continue;

      var x1 = pos[cr.from].left;
      var x2 = pos[cr.to].right;
      var y = cr.yKey === 'pullY' ? pullY : (cr.yKey === 'cloneY' ? cloneY : mergeY);
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
  // Two zones are on the same visual row when their vertical spans overlap.
  // Used to skip arrow segments that a wrapped (multi-row) layout would break.
  Renderer.prototype._sameRow = function(a, b) {
    if (!a || !b) return false;
    return a.top < b.bottom && b.top < a.bottom;
  };

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
    var HELPER = ['touch', 'echo', 'cat', 'clear', 'help', 'reset-tutorial'];
    var esc = function(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
    var parts = input.split(/\s+/);
    var html = '<span class="prompt-sign">$ </span>';
    if (parts[0] === 'git') {
      html += '<span class="git-cmd">git</span>';
      if (parts[1]) html += ' <span class="git-subcmd">' + esc(parts[1]) + '</span>';
      if (parts.length > 2) html += ' <span class="cmd-arg">' + esc(parts.slice(2).join(' ')) + '</span>';
    } else if (HELPER.indexOf(parts[0]) !== -1) {
      html += '<span class="helper-cmd">' + esc(parts[0]) + '</span>';
      if (parts.length > 1) html += ' <span class="cmd-arg">' + esc(parts.slice(1).join(' ')) + '</span>';
    } else {
      html += esc(input);
    }
    div.innerHTML = html;
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

    if (card.task && card.task.prompt) {
      this.taskPrompt.innerHTML = card.task.prompt;
      this.cardTask.style.display = 'flex';
    } else {
      this.taskPrompt.innerHTML = '';
      this.cardTask.style.display = 'none';
    }
  };

  Renderer.prototype.renderSidebar = function(chapters, currentCardId) {
    var html = '';
    if (!chapters) { this.sidebarChapters.innerHTML = ''; return; }
    for (var i = 0; i < chapters.length; i++) {
      var ch = chapters[i];
      if (!ch) continue;
      var cards = ch.cards || [];
      var isActive = false;
      for (var j = 0; j < cards.length; j++) {
        if (cards[j].id === currentCardId) {
          isActive = true;
          break;
        }
      }

      html += '<div class="chapter-group">';
      html += '<div class="chapter-title' + (isActive ? ' active expanded' : '') + '" data-chapter="' + i + '">' +
        '<span>' + (i + 1) + '. ' + this._escapeHtml(ch.title || '') + '</span>' +
        '<span class="chevron">&#9654;</span>' +
        '</div>';

      html += '<div class="chapter-cards" style="' + (isActive ? '' : 'display:none') + '">';
      for (var k = 0; k < cards.length; k++) {
        var card = cards[k];
        var cardActive = card.id === currentCardId ? ' active' : '';
        html += '<div class="card-item' + cardActive + '" data-card-id="' + this._escapeHtml(card.id || '') + '">' +
          this._escapeHtml(card.title || '') + '</div>';
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

    var fenceLen = 0;   // length of the opening fence run (``` vs ````)

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      // A fence is a run of 3+ backticks optionally followed by a language tag.
      // Trailing whitespace after the closing fence must not break it, and a
      // longer opening fence must be closed by a run at least as long.
      var fence = line.match(/^\s*(`{3,})\s*([^\s`]*)\s*$/);
      if (!inCode && fence) {
        inCode = true;
        fenceLen = fence[1].length;
        codeLines = [];
      } else if (inCode && /^\s*(`{3,})\s*$/.test(line) &&
                 line.match(/^\s*(`{3,})/)[1].length >= fenceLen) {
        inCode = false;
        fenceLen = 0;
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

    // Structural markers are detected on the raw line, but every piece of
    // content goes through _formatInline, which escapes HTML first.
    var m;

    // Headers
    m = line.match(/^### (.+)$/);
    if (m) return '<h3>' + this._formatInline(m[1]) + '</h3>';
    m = line.match(/^## (.+)$/);
    if (m) return '<h2>' + this._formatInline(m[1]) + '</h2>';

    // List items
    m = line.match(/^- (.+)$/);
    if (m) return '<li>' + this._formatInline(m[1]) + '</li>';

    // Blockquote — the leading > is markdown syntax and is consumed here,
    // so it must be matched before escaping turns it into &gt;.
    m = line.match(/^>\s?(.+)$/);
    if (m) return '<blockquote>' + this._formatInline(m[1]) + '</blockquote>';

    // Skip empty lines
    if (/^\s*$/.test(line)) return '';

    // Regular paragraph
    return '<p>' + this._formatInline(line) + '</p>';
  };

  Renderer.prototype._formatInline = function(text) {
    // Escape HTML FIRST. Card content is written with plain-text placeholders
    // like `git add <file>` or `echo "x" >> log`; emitting them raw makes the
    // browser swallow `<file>` as an unknown tag and can also eat `>>`.
    // Escaping up front keeps every literal character visible, then the
    // markdown replacements below build the real tags on top.
    var s = this._escapeHtml(text);
    var self = this;

    // Code spans must be lifted out BEFORE emphasis runs. Otherwise a `*`
    // inside backticks is treated as an emphasis marker and produces
    // mismatched tags such as <code>a<em>b</em></code>.
    var codeSpans = [];
    s = s.replace(/`([^`]+)`/g, function(m, inner) {
      codeSpans.push(inner);
      return '\u0000CODE' + (codeSpans.length - 1) + '\u0000';
    });

    s = s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/!\[([^\]]*)\]\(((?:[^()]|\([^()]*\))*)\)/g, function(m, alt, url) {
        return '<img src="' + self._safeUrl(url) + '" alt="' + alt + '" style="max-width:100%">';
      })
      .replace(/\[([^\]]+)\]\(((?:[^()]|\([^()]*\))*)\)/g, function(m, label, url) {
        return '<a href="' + self._safeUrl(url) + '" target="_blank" style="color:var(--accent)">' + label + '</a>';
      });

    // Restore code spans; their content stays literal (already escaped).
    s = s.replace(/\u0000CODE(\d+)\u0000/g, function(m, idx) {
      return '<code>' + codeSpans[+idx] + '</code>';
    });

    return s;
  };

  // Sanitize a URL destined for an HTML attribute. The markdown patterns run
  // after escaping, so a quote inside the URL would otherwise close the
  // attribute and let the rest of the URL inject markup.
  Renderer.prototype._safeUrl = function(url) {
    var u = String(url).trim();
    // Block script-bearing schemes outright.
    if (/^\s*(javascript|data|vbscript):/i.test(u)) return '#';
    return u
      .replace(/"/g, '%22')
      .replace(/'/g, '%27')
      .replace(/</g, '%3C')
      .replace(/>/g, '%3E')
      .replace(/&(?!amp;|lt;|gt;|quot;|#)/g, '&amp;');
  };

  // === Full Render ===
  Renderer.prototype.renderAll = function() {
    this.renderZones();
  };

  // Expose
  GitTutorial.Renderer = Renderer;
  window.GitTutorial = GitTutorial;
})();
