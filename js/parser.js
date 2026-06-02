// Parser — Tokenize and dispatch git commands
var GitTutorial = window.GitTutorial || {};

(function() {
  'use strict';

  function Parser(state, commands) {
    this.state = state;
    this.commands = commands;
    this.history = [];
    this.historyIndex = -1;
  }

  Parser.prototype.parse = function(input) {
    input = input.trim();
    if (!input) return null;

    // Save to history
    this.history.push(input);
    this.historyIndex = this.history.length;

    // Tokenize
    var tokens = this._tokenize(input);
    if (tokens.length === 0) return null;

    // Check for helper commands (touch, echo, cat, clear, help, reset-tutorial)
    if (this.commands[tokens[0]] && tokens[0] !== 'git') {
      return this.commands[tokens[0]](this.state, tokens.slice(1));
    }

    // Must start with 'git'
    if (tokens[0] !== 'git') {
      return { success: false, output: "命令未找到: " + tokens[0] + "\n提示: 输入 help 查看所有可用命令" };
    }

    if (tokens.length < 2) {
      return { success: false, output: "用法: git <command> [args]" };
    }

    var cmd = tokens[1];
    var args = tokens.slice(2);

    // Find handler
    var handler = this.commands[cmd];
    if (!handler) {
      return { success: false, output: "git: '" + cmd + "' 不是一个 git 命令。参见 'git --help'." };
    }

    // Execute
    return handler(this.state, args);
  };

  Parser.prototype._tokenize = function(str) {
    var tokens = [];
    var current = '';
    var inQuote = false;
    var quoteChar = '';

    for (var i = 0; i < str.length; i++) {
      var ch = str[i];

      if (inQuote) {
        if (ch === quoteChar) {
          inQuote = false;
        } else {
          current += ch;
        }
      } else if (ch === '"' || ch === "'") {
        inQuote = true;
        quoteChar = ch;
      } else if (ch === ' ' || ch === '\t') {
        if (current.length > 0) {
          tokens.push(current);
          current = '';
        }
      } else {
        current += ch;
      }
    }

    if (current.length > 0) {
      tokens.push(current);
    }

    return tokens;
  };

  Parser.prototype.getPrevHistory = function() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      return this.history[this.historyIndex];
    }
    return this.history[0] || '';
  };

  Parser.prototype.getNextHistory = function() {
    if (this.historyIndex < this.history.length - 1) {
      this.historyIndex++;
      return this.history[this.historyIndex];
    }
    this.historyIndex = this.history.length;
    return '';
  };

  // Expose
  GitTutorial.Parser = Parser;
  window.GitTutorial = GitTutorial;
})();
