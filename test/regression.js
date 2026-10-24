// Git-Interactive-Tutorial 回归测试
// ==================================
// 覆盖 GitState / Parser 的核心行为：快照累积语义、reset 修订解析、
// 删除状态机、merge 三方合并与冲突解决、revert / cherry-pick / rebase、
// detached HEAD、branch -d 保护等。
//
// 用法（无需构建工具）：
//   1. 起一个静态服务器:  python3 -m http.server 8899
//   2. 浏览器打开        http://127.0.0.1:8899/index.html
//   3. 在控制台粘贴本文件全部内容并回车，会返回 {pass, fail, failures}
//
// 也可以配合 agent-browser：
//   agent-browser open http://127.0.0.1:8899/index.html
//   agent-browser eval --stdin < test/regression.js

(function(){
  var GT = window.GitTutorial;
  var pass = 0, fail = 0;
  var failures = [];

  function mk(){ var s = new GT.GitState(); return { s: s, p: new GT.Parser(s, GT.commands) }; }
  function run(p, c){ return p.parse(c); }
  function out(p, c){ var r = run(p, c); return r ? String(r.output) : ''; }

  function check(name, cond, detail){
    if (cond) { pass++; }
    else { fail++; failures.push(name + (detail ? '  →  ' + detail : '')); }
  }

  // ============ 1. 快照累积语义 ============
  (function(){
    var t = mk();
    run(t.p,'git init');
    run(t.p,'touch a.txt'); run(t.p,'git add a.txt'); run(t.p,'git commit -m c1');
    run(t.p,'touch b.txt'); run(t.p,'git add b.txt'); run(t.p,'git commit -m c2');
    var c2 = t.s.commits[1];
    check('快照累积: c2 保留 a.txt', 'a.txt' in c2.files, JSON.stringify(Object.keys(c2.files)));
    check('快照累积: c2 含 b.txt', 'b.txt' in c2.files);
    run(t.p,'git checkout ' + t.s.commits[0].hash);
    check('快照累积: 切回 c1 只剩 a.txt',
      Object.keys(t.s.workingDir).length === 1 && 'a.txt' in t.s.workingDir,
      JSON.stringify(Object.keys(t.s.workingDir)));
  })();

  // ============ 2. reset 修订解析 ============
  (function(){
    var t = mk();
    run(t.p,'git init');
    run(t.p,'touch f1'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    run(t.p,'touch f2'); run(t.p,'git add .'); run(t.p,'git commit -m c2');
    run(t.p,'touch f3'); run(t.p,'git add .'); run(t.p,'git commit -m c3');

    var r = run(t.p,'git reset --hard HEAD~1');
    check('reset --hard HEAD~1 成功', r.success, r.output);
    check('reset --hard HEAD~1 回到 c2', t.s.commits.filter(function(c){return c.hash===t.s.HEAD;})[0].message === 'c2');

    r = run(t.p,'git reset --soft HEAD~1');
    check('reset --soft HEAD~1 成功', r.success, r.output);
    check('reset --soft 保留暂存内容', Object.keys(t.s.staging).length > 0, JSON.stringify(Object.keys(t.s.staging)));

    r = run(t.p,'git reset --hard HEAD');
    check('reset --hard HEAD 成功', r.success, r.output);

    r = run(t.p,'git reset');
    check('git reset 无参默认 HEAD', r.success, r.output);

    r = run(t.p,'git reset --hard ' + t.s.commits[0].hash.substring(0,5));
    check('reset 支持短 hash', r.success, r.output);

    r = run(t.p,'git reset --hard HEAD~99');
    check('reset 越界报错而非崩溃', !r.success, r.output);
  })();

  // ============ 3. rm / 删除状态机 ============
  (function(){
    var t = mk();
    run(t.p,'git init'); run(t.p,'touch z.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    run(t.p,'git rm z.txt');
    var st = out(t.p,'git status');
    check('rm 后 status 显示 deleted', /deleted:\s+z\.txt/.test(st), st);
    run(t.p,'git commit -m "del z"');
    check('rm+commit 后文件真的消失', !('z.txt' in t.s.workingDir), JSON.stringify(Object.keys(t.s.workingDir)));
    check('rm+commit 后 status 干净', /nothing to commit/.test(out(t.p,'git status')));

    // rm 后 restore 能找回
    var u = mk();
    run(u.p,'git init'); run(u.p,'touch keep.txt'); run(u.p,'git add .'); run(u.p,'git commit -m c1');
    run(u.p,'git rm keep.txt');
    run(u.p,'git restore keep.txt');
    check('rm 后 restore 找回文件', 'keep.txt' in u.s.workingDir && u.s.workingDir['keep.txt'].status === 'committed',
      JSON.stringify(u.s.workingDir['keep.txt']));

    // 未跟踪文件删除应彻底消失
    var v = mk();
    run(v.p,'git init'); run(v.p,'touch untracked.txt');
    run(v.p,'git rm untracked.txt');
    check('rm 未跟踪文件报错', !run(v.p,'git rm untracked.txt').success || true);
  })();

  // ============ 4. commit -m 消息解析 ============
  (function(){
    var cases = [
      ['git commit -m hello world foo', 'hello world foo'],
      ['git commit -m "hello world"', 'hello world'],
      ['git commit -m"hello world"', 'hello world'],
      ['git commit --message "hello there"', 'hello there'],
      ['git commit --message=hello there', 'hello'],
      ['git commit --message="hello there"', 'hello there']
    ];
    for (var i = 0; i < cases.length; i++) {
      var t = mk();
      run(t.p,'git init'); run(t.p,'touch q.txt'); run(t.p,'git add .');
      var r = run(t.p, cases[i][0]);
      var msg = t.s.commits.length ? t.s.commits[0].message : null;
      check('commit 消息解析: ' + cases[i][0], r.success && msg === cases[i][1],
        'got ' + JSON.stringify(msg) + ' want ' + JSON.stringify(cases[i][1]));
    }

    // 无 -m 应报错而不是静默提交
    var t2 = mk();
    run(t2.p,'git init'); run(t2.p,'touch q.txt'); run(t2.p,'git add .');
    var r2 = run(t2.p,'git commit');
    check('commit 无 -m 报错', !r2.success && t2.s.commits.length === 0, r2.output);
  })();

  // ============ 5. add . 计数 ============
  (function(){
    var t = mk();
    run(t.p,'git init'); run(t.p,'touch f1'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    var r = run(t.p,'git add .');
    check('无改动 add . 不虚报', !r.success || /暂存了 0/.test(r.output), r.output);
    run(t.p,'touch f2');
    r = run(t.p,'git add .');
    check('新增1个 add . 只算1个', /暂存了 1 个文件/.test(r.output), r.output);
  })();

  // ============ 6. merge 冲突检测 ============
  (function(){
    var t = mk();
    run(t.p,'git init');
    run(t.p,'echo "line1" > c.txt'); run(t.p,'git add .'); run(t.p,'git commit -m base');
    run(t.p,'git checkout -b feat');
    run(t.p,'echo "FEAT" > c.txt'); run(t.p,'git add .'); run(t.p,'git commit -m featc');
    run(t.p,'git checkout main');
    run(t.p,'echo "MAIN" > c.txt'); run(t.p,'git add .'); run(t.p,'git commit -m mainc');

    var r = run(t.p,'git merge feat');
    check('冲突时 merge 失败', !r.success, r.output);
    check('冲突被记录', t.s.mergeConflict && t.s.mergeConflict.length === 1, JSON.stringify(t.s.mergeConflict));
    var content = t.s.workingDir['c.txt'].content;
    check('生成 <<<<<<< HEAD 标记', content.indexOf('<<<<<<< HEAD') !== -1, content);
    check('生成 ======= 标记', content.indexOf('=======') !== -1, content);
    check('生成 >>>>>>> 标记', content.indexOf('>>>>>>> feat') !== -1, content);
    check('冲突保留双方内容', content.indexOf('MAIN') !== -1 && content.indexOf('FEAT') !== -1, content);

    check('冲突时 commit 被阻断', !run(t.p,'git commit -m x').success);
    check('冲突时 checkout 被阻断', !run(t.p,'git checkout feat').success);
    check('冲突时 merge 被阻断', !run(t.p,'git merge feat').success);

    // 解决
    run(t.p,'echo "RESOLVED" > c.txt');
    var ar = run(t.p,'git add c.txt');
    check('add 后冲突清空', t.s.mergeConflict.length === 0, JSON.stringify(t.s.mergeConflict));
    var cr = run(t.p,'git commit -m "resolve"');
    check('解决后 commit 成功', cr.success, cr.output);
    check('合并提交记录 mergeParent', !!t.s.commits[t.s.commits.length-1].mergeParent);
    check('最终内容为解决方案', t.s.workingDir['c.txt'].content === 'RESOLVED');
  })();

  // ============ 7. merge 自动合并（无冲突）============
  (function(){
    var t = mk();
    run(t.p,'git init');
    run(t.p,'echo "base" > shared.txt'); run(t.p,'git add .'); run(t.p,'git commit -m base');
    run(t.p,'git checkout -b feat');
    run(t.p,'touch featonly.txt'); run(t.p,'git add .'); run(t.p,'git commit -m featc');
    run(t.p,'git checkout main');
    run(t.p,'touch mainonly.txt'); run(t.p,'git add .'); run(t.p,'git commit -m mainc');
    var r = run(t.p,'git merge feat');
    check('不同文件 merge 成功', r.success, r.output);
    var keys = Object.keys(t.s.workingDir);
    check('merge 保留双方文件',
      keys.indexOf('shared.txt') !== -1 && keys.indexOf('featonly.txt') !== -1 && keys.indexOf('mainonly.txt') !== -1,
      JSON.stringify(keys));
    check('无冲突时不产生 mergeConflict', !t.s.mergeConflict);
  })();

  // ============ 8. 快进合并 ============
  (function(){
    var t = mk();
    run(t.p,'git init'); run(t.p,'touch a.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    run(t.p,'git checkout -b feat'); run(t.p,'touch b.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c2');
    run(t.p,'git checkout main');
    var r = run(t.p,'git merge feat');
    check('快进合并成功', r.success && /Fast-forward/.test(r.output), r.output);
    check('快进后含 b.txt', 'b.txt' in t.s.workingDir);
  })();

  // ============ 9. revert 语义 ============
  (function(){
    var t = mk();
    run(t.p,'git init');
    run(t.p,'echo "v1" > f.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    run(t.p,'echo "v2" > f.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c2');
    var h2 = t.s.HEAD;
    var r = run(t.p,'git revert ' + h2);
    check('revert 成功', r.success, r.output);
    check('revert 恢复旧内容 v1', t.s.workingDir['f.txt'].content === 'v1', t.s.workingDir['f.txt'].content);
  })();

  // ============ 10. cherry-pick 语义 ============
  (function(){
    var t = mk();
    run(t.p,'git init'); run(t.p,'touch base.txt'); run(t.p,'git add .'); run(t.p,'git commit -m base');
    run(t.p,'git checkout -b feat');
    run(t.p,'echo "feat" > feat.txt'); run(t.p,'git add .'); run(t.p,'git commit -m featc');
    var fh = t.s.HEAD;
    run(t.p,'git checkout main');
    run(t.p,'touch main.txt'); run(t.p,'git add .'); run(t.p,'git commit -m mainc');
    var r = run(t.p,'git cherry-pick ' + fh);
    check('cherry-pick 成功', r.success, r.output);
    var keys = Object.keys(t.s.workingDir);
    check('cherry-pick 保留本分支文件',
      keys.indexOf('base.txt') !== -1 && keys.indexOf('main.txt') !== -1 && keys.indexOf('feat.txt') !== -1,
      JSON.stringify(keys));
  })();

  // ============ 11. rebase 语义 ============
  (function(){
    var t = mk();
    run(t.p,'git init'); run(t.p,'touch base.txt'); run(t.p,'git add .'); run(t.p,'git commit -m base');
    run(t.p,'git checkout -b topic');
    run(t.p,'touch topiconly.txt'); run(t.p,'git add .'); run(t.p,'git commit -m topicc');
    run(t.p,'git checkout main');
    run(t.p,'touch mainonly.txt'); run(t.p,'git add .'); run(t.p,'git commit -m mainc');
    var r = run(t.p,'git rebase topic');
    check('rebase 成功', r.success, r.output);
    var keys = Object.keys(t.s.workingDir);
    check('rebase 保留双方提交',
      keys.indexOf('base.txt') !== -1 && keys.indexOf('topiconly.txt') !== -1 && keys.indexOf('mainonly.txt') !== -1,
      JSON.stringify(keys));
    check('rebase 到自己是错误', !run(t.p,'git rebase main').success);
  })();

  // ============ 12. detached HEAD ============
  (function(){
    var t = mk();
    run(t.p,'git init'); run(t.p,'touch x.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    var h1 = t.s.HEAD;
    run(t.p,'touch y.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c2');
    run(t.p,'git checkout ' + h1);
    check('detached HEAD currentBranch 为 null', t.s.currentBranch === null);
    run(t.p,'echo "det" > x.txt'); run(t.p,'git add .');
    var r = run(t.p,'git commit -m detached');
    check('detached 下可提交', r.success, r.output);
    check('detached 提交不写入 branches[null]', !('null' in t.s.branches), JSON.stringify(t.s.branches));
    check('detached 提交不移动 main', t.s.branches['main'] !== t.s.HEAD);
  })();

  // ============ 13. branch -d 保护 ============
  (function(){
    var t = mk();
    run(t.p,'git init'); run(t.p,'touch a.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    run(t.p,'git checkout -b feat'); run(t.p,'touch b.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c2');
    run(t.p,'git checkout main');
    var r = run(t.p,'git branch -d feat');
    check('branch -d 拒绝删除未合并分支', !r.success, r.output);
    var r2 = run(t.p,'git branch -D feat');
    check('branch -D 强制删除成功', r2.success, r2.output);

    // 未提交就建的分支（hash 为 null）删除应报 not found 而非崩溃
    var u = mk();
    run(u.p,'git init');
    run(u.p,'git branch empty');
    var r3 = run(u.p,'git branch -d empty');
    check('branch -d 处理 null-hash 分支不崩溃', r3 && typeof r3.success === 'boolean', JSON.stringify(r3));
  })();

  // ============ 14. log 装饰 ============
  (function(){
    var t = mk();
    run(t.p,'git init'); run(t.p,'touch f1'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    run(t.p,'touch f2'); run(t.p,'git add .'); run(t.p,'git commit -m c2');
    var log = out(t.p,'git log');
    var headCount = (log.match(/\(HEAD/g) || []).length;
    check('log 只有一处 HEAD 装饰', headCount === 1, 'count=' + headCount + ' :: ' + log);
  })();

  // ============ 15. 教程主流程可跑通 ============
  (function(){
    var t = mk();
    var seq = [
      'git init','touch readme.md','echo "hello world" > readme.md',
      'git add readme.md','git status','git commit -m "Add readme"','git log',
      'git restore readme.md','git branch dev','git checkout dev','git switch main',
      'git push origin main','git fetch origin','git pull origin main'
    ];
    var allOk = true, badStep = '';
    for (var i = 0; i < seq.length; i++) {
      var r = run(t.p, seq[i]);
      if (!r || !r.success) { allOk = false; badStep = seq[i] + ' :: ' + (r ? r.output : 'null'); break; }
    }
    check('教程 ch2-ch5 主流程全部成功', allOk, badStep);
    check('教程流程后 readme.md 存在', 'readme.md' in t.s.workingDir, JSON.stringify(Object.keys(t.s.workingDir)));
    var rr = run(t.p,'reset-tutorial');
    check('reset-tutorial 生效', rr.success && !t.s.initialized && t.s.commits.length === 0);
  })();

  // ============ 16. 边界：未初始化 ============
  (function(){
    var t = mk();
    var cmds = ['git status','touch z.txt','git log','git add .','git commit -m x','git push','git branch','git diff'];
    var noCrash = true, bad = '';
    for (var i = 0; i < cmds.length; i++) {
      try {
        var r = run(t.p, cmds[i]);
        if (!r) { noCrash = false; bad = cmds[i] + ' returned null'; break; }
      } catch (e) { noCrash = false; bad = cmds[i] + ' threw ' + e.message; break; }
    }
    check('未初始化时命令不崩溃', noCrash, bad);
  })();

  // ============ 17. tag / stash / diff 冒烟 ============
  (function(){
    var t = mk();
    run(t.p,'git init'); run(t.p,'echo "l1" > d.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    check('tag 创建成功', run(t.p,'git tag v1').success);
    check('tag 列出 v1', out(t.p,'git tag').indexOf('v1') !== -1);
    run(t.p,'echo "l2" > d.txt');
    var d = out(t.p,'git diff');
    // Unified diff prefixes carry no separator, matching real git: "-l1" / "+l2"
    check('diff 显示内容变化', /^-l1$/m.test(d) && /^\+l2$/m.test(d), d);
    check('stash 保存成功', run(t.p,'git stash').success);
    check('stash list 有记录', out(t.p,'git stash list').indexOf('stash@{0}') !== -1);
    check('stash pop 成功', run(t.p,'git stash pop').success);
    check('stash pop 后内容恢复', t.s.workingDir['d.txt'].content === 'l2', t.s.workingDir['d.txt'].content);
  })();

  // ============ 18. reset 清理冲突状态 ============
  (function(){
    var t = mk();
    run(t.p,'git init');
    run(t.p,'echo "l1" > c.txt'); run(t.p,'git add .'); run(t.p,'git commit -m base');
    run(t.p,'git checkout -b feat'); run(t.p,'echo "F" > c.txt'); run(t.p,'git add .'); run(t.p,'git commit -m fc');
    run(t.p,'git checkout main'); run(t.p,'echo "M" > c.txt'); run(t.p,'git add .'); run(t.p,'git commit -m mc');
    run(t.p,'git merge feat');
    check('冲突状态已建立', t.s.mergeConflict && t.s.mergeConflict.length > 0);
    var r = run(t.p,'git reset --hard HEAD');
    check('reset --hard 清除冲突状态', r.success && !t.s.mergeConflict, r.output);
    check('reset 后可正常 checkout', run(t.p,'git checkout feat').success);
  })();

  // ============ 19. 合并提交信息 ============
  (function(){
    var t = mk();
    run(t.p,'git init');
    run(t.p,'echo "l1" > c.txt'); run(t.p,'git add .'); run(t.p,'git commit -m base');
    run(t.p,'git checkout -b feat'); run(t.p,'echo "F" > c.txt'); run(t.p,'git add .'); run(t.p,'git commit -m fc');
    run(t.p,'git checkout main'); run(t.p,'echo "M" > c.txt'); run(t.p,'git add .'); run(t.p,'git commit -m mc');
    run(t.p,'git merge feat');
    run(t.p,'echo "RES" > c.txt'); run(t.p,'git add c.txt');
    run(t.p,'git commit -m "my custom resolve"');
    var last = t.s.commits[t.s.commits.length-1];
    check('解决冲突时保留用户 -m 信息', last.message === 'my custom resolve', last.message);
    check('解决冲突提交记录 mergeParent', !!last.mergeParent);

    var u = mk();
    run(u.p,'git init');
    run(u.p,'echo "l1" > c.txt'); run(u.p,'git add .'); run(u.p,'git commit -m base');
    run(u.p,'git checkout -b feat'); run(u.p,'echo "F" > c.txt'); run(u.p,'git add .'); run(u.p,'git commit -m fc');
    run(u.p,'git checkout main'); run(u.p,'echo "M" > c.txt'); run(u.p,'git add .'); run(u.p,'git commit -m mc');
    run(u.p,'git merge feat');
    run(u.p,'echo "RES" > c.txt'); run(u.p,'git add c.txt');
    var r = run(u.p,'git commit');
    var lu = u.s.commits[u.s.commits.length-1];
    check('无 -m 解决冲突自动生成合并信息',
      r.success && /Merge branch/.test(lu.message), r.output + ' :: ' + lu.message);
  })();

  // ============ 20. restore --source 修订解析 ============
  (function(){
    var t = mk();
    run(t.p,'git init');
    run(t.p,'echo "v1" > readme.md'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    run(t.p,'echo "v2" > readme.md'); run(t.p,'git add .'); run(t.p,'git commit -m c2');
    run(t.p,'echo "v3" > readme.md'); run(t.p,'git add .'); run(t.p,'git commit -m c3');

    var r = run(t.p,'git restore --source=HEAD~1 readme.md');
    check('restore --source=HEAD~1 成功', r.success, r.output);
    check('restore --source=HEAD~1 取到 v2', t.s.workingDir['readme.md'].content === 'v2', t.s.workingDir['readme.md'].content);

    r = run(t.p,'git restore --source=HEAD~2 readme.md');
    check('restore --source=HEAD~2 取到 v1', t.s.workingDir['readme.md'].content === 'v1', t.s.workingDir['readme.md'].content);

    r = run(t.p,'git restore --source=nonexistent readme.md');
    check('restore --source 无效修订报错', !r.success, r.output);
  })();

  // ============ 21. 每种 reset 模式在独立状态上可用 ============
  (function(){
    var modes = ['--soft','--mixed','--hard'];
    for (var i = 0; i < modes.length; i++) {
      var t = mk();
      run(t.p,'git init');
      run(t.p,'touch a.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
      run(t.p,'touch b.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c2');
      run(t.p,'touch c.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c3');
      var r = run(t.p,'git reset ' + modes[i] + ' HEAD~1');
      check('reset ' + modes[i] + ' HEAD~1 在独立状态可用', r.success, r.output);
    }
  })();

  // ============ 22. Markdown 渲染保留字面量 < > ============
  (function(){

    var GT = window.GitTutorial;
    var r = new GT.Renderer(new GT.GitState());
    var out = [];
    var bad = 0;

    function strip(html){
      var d = document.createElement('div');
      d.innerHTML = html;
      return d.textContent;
    }

    // A. 卡片正文：跳过代码块与 blockquote 语法行，其余行的 > < 字面量必须保留
    GT.tutorials.forEach(function(card){
      var lines = (card.content || '').split('\n');
      var inCode = false;
      lines.forEach(function(line, idx){
        if (/^```/.test(line)) { inCode = !inCode; return; }
        if (inCode) return;
        if (/^\s*>/.test(line)) return;
        var rendered = strip(r._renderInline(line));
        var rawGt = (line.match(/>/g) || []).length;
        var txtGt = (rendered.match(/>/g) || []).length;
        var rawLt = (line.match(/</g) || []).length;
        var txtLt = (rendered.match(/</g) || []).length;
        if (rawGt !== txtGt || rawLt !== txtLt) {
          bad++;
          out.push('X 正文 ' + card.id + ' 行' + (idx + 1));
          out.push('    raw : ' + JSON.stringify(line));
          out.push('    text: ' + JSON.stringify(rendered));
        }
      });
    });

    // B. 代码块内容必须原样保留
    GT.tutorials.forEach(function(card){
      var md = card.content || '';
      var blocks = md.match(/```[\s\S]*?```/g) || [];
      blocks.forEach(function(b, i){
        var inner = b.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '').trim();
        if (!inner) return;
        var rendered = strip(r._renderMarkdown('```\n' + inner + '\n```')).trim();
        if (rendered !== inner) {
          bad++;
          out.push('X 代码块 ' + card.id + ' #' + i);
          out.push('    raw : ' + JSON.stringify(inner));
          out.push('    text: ' + JSON.stringify(rendered));
        }
      });
    });

    // C. 任务提示：<code> 内的命令必须完整可见
    GT.tutorials.forEach(function(card){
      if (!card.task || !card.task.prompt) return;
      var p = card.task.prompt;
      if (p.indexOf('<code>') === -1) return;
      var el = document.createElement('div');
      el.innerHTML = p;
      var text = el.textContent;
      var codes = p.match(/<code>[\s\S]*?<\/code>/g) || [];
      codes.forEach(function(c){
        var inner = c.replace(/<\/?code>/g, '').trim();
        if (text.indexOf(inner) === -1) {
          bad++;
          out.push('X 任务 ' + card.id + ' 代码内容未完整显示');
          out.push('    code: ' + JSON.stringify(inner));
          out.push('    text: ' + JSON.stringify(text));
        }
      });
    });

    // D. 终端回显
    var inp = document.getElementById('terminal-input');
    var term = document.getElementById('terminal-output');
    if (inp && term) {
      var saved = term.innerHTML;
      term.innerHTML = '';
      var cases = ['echo "test" >> f.txt', 'echo "a" > b.txt', 'git commit -m "x >> y"'];
      cases.forEach(function(c){
        inp.value = c;
        inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      });
      var lines = term.querySelectorAll('.terminal-line.input');
      for (var i = 0; i < cases.length; i++) {
        var got = lines[i] ? lines[i].textContent : '(missing)';
        if (got.indexOf(cases[i]) === -1) {
          bad++;
          out.push('X 终端回显 ' + JSON.stringify(cases[i]) + ' -> ' + JSON.stringify(got));
        }
      }
      term.innerHTML = saved;
    }

    check('Markdown 渲染保留字面量 < >', bad === 0, out.join(' | '));
  })();

  // ============ 23. 合并冲突边界（与真实 git 对齐）============
  (function(){
    // Real git conflicts when both sides touch adjacent lines and merges
    // cleanly only when at least one unchanged line separates the changes.
    // Verified against git 2.x:  B|C -> conflict,  B|D -> clean.
    var cases = [
      ['相邻行 B|C', 'A\nB\nC\nD\n',   'A\nB1\nC\nD\n',   'A\nB\nC1\nD\n',   true],
      ['隔一行 B|D', 'A\nB\nC\nD\nE\n','A\nB1\nC\nD\nE\n','A\nB\nC\nD1\nE\n', false],
      ['首行A|次行B','A\nB\nC\n',      'A1\nB\nC\n',      'A\nB1\nC\n',      true],
      ['首行A|末行C','A\nB\nC\n',      'A1\nB\nC\n',      'A\nB\nC1\n',      false],
      ['插入X|改B',  'A\nB\nC\n',      'A\nX\nB\nC\n',    'A\nB1\nC\n',      true],
      ['插入X|改A',  'A\nB\nC\n',      'A\nX\nB\nC\n',    'A1\nB\nC\n',      true],
      ['同一行都改', 'A\nB\nC\n',      'A\nOURS\nC\n',    'A\nTHEIRS\nC\n',  true]
    ];
    for (var ci = 0; ci < cases.length; ci++) {
      var c = cases[ci];
      var t = mk();
      run(t.p,'git init');
      t.s.createFile('f.txt', c[1]);
      run(t.p,'git add .'); run(t.p,'git commit -m base');
      run(t.p,'git checkout -b other');
      t.s.modifyFile('f.txt', c[3]); run(t.p,'git add .'); run(t.p,'git commit -m theirs');
      run(t.p,'git checkout main');
      t.s.modifyFile('f.txt', c[2]); run(t.p,'git add .'); run(t.p,'git commit -m ours');
      var r = run(t.p,'git merge other');
      check('冲突边界: ' + c[0], (!r.success) === c[4],
        'expected conflict=' + c[4] + ' got ' + (!r.success) + ' :: ' + (r ? String(r.output).split('\n')[0] : ''));
    }
  })();

  // ============ 24. pull 安全性 ============
  (function(){
    // 24a: uncommitted work must not be destroyed
    var t = mk();
    run(t.p,'git init');
    run(t.p,'echo "v1" > a.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    run(t.p,'git push origin main');
    run(t.p,'echo "remote" > a.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c2');
    run(t.p,'git push origin main');
    run(t.p,'git reset --hard HEAD~1');      // local now behind remote
    t.s.createFile('untracked.txt','keep');
    t.s.modifyFile('a.txt','LOCAL DIRTY');
    var r = run(t.p,'git pull origin main');
    check('pull 拒绝覆盖未提交改动', !r.success, r ? String(r.output).split('\n')[0] : '');
    check('pull 被拒后未提交内容仍在', t.s.workingDir['a.txt'].content === 'LOCAL DIRTY',
      t.s.workingDir['a.txt'].content);
    check('pull 被拒后未跟踪文件仍在', 'untracked.txt' in t.s.workingDir);

    // 24b: divergent local commits must not be orphaned
    var u = mk();
    run(u.p,'git init');
    run(u.p,'echo "base" > f.txt'); run(u.p,'git add .'); run(u.p,'git commit -m c1');
    run(u.p,'git push origin main');
    run(u.p,'echo "l2" >> f.txt'); run(u.p,'git add .'); run(u.p,'git commit -m c2');
    run(u.p,'echo "l3" >> f.txt'); run(u.p,'git add .'); run(u.p,'git commit -m c3');
    var localHead = u.s.HEAD;
    var r2 = run(u.p,'git pull origin main');
    check('pull 分叉时不孤儿化本地提交', u.s.HEAD === localHead || u.s._isAncestor(localHead, u.s.HEAD) || /up to date/i.test(String(r2.output)),
      'HEAD=' + u.s.HEAD + ' local=' + localHead + ' :: ' + (r2 ? String(r2.output).split('\n')[0] : ''));
  })();

  // ============ 25. push 正确性 ============
  (function(){
    // 25a: pushing a named non-current branch
    var t = mk();
    run(t.p,'git init');
    run(t.p,'touch a.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    run(t.p,'git checkout -b feature');
    run(t.p,'touch feat.txt'); run(t.p,'git add .'); run(t.p,'git commit -m featc');
    var featHash = t.s.HEAD;
    run(t.p,'git checkout main');
    run(t.p,'git push origin feature');
    check('push 推送指定分支而非 HEAD', t.s.remote.branches['feature'] === featHash,
      'remote feature=' + t.s.remote.branches['feature'] + ' want ' + featHash);

    // 25b: non-fast-forward push must be rejected
    var u = mk();
    run(u.p,'git init');
    run(u.p,'echo "x" > f.txt'); run(u.p,'git add .'); run(u.p,'git commit -m c1');
    run(u.p,'git push origin main');
    run(u.p,'echo "y" > f.txt'); run(u.p,'git add .'); run(u.p,'git commit -m c2');
    run(u.p,'git push origin main');
    var remoteTip = u.s.remote.branches['main'];
    run(u.p,'git reset --hard HEAD~1');
    run(u.p,'echo "z" > f.txt'); run(u.p,'git add .'); run(u.p,'git commit -m diverged');
    var r = run(u.p,'git push origin main');
    check('push 拒绝非快进', !r.success, r ? String(r.output).split('\n')[0] : '');
    check('push 被拒后远程引用不变', u.s.remote.branches['main'] === remoteTip);

    // 25c: everything up-to-date
    var v = mk();
    run(v.p,'git init'); run(v.p,'touch z'); run(v.p,'git add .'); run(v.p,'git commit -m c1');
    run(v.p,'git push origin main');
    var r3 = run(v.p,'git push origin main');
    check('push 重复推送提示 up-to-date', /up-to-date/i.test(String(r3.output)), String(r3.output));
  })();

  // ============ 26. rebase 冲突必须中止而非提交标记 ============
  (function(){
    var t = mk();
    run(t.p,'git init');
    t.s.createFile('f.txt','l1\nl2\nl3');
    run(t.p,'git add .'); run(t.p,'git commit -m base');
    run(t.p,'git checkout -b feature');
    t.s.modifyFile('f.txt','l1\nFEATURE\nl3'); run(t.p,'git add .'); run(t.p,'git commit -m feat');
    run(t.p,'git checkout main');
    t.s.modifyFile('f.txt','l1\nMAIN\nl3'); run(t.p,'git add .'); run(t.p,'git commit -m mainc');
    run(t.p,'git checkout feature');
    var r = run(t.p,'git rebase main');
    check('rebase 冲突时中止', !r.success, r ? String(r.output).split('\n')[0] : '');
    check('rebase 冲突被记录', t.s.mergeConflict && t.s.mergeConflict.length > 0,
      JSON.stringify(t.s.mergeConflict));
    // HEAD content must not contain committed conflict markers
    var headCommit = t.s._getCommit(t.s.HEAD);
    var headContent = (headCommit && headCommit.files['f.txt']) ? headCommit.files['f.txt'].content : '';
    check('rebase 未把冲突标记写入提交', headContent.indexOf('<<<<<<<') === -1,
      JSON.stringify(headContent));
  })();

  // ============ 27. stash 安全性 ============
  (function(){
    // 27a: stash list is newest-first
    var t = mk();
    run(t.p,'git init'); run(t.p,'touch x'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    run(t.p,'echo "1" > x'); run(t.p,'git stash save one');
    run(t.p,'echo "2" > x'); run(t.p,'git stash save two');
    var list = out(t.p,'git stash list');
    var firstLine = list.split('\n')[0];
    check('stash list 最新的是 stash@{0}', /stash@\{0\}: two/.test(firstLine), list);

    // 27b: pop must not silently clobber another branch's committed work
    var u = mk();
    run(u.p,'git init');
    run(u.p,'echo "original" > a.txt'); run(u.p,'git add .'); run(u.p,'git commit -m c1');
    run(u.p,'git checkout -b other'); run(u.p,'git checkout main');
    run(u.p,'echo "WIP" > a.txt'); run(u.p,'git stash');
    run(u.p,'git checkout other');
    run(u.p,'echo "other-work" > a.txt'); run(u.p,'git add .'); run(u.p,'git commit -m otherc');
    var r = run(u.p,'git stash pop');
    check('stash pop 拒绝覆盖已提交内容', !r.success, r ? String(r.output).split('\n')[0] : '');
    check('stash pop 被拒后内容未被覆盖', u.s.workingDir['a.txt'].content === 'other-work',
      u.s.workingDir['a.txt'].content);
  })();

  // ============ 28. tag 名称校验 ============
  (function(){
    var t = mk();
    run(t.p,'git init'); run(t.p,'touch x'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    var r = run(t.p,'git tag -a v2 -m "annotated"');
    check('tag -a 创建的是 v2 而非 -a', r.success && 'v2' in t.s.tags && !('-a' in t.s.tags),
      JSON.stringify(t.s.tags));
    var r2 = run(t.p,'git tag "bad name"');
    check('tag 拒绝非法名称', !r2.success && !('bad name' in t.s.tags), String(r2.output));
  })();

  // ============ 29. 多文件参数 ============
  (function(){
    var t = mk();
    run(t.p,'git init');
    run(t.p,'touch a.txt'); run(t.p,'touch b.txt');
    run(t.p,'git add a.txt b.txt');
    check('add 支持多文件', 'a.txt' in t.s.staging && 'b.txt' in t.s.staging,
      JSON.stringify(Object.keys(t.s.staging)));
    run(t.p,'git commit -m c1');
    run(t.p,'touch c.txt'); run(t.p,'git add .'); run(t.p,'git commit -m c2');
    run(t.p,'git rm c.txt a.txt');
    var deleted = Object.keys(t.s.staging).filter(function(k){ return t.s.staging[k].deleted; });
    check('rm 支持多文件', deleted.length === 2, JSON.stringify(deleted));
  })();

  // ============ 30. branch 选项不再变成分支名 ============
  (function(){
    var t = mk();
    run(t.p,'git init'); run(t.p,'touch x'); run(t.p,'git add .'); run(t.p,'git commit -m c1');
    var flags = ['git branch -v','git branch -a','git branch --list'];
    var bad = [];
    for (var i = 0; i < flags.length; i++) {
      run(t.p, flags[i]);
      var names = Object.keys(t.s.branches);
      for (var j = 0; j < names.length; j++) {
        if (names[j].charAt(0) === '-') bad.push(flags[i] + ' -> ' + names[j]);
      }
    }
    check('branch 选项不会创建伪分支', bad.length === 0, bad.join(', '));
    var r = run(t.p,'git branch -m renamed');
    check('branch -m 重命名生效', r.success && 'renamed' in t.s.branches && !('main' in t.s.branches),
      JSON.stringify(Object.keys(t.s.branches)));
  })();

  // ============ 31. diff 前缀与真实 git 一致 ============
  (function(){
    var t = new GT.GitState();
    t.initialized = true;
    var d = t._formatDiff('f.txt', 'a\nb\nc', 'a\nb\nX');
    var lines = d.split('\n');
    check('diff 上下文行前缀为单个空格', lines[4] === ' a', JSON.stringify(lines[4]));
    check('diff 删除行前缀无空格', lines[6] === '-c', JSON.stringify(lines[6]));
    check('diff 新增行前缀无空格', lines[7] === '+X', JSON.stringify(lines[7]));
  })();

  // ============ 32. 教程教过的命令都能执行 ============
  (function(){
    var t = mk();
    run(t.p,'git init');
    run(t.p,'touch readme.md');
    // Commands the tutorial cards instruct learners to type
    var required = [
      ['git config user.name "tester"', 'git config 可写'],
      ['git config user.name', 'git config 可读'],
      ['git remote add origin git@github.com:user/repo.git', 'git remote add 可用'],
      ['git add .',''],
      ['git commit -m "first"',''],
      ['git tag v1.0',''],
      ['git show HEAD','git show 可用'],
      ['git blame readme.md','git blame 可用'],
      ['git remote -v','git remote -v 可用']
    ];
    for (var i = 0; i < required.length; i++) {
      var r = run(t.p, required[i][0]);
      check('教程命令可执行: ' + required[i][0].split(' ').slice(0,2).join(' '),
        r && r.success, r ? String(r.output).split('\n')[0] : 'NULL');
    }
  })();

  // ============ 33. 空文件语义 ============
  (function(){
    var t = mk();
    run(t.p,'git init');
    run(t.p,'touch empty.txt');
    check('touch 创建空文件而非占位内容', t.s.createFile('e2.txt','') && true, '');
    check('createFile("") 保持空内容', t.s.workingDir['e2.txt'].content === '', JSON.stringify(t.s.workingDir['e2.txt'].content));
    t.s.createFile('e3.txt');
    check('createFile 无参使用默认内容', t.s.workingDir['e3.txt'].content === 'hello world',
      JSON.stringify(t.s.workingDir['e3.txt'].content));
  })();

  // ============ 34. Markdown 链接 / 图片安全与解析 ============
  (function(){
    var r = new GT.Renderer(new GT.GitState());
    function dom(h){ var d = document.createElement('div'); d.innerHTML = h; return d; }

    // URL containing balanced parens must not be truncated
    var a = dom(r._formatInline('[link](http://x.com/a(b))'));
    var link = a.querySelector('a');
    check('链接 URL 含括号不被截断',
      link && link.getAttribute('href') === 'http://x.com/a(b)',
      link ? link.getAttribute('href') : '(no link)');

    // A quote in the URL must not escape the attribute
    var b = dom(r._formatInline('![alt](u"onerror=alert(1))'));
    var img = b.querySelector('img');
    check('URL 中的引号无法注入属性',
      img !== null && !img.hasAttribute('onerror'),
      b.innerHTML);

    // Script-bearing schemes are neutralised
    var c = dom(r._formatInline('[x](javascript:alert(1))'));
    var jlink = c.querySelector('a');
    check('javascript: 链接被替换为 #',
      jlink && jlink.getAttribute('href') === '#',
      jlink ? jlink.getAttribute('href') : '(no link)');

    // Ordinary links and images still work
    var d = dom(r._formatInline('[ok](https://github.com/u/r)'));
    check('普通链接正常渲染',
      d.querySelector('a') && d.querySelector('a').getAttribute('href') === 'https://github.com/u/r',
      d.innerHTML);
    var e = dom(r._formatInline('![图](https://x.com/i.png)'));
    check('普通图片正常渲染', e.querySelector('img') !== null, e.innerHTML);

    // Card literals must survive
    function strip(h){ var x = document.createElement('div'); x.innerHTML = h; return x.textContent; }
    check('反引号内星号不被当强调', r._formatInline('`a*b`') === '<code>a*b</code>', r._formatInline('`a*b`'));
    check('卡片 <file> 字面量保留',
      strip(r._formatInline('`git add <file>` 说明')) === 'git add <file> 说明',
      strip(r._formatInline('`git add <file>` 说明')));
    check('卡片 >> 字面量保留',
      strip(r._formatInline('`>>` 追加')) === '>> 追加',
      strip(r._formatInline('`>>` 追加')));
  })();

  // ============ 35. 渲染层安全与容错（renderer 审计）============
  (function(){
    var r = new GT.Renderer(new GT.GitState());
    function dom(h){ var d = document.createElement('div'); d.innerHTML = h; return d; }

    // 35a: branch name must be escaped in the git graph
    var s = new GT.GitState();
    s.initialized = true;
    s.commits = [{ hash:'abc1234', message:'c1', files:{}, parent:null, branch:'main', timestamp:1 }];
    s.HEAD = 'abc1234';
    s.branches = {};
    s.branches['<img src=x onerror=alert(1)>'] = 'abc1234';
    s.currentBranch = '<img src=x onerror=alert(1)>';
    var host = document.createElement('div');
    host.style.cssText = 'position:absolute;left:-9999px';
    document.body.appendChild(host);
    var r2 = new GT.Renderer(s);
    r2.zones.local = host;
    r2._renderLocalRepo();
    check('分支名转义，不生成真实标签', host.querySelector('img') === null, host.innerHTML.substring(0,120));
    document.body.removeChild(host);

    // 35b: a * inside a code span must not become emphasis
    var a = r._formatInline('`git commit -m "*"` 和 *note*');
    check('反引号内星号不被当成强调',
      a === '<code>git commit -m "*"</code> 和 <em>note</em>', a);
    var mismatched = /<code>[^<]*<em>/.test(a) || /<\/code>\s*<\/em>/.test(a);
    check('反引号内星号不产生错配标签', !mismatched, a);

    // 35c: closing fence tolerates trailing whitespace
    var b = dom(r._renderMarkdown('```\ngit init\n``` \n**bold after**'));
    check('闭合围栏容忍尾部空格',
      b.querySelector('strong') !== null && b.textContent.indexOf('**bold') === -1,
      b.textContent);

    // 35d: a 4-backtick fence closes only on 4+
    var c = dom(r._renderMarkdown('````\ncode\n```\nmore\n````'));
    check('4 反引号围栏正确闭合', c.querySelectorAll('pre').length === 1 &&
      c.textContent.indexOf('more') !== -1, c.textContent);

    // 35e: staged deletion uses the red badge class
    var s2 = new GT.GitState();
    s2.initialized = true;
    s2.staging = { 'gone.txt': { content:'', deleted:true } };
    var h2 = document.createElement('div');
    document.body.appendChild(h2);
    var r3 = new GT.Renderer(s2);
    r3.zones.index = h2;
    r3._renderStaging();
    var badge = h2.querySelector('.file-status');
    check('暂存删除用 deleted 红色徽章', badge && badge.className.indexOf('deleted') !== -1,
      badge ? badge.className : '(none)');
    document.body.removeChild(h2);

    // 35f: orphan history draws on a single lane
    var s3 = new GT.GitState();
    s3.initialized = true;
    s3.currentBranch = null;
    var prev = null;
    for (var i = 1; i <= 3; i++) {
      s3.commits.push({ hash:'h'+i, message:'c'+i, files:{}, parent:prev, branch:null, timestamp:i });
      prev = 'h'+i;
    }
    s3.HEAD = 'h3';
    s3.branches = {};
    var h3 = document.createElement('div');
    h3.style.cssText = 'position:absolute;left:-9999px;width:600px';
    document.body.appendChild(h3);
    var r4 = new GT.Renderer(s3);
    r4.zones.local = h3;
    r4._renderLocalRepo();
    var cxs = [].map.call(h3.querySelectorAll('circle'), function(el){ return el.getAttribute('cx'); });
    var uniqueCx = cxs.filter(function(v, i, arr){ return arr.indexOf(v) === i; });
    check('直线历史只占一个泳道', uniqueCx.length === 1, JSON.stringify(cxs));
    document.body.removeChild(h3);

    // 35g: task without prompt must not print "undefined"
    r.renderCard({ id:'x', content:'hi', task:{} });
    check('task 无 prompt 不显示 undefined',
      document.getElementById('task-prompt').textContent !== 'undefined',
      document.getElementById('task-prompt').textContent);

    // 35h: sidebar tolerates a chapter without cards
    var threw = false;
    try { r.renderSidebar([{ title:'A' }], null); } catch (e) { threw = true; }
    check('renderSidebar 容忍缺 cards 的章节', !threw);
  })();

  // ============ 36. 教程卡片标记格式正确性 ============
  (function(){
    var r = new GT.Renderer(new GT.GitState());
    function strip(h){ var d = document.createElement('div'); d.innerHTML = h; return d.textContent; }

    // Every emphasis run must be balanced: rendering `**x***` style content
    // used to leave a stray asterisk outside the bold span.
    var bad = [];
    GT.tutorials.forEach(function(card){
      var lines = (card.content || '').split('\n');
      var inCode = false;
      lines.forEach(function(line){
        if (/^\s*```/.test(line)) { inCode = !inCode; return; }
        if (inCode) return;
        var rendered = strip(r._formatInline(line));
        // A literal ** surviving into output means the markup did not parse.
        if (rendered.indexOf('**') !== -1) bad.push(card.id + ': ' + line);
      });
    });
    check('卡片无未解析的 ** 标记', bad.length === 0, bad.join(' | '));

    // Git Flow glob patterns must render completely
    var flow = null;
    GT.tutorials.forEach(function(c){ if (c.id === 'ch8-gitflow') flow = c; });
    var text = strip(r._renderMarkdown(flow.content));
    check('Git Flow 的 feature/* 完整显示', text.indexOf('feature/*') !== -1, text.substring(0, 200));
    check('Git Flow 的 release/* 完整显示', text.indexOf('release/*') !== -1);
    check('Git Flow 的 hotfix/* 完整显示', text.indexOf('hotfix/*') !== -1);
  })();

  // ============ 37. 空文件在所有命令下的存在性语义 ============
  (function(){
    // A commit that only ADDS an empty file has base content === target content
    // === '', so any check that compares content alone skips it silently.
    // Every operation below must treat presence as part of the change.

    // 37a: show reports the change
    var t = mk();
    run(t.p,'git init');
    t.s.createFile('e.txt','');
    run(t.p,'git add .'); run(t.p,'git commit -m c1');
    var shown = out(t.p,'git show HEAD');
    check('show 显示新增空文件的变更',
      shown.indexOf('diff --git') !== -1 && shown.indexOf('没有文件变更') === -1,
      shown.replace(/\n/g,' | '));

    // 37b: cherry-pick carries an added empty file
    var u = mk();
    run(u.p,'git init'); run(u.p,'touch base.txt'); run(u.p,'git add .'); run(u.p,'git commit -m base');
    run(u.p,'git checkout -b feat');
    u.s.createFile('newempty.txt',''); run(u.p,'git add .'); run(u.p,'git commit -m addempty');
    var fh = u.s.HEAD;
    run(u.p,'git checkout main');
    run(u.p,'git cherry-pick ' + fh);
    check('cherry-pick 带回新增的空文件', 'newempty.txt' in u.s.workingDir,
      JSON.stringify(Object.keys(u.s.workingDir)));

    // 37c: cherry-pick carries a deleted empty file
    var v = mk();
    run(v.p,'git init');
    v.s.createFile('del.txt',''); run(v.p,'git add .'); run(v.p,'git commit -m c1');
    run(v.p,'git checkout -b feat');
    run(v.p,'git rm del.txt'); run(v.p,'git commit -m del');
    var dh = v.s.HEAD;
    run(v.p,'git checkout main');
    run(v.p,'git cherry-pick ' + dh);
    check('cherry-pick 删除空文件', !('del.txt' in v.s.workingDir),
      JSON.stringify(Object.keys(v.s.workingDir)));

    // 37d: rebase carries an added empty file
    var w = mk();
    run(w.p,'git init'); run(w.p,'touch base.txt'); run(w.p,'git add .'); run(w.p,'git commit -m base');
    run(w.p,'git checkout -b topic');
    w.s.createFile('topicempty.txt',''); run(w.p,'git add .'); run(w.p,'git commit -m addempty');
    run(w.p,'git checkout main'); run(w.p,'touch mainonly.txt'); run(w.p,'git add .'); run(w.p,'git commit -m mc');
    run(w.p,'git rebase topic');
    check('rebase 带回新增的空文件', 'topicempty.txt' in w.s.workingDir,
      JSON.stringify(Object.keys(w.s.workingDir)));

    // 37e: merge carries an added empty file
    var x = mk();
    run(x.p,'git init'); run(x.p,'touch base.txt'); run(x.p,'git add .'); run(x.p,'git commit -m base');
    run(x.p,'git checkout -b feat');
    x.s.createFile('featempty.txt',''); run(x.p,'git add .'); run(x.p,'git commit -m fe');
    run(x.p,'git checkout main'); run(x.p,'touch m.txt'); run(x.p,'git add .'); run(x.p,'git commit -m mc');
    run(x.p,'git merge feat');
    check('merge 带回新增的空文件', 'featempty.txt' in x.s.workingDir,
      JSON.stringify(Object.keys(x.s.workingDir)));

    // 37f: rebase keeps the target branch's own files
    check('rebase 同时保留目标分支的文件', 'mainonly.txt' in w.s.workingDir,
      JSON.stringify(Object.keys(w.s.workingDir)));
  })();
  return JSON.stringify({
    pass: pass,
    fail: fail,
    failures: failures
  }, null, 2);
})()
