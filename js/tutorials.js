// Tutorials — All tutorial card data
// ========================================
//
// 语法规则
// ========================================
//
// 1. 整体结构
//    tutorials 数组包含所有卡片，按顺序排列。
//    每张卡片属于一个 chapter（章节），章节按 chapter 字段分组。
//
// 2. 卡片字段
//    {
//      id:        'ch1-what',       // 唯一标识，格式: ch{章节号}-{名称}
//      chapter:   1,                // 所属章节号（1-8）
//      title:     'Git 是什么',     // 卡片标题（显示在左侧栏）
//      content:   '## 标题\n...',   // 正文内容（Markdown 格式，用 \n 换行）
//      task:      null 或 { prompt: '...' },  
//      highlights: ['add']          // 命令执行后高亮的箭头名称（可选）
//    }
//
// 3. content 内容语法
//   用模板字符串（反引号）直接写多行内容（但这样似乎不能正常缩进），也可以用数组 .join('\n') 拼接。，支持以下 Markdown 语法：
//
//    ## 标题        → <h2>
//    ### 小标题      → <h3>
//    - 列表项        → <li>
//    > 引用文字      → <blockquote>（蓝色左边框 + 灰色文字）
//    **加粗**       → <strong>
//    `代码`         → <code>
//    ```代码块```   → <pre><code>
//    [链接](url)    → <a>
//    ![图片](url)   → <img>
//
// 4. task 任务
//    null 表示无任务（纯知识卡片）。
//    有任务时用 { prompt: '...' }，内容是 HTML，常用 <code> 包裹命令：
//      task: { prompt: '请输入: <code>git init</code>' }
//
// 5. highlights 箭头高亮
//    命令执行后触发哪些箭头动画。可选值：
//    'add' | 'commit' | 'push' | 'pull' | 'clone' | 'restore'
//    一般和卡片教的命令对应，不需要则省略或写 []。
//
// 6. 章节
//    chapterNames 数组定义章节标题，和 chapter 编号一一对应。
//    卡片按 chapter 分组后自动生成左侧章节导航。
//
// ========================================

var GitTutorial = window.GitTutorial || {};

(function() {
  'use strict';

  var tutorials = [
    // Chapter 1: Git 是什么
    {
      id: 'ch1-what',
      chapter: 1,
      title: 'Git 是什么',
      content: `## Git 是什么

Git 是一个**分布式版本控制系统**。简单说，它帮你记录文件的每一次修改，让你可以随时回退到任意历史版本。

**核心思想：快照，不是差异。**

很多版本控制系统（如 SVN）存储的是「每次改了什么」（差异补丁）。Git 不同——它每次保存的是**整个项目的快照**（snapshot），像是给所有文件拍了一张照片。

但这不意味着 Git 每次都复制一份完整文件。Git 用了一个巧妙的设计：
- 没有变化的文件，Git 只存储一个指向上次快照的**引用**
- 只有变化的文件，Git 才存储新的内容

所以 Git 的存储效率很高，同时又能瞬间切换到任意版本。

> Git 的设计哲学：**一切都可追溯，一切皆可回退。**`,
      task: null
    },
    {
      id: 'ch1-objects',
      chapter: 1,
      title: 'Git 对象模型',
      content: `## Git 对象模型：blob、tree、commit

Git 的底层是三种对象，存在 \`.git/objects/\` 目录下：

### blob（文件内容）
存储文件的具体内容。一个 blob 就是一份文件数据，**不包含文件名**。

### tree（目录结构）
存储目录的信息：哪些文件名对应哪些 blob，哪些子目录对应哪些 tree。
一个 tree 就是一张「文件名 → blob」的映射表。

### commit（提交）
存储一次提交的全部信息：
- 指向一个 tree（这次提交的项目快照）
- 指向父 commit（上一次提交）
- 作者、时间、提交信息

\`\`\`
commit -> tree -> blob
  |
parent commit -> tree -> blob
\`\`\`

每个对象用 **SHA-1 哈希值**作为唯一标识（如 \`a1b2c3d\`）。这就是为什么 Git 能保证数据完整性——内容变了，哈希就变了。`,
      task: null
    },
    {
      id: 'ch1-areas',
      chapter: 1,
      title: '四个区域',
      content: `## Git 的四个区域

这是理解 Git 工作流的关键。看看上方的四个区域：

### 1. Working Directory（工作区）
你实际编辑文件的地方。你用编辑器改代码，改的就是工作区的文件。

### 2. Staging Area / Index（暂存区）
一个「准备区」。你选择哪些修改要放进下一次提交。\`git add\` 就是把文件放进暂存区。

### 3. Local Repository（本地仓库）
提交历史存在这里。\`git commit\` 就是把暂存区的内容打包成一个快照，存进本地仓库。

### 4. Remote Repository（远程仓库）
服务器上的仓库（如 GitHub）。\`git push\` 把本地提交推到远程，\`git pull\` 把远程更新拉到本地。

\`\`\`
工作区 --git add--> 暂存区 --git commit--> 本地仓库 --git push--> 远程仓库
                       ^                                              |
                       └──────────────── git pull ─────────────────────┘
\`\`\`

> **暂存区的存在意义**：让你可以精确控制每次提交包含哪些修改。不用每次都把所有改动一起提交。`,
      task: null
    },

    // Chapter 2: 初始化与配置
    {
      id: 'ch2-init',
      chapter: 2,
      title: 'git init',
      content: `## git init — 初始化仓库

\`git init\` 在当前目录创建一个 \`.git\` 隐藏文件夹，这个文件夹就是 Git 仓库的全部。

\`.git\` 目录包含：
- \`objects/\` — 所有 blob、tree、commit 对象
- \`refs/\` — 分支和标签的指针
- \`HEAD\` — 指向当前分支
- \`index\` — 暂存区
- \`config\` — 仓库级配置

运行 \`git init\` 后，你的目录就变成了一个 Git 仓库。之后所有的版本控制操作都在这个目录下进行。

**试试看**：在终端输入 \`git init\`，观察上方「工作区」的变化。`,
      task: { prompt: '请输入: <code>git init</code>' },
      highlights: ['init']
    },
    {
      id: 'ch2-config',
      chapter: 2,
      title: 'git config',
      content: `## git config — 配置用户信息

Git 需要知道「你是谁」才能记录提交的作者信息。

**设置用户名和邮箱：**
\`\`\`
git config user.name "你的名字"
git config user.email "your@email.com"
\`\`\`

**查看当前配置：**
\`\`\`
git config user.name
git config user.email
\`\`\`

这三个配置级别：
- \`--local\`（默认）— 只对当前仓库生效，存在 \`.git/config\`
- \`--global\` — 对当前用户的所有仓库生效，存在 \`~/.gitconfig\`
- \`--system\` — 对所有用户生效

\`\`\`
git config --global user.name "你的名字"
git config --global user.email "your@email.com"
\`\`\`

> **建议**：用 \`--global\` 设置你的名字和邮箱，这样每个新仓库都会自动使用。`,
      task: null,
      highlights: []
    },
    {
      id: 'ch2-touch',
      chapter: 2,
      title: '创建文件',
      content: `## 创建文件

在使用 Git 之前，我们先创建一些文件。以下是常用的辅助命令：

**touch — 创建空文件**
\`\`\`
touch readme.md
\`\`\`

**echo + > — 写入内容**
\`\`\`
echo "hello world" > readme.md
\`\`\`
\`>\` 会**覆盖**文件原有内容。如果文件不存在，会自动创建。

**echo + >> — 追加内容**
\`\`\`
echo "第二行" >> readme.md
\`\`\`
\`>>\` 会在文件末尾**追加**，不影响已有内容。

**cat — 查看文件内容**
\`\`\`
cat readme.md
\`\`\`
把文件内容打印到终端。

这些不是 git 命令，但它们帮我们准备 git 要管理的文件。

**试试看**：先创建文件，再用 echo 写入内容`,
      task: { prompt: '先输入 <code>touch readme.md</code>，再输入 <code>echo "hello world" > readme.md</code>' },
      highlights: []
    },

    // Chapter 3: 日常基础
    {
      id: 'ch3-add',
      chapter: 3,
      title: 'git add',
      content: `## git add — 暂存你的修改

\`git add <file>\` 把文件从工作区移到暂存区。

暂存区（Index）是 Git 特有的概念。它是一个「预提交区」——你可以选择性地把某些修改放进去，而不是把所有改动一次性提交。

**用法：**
- \`git add file.txt\` — 暂存单个文件
- \`git add .\` — 暂存所有修改
- \`git add *.js\` — 暂存所有 .js 文件

执行 \`git add\` 后，看看上方区域的变化——文件应该从「工作区」出现在「暂存区」了。

> \`git add\` 不会创建提交，只是把文件放进「准备区」。你可以多次 add 后一次性 commit。`,
      task: { prompt: '请输入: <code>git add readme.md</code>' },
      highlights: ['add']
    },
    {
      id: 'ch3-status',
      chapter: 3,
      title: 'git status',
      content: `## git status — 查看状态

\`git status\` 显示工作区和暂存区的当前状态。

它会告诉你：
- 哪些文件**已暂存**（准备提交）
- 哪些文件**已修改但未暂存**
- 哪些文件**未跟踪**（新文件，Git 还不知道它的存在）

这是你最常用的命令之一。当你不确定当前状态时，先跑一下 \`git status\`。

**试试看**：创建了文件之后，运行 \`git status\` 看看输出。`,
      task: { prompt: '请输入: <code>git status</code>' },
      highlights: []
    },
    {
      id: 'ch3-diff',
      chapter: 3,
      title: 'git diff',
      content: `## git diff — 查看差异

\`git diff\` 显示文件的具体修改内容，逐行比较两个版本，告诉你**改了什么**。

**两种常用用法：**
- \`git diff --staged\` — 比较**暂存区 vs 上一次 commit**，看你 add 了什么
- \`git diff\` — 比较**工作区 vs 暂存区**，看你改了但还没 add 的内容

输出格式：
\`\`\`
- hello world     （旧行，被删除）
+ Hello Git       （新行，被添加）
\`\`\`

刚才你已经 add 了 readme.md，现在用 \`git diff --staged\` 看看暂存区里有什么。`,
      task: { prompt: '请输入: <code>git diff --staged</code>' },
      highlights: []
    },
    {
      id: 'ch3-commit',
      chapter: 3,
      title: 'git commit',
      content: `## git commit — 提交更改

\`git commit -m "提交信息"\` 把暂存区的内容打包成一个 commit，存入本地仓库。

一次 commit 就是一份项目快照——记录了这一刻所有文件的状态。

提交信息应该简洁描述做了什么：
\`\`\`
git commit -m "Add readme file"
\`\`\`

提交后，看看上方「本地仓库」区域——你的第一个 commit 出现了！

> 每次 commit 都会记录：改了什么文件、改了什么内容、上一次 commit 是谁。这样就形成了一条完整的历史链。`,
      task: { prompt: '请输入: <code>git commit -m "Add readme"</code>' },
      highlights: ['commit']
    },
    {
      id: 'ch3-log',
      chapter: 3,
      title: 'git log',
      content: `## git log — 查看提交历史

\`git log\` 显示从最新到最早的提交记录。真实输出格式如下：

\`\`\`
commit a1b2c3d (HEAD -> main)
Author: Your Name <your@email.com>
Date:   Mon Jun 2 10:00:00 2025

    Add readme
\`\`\`

\`HEAD -> main\` 表示 HEAD 当前指向 main 分支的最新 commit。HEAD 记录的就是「你当前在哪个 commit 上」——切换分支时，HEAD 会跟着移动。

**常用选项：**
- \`git log -n 3\` — 只看最近 3 条
- \`git log --oneline\` — 简洁模式（一行一条）

试试看，你刚才的 commit 应该出现在历史里了。`,
      task: { prompt: '请输入: <code>git log</code>' },
      highlights: []
    },
    {
      id: 'ch3-restore',
      chapter: 3,
      title: 'git restore',
      content: `## git restore — 恢复文件

\`git restore <file>\` 把文件恢复到最后一次 commit 的状态，丢弃工作区的修改。

\`\`\`
git restore readme.md
\`\`\`

这是从 local repo → working directory 的操作。你改乱了文件，想回到上次 commit 的样子，就用 restore。

另一个用法：\`git restore --staged <file>\` 取消暂存（从暂存区移除，但保留工作区修改）。
`,
      task: { prompt: '输入 <code>git restore readme.md</code>' },
      highlights: ['restore']
    },
    {
      id: 'ch3-checkout-file',
      chapter: 3,
      title: 'checkout 恢复文件',
      content: `## git checkout 恢复文件（旧语法）

在 Git 2.23 之前，恢复文件用的是：
\`\`\`
git checkout -- <file>
\`\`\`

因为 \`git checkout\` 同时用于切换分支和恢复文件，容易搞混。所以新版本拆分成了：
- \`git switch\` — 切换分支
- \`git restore\` — 恢复文件

你仍然会看到很多项目使用旧语法，了解一下有好处。`,
      task: null
    },

    // Chapter 4: 分支操作
    {
      id: 'ch4-branch',
      chapter: 4,
      title: 'git branch',
      content: `## git branch — 分支操作

分支是 Git 最强大的功能之一。

**什么是分支？**
分支就是一个指向某个 commit 的标记。创建分支只是加个标记，瞬间完成。

**用法：**
- \`git branch\` — 列出所有分支
- \`git branch dev\` — 创建名为 dev 的新分支
- \`git branch -d dev\` — 删除分支

创建分支时，新分支指向当前 commit。两个分支共享之前的历史，之后各自独立发展。

\`\`\`
main:    A -- B -- C
                    \\
dev:                 D -- E
\`\`\`

**试试看**：创建一个 \`dev\` 分支`,
      task: { prompt: '请输入: <code>git branch dev</code>' },
      highlights: []
    },
    {
      id: 'ch4-checkout',
      chapter: 4,
      title: 'git checkout',
      content: `## git checkout — 切换分支

\`git checkout <branch>\` 切换到指定分支。

切换分支时，Git 会：
1. 让 HEAD 指向新分支
2. 把工作区的文件更新为该分支最新 commit 的内容

**创建并切换（一步到位）：**
\`git checkout -b dev\` — 创建 dev 分支并立即切换过去

切换后，你的工作区会变成 dev 分支的内容。两个分支可以各自独立开发，互不影响。

**试试看**：切换到 dev 分支`,
      task: { prompt: '请输入: <code>git checkout dev</code>' },
      highlights: []
    },
    {
      id: 'ch4-switch',
      chapter: 4,
      title: 'git switch',
      content: `## git switch — 切换分支（新命令）

\`git switch\` 是 Git 2.23 引入的新命令，用来替代 \`git checkout\` 的分支切换功能。

为什么？因为 \`git checkout\` 职责太多（切换分支、恢复文件、创建分支...），容易混淆。

**用法：**
- \`git switch main\` — 切换到 main 分支
- \`git switch -c feature\` — 创建并切换到 feature 分支

和 \`git checkout\` 的对应关系：
- \`git checkout dev\` → \`git switch dev\`
- \`git checkout -b dev\` → \`git switch -c dev\`

**试试看**：切回 main 分支`,
      task: { prompt: '请输入: <code>git switch main</code>' },
      highlights: []
    },
    {
      id: 'ch4-merge',
      chapter: 4,
      title: 'git merge',
      content: `## git merge — 合并分支

\`git merge <branch>\` 把指定分支的修改合并到当前分支。

用法：先切到目标分支（通常是 main），再 merge 其他分支：
\`\`\`
git switch main
git merge dev
\`\`\`

**两种合并方式：**

### 快进合并（Fast-forward）
main 没有新 commit，dev 在 main 前面。Git 只需把 main 移到 dev 的位置：
\`\`\`
之前:  main ── A
               \\
        dev      B ── C

之后:  main ── A ── B ── C
\`\`\`

### 三方合并（3-way merge）
main 和 dev 都有新 commit。Git 找到分叉点，合并两边的修改，生成一个新的合并 commit：
\`\`\`
        main ── A ── B ── M
                      /
        dev     C ── D

M 是合并 commit，它有两个父 commit（B 和 D）。
\`\`\`

先切到 dev，创建一个新文件并 commit，再切回 main 合并 dev。`,
      task: { prompt: '试试: 先切到 dev（<code>git switch dev</code>），创建文件并提交，再切回 main 合并' },
      highlights: ['commit']
    },
    {
      id: 'ch4-conflict',
      chapter: 4,
      title: '合并冲突',
      content: `## 合并冲突

当两个分支修改了同一个文件的同一位置，Git 无法自动合并，就会产生**冲突**。

冲突标记长这样：
\`\`\`
<<<<<<< HEAD
当前分支的内容
=======
要合并的分支的内容
>>>>>>> dev
\`\`\`

解决步骤：
1. 打开冲突文件，找到 \`<<<<<<<\` 标记
2. 决定保留哪部分（或合并两者）
3. 删除冲突标记
4. \`git add\` 标记为已解决
5. \`git commit\` 完成合并

> 冲突不可怕。它只是 Git 在说：「这两个修改我没法自动合并，你来决定。」`,
      task: null
    },

    // Chapter 5: 远程协作
    {
      id: 'ch5-ssh',
      chapter: 5,
      title: 'SSH Key',
      content: `## SSH Key — 认证远程仓库

要和 GitHub 等远程仓库通信，你需要证明「你是你」。SSH Key 是最常用的方式。

**原理：**
- 你生成一对密钥：**私钥**（留在本地）和**公钥**（上传到 GitHub）
- GitHub 用公钥验证你的身份，你用私钥签名

**步骤 1：生成密钥**
\`\`\`
ssh-keygen -t rsa -C "your@email.com"
\`\`\`
一路回车即可。默认生成在 \`~/.ssh/id_rsa\`。

**步骤 2：复制公钥**
\`\`\`
cat ~/.ssh/id_rsa.pub
\`\`\`
复制输出的整行内容。

**步骤 3：添加到 GitHub**
GitHub → Settings → SSH and GPG keys → New SSH key → 粘贴公钥

**步骤 4：测试连接**
\`\`\`
ssh -T git@github.com
\`\`\`
看到 \`Hi username!\` 就说明配置成功了。

> 配置好 SSH 后，clone/push/pull 都可以用 \`git@github.com:用户名/仓库.git\` 格式的 URL，无需每次输入密码。`,
      task: null
    },
    {
      id: 'ch5-remote',
      chapter: 5,
      title: '远程仓库与 push',
      content: `## 远程仓库与 git push

远程仓库是托管在服务器上的 Git 仓库（如 GitHub）。本地仓库通过 push/pull 和远程仓库同步。

**添加远程仓库：**
\`\`\`
git remote add origin git@github.com:user/repo.git
\`\`\`
\`origin\` 是远程仓库的默认名字，你也可以自己取名字。查看已配置的远程仓库：
\`\`\`
git remote -v
\`\`\`

**推送到远程：**
\`\`\`
git push origin main
\`\`\`
把本地 main 分支的 commit 发送到远程。之后在 GitHub 上就能看到你的代码了。

试试把你之前的 commit 推送到远程。`,
      task: { prompt: '请输入: <code>git push origin main</code>' },
      highlights: ['push']
    },
    {
      id: 'ch5-reset-tutorial',
      chapter: 5,
      title: '重置教程',
      content: `## 重置教程

你已经学会了本地 Git 操作和远程推送。接下来我们换一个场景：**从远程克隆一个项目**。

为了模拟这个过程，请先重置教程状态：
\`\`\`
reset-tutorial
\`\`\`
这是一个辅助命令，会清除当前所有数据，回到初始状态。

重置后，我们将在下一张卡片中克隆一个示例仓库。`,
      task: { prompt: '请输入: <code>reset-tutorial</code>' },
      highlights: []
    },
    {
      id: 'ch5-clone',
      chapter: 5,
      title: 'git clone',
      content: `## git clone — 克隆仓库

\`git clone <url>\` 从远程仓库复制一份完整的项目到本地：
\`\`\`
git clone git@github.com:user/repo.git
\`\`\`

它会：
1. 下载远程仓库的全部内容
2. 创建本地仓库和工作区
3. 检出默认分支（通常是 main）
4. 自动设置远程地址为 \`origin\`

克隆完成后，你拥有完整的项目历史，和远程仓库一模一样。这就是「分布式」的含义——每个人的本地都是一个完整的仓库。

两种 URL 格式：
- HTTPS：\`https://github.com/user/repo.git\`
- SSH：\`git@github.com:user/repo.git\`（需要配置 SSH Key）

试试克隆一个示例仓库：`,
      task: { prompt: '请输入: <code>git clone git@github.com:user/repo.git</code>' },
      highlights: ['clone']
    },
    {
      id: 'ch5-fetch',
      chapter: 5,
      title: 'git fetch',
      content: `## git fetch — 获取远程更新

使用 fetch 前，需要先配置远程仓库地址：
\`\`\`
git remote add origin git@github.com:user/repo.git
git fetch origin
\`\`\`

fetch 从远程下载新的 commit，但**不会合并**到你的工作区。它只更新本地的远程记录（如 \`origin/main\`），让你知道远程有什么新内容，但不改动你的文件。

\`\`\`
fetch 前:  本地 main → C,  远程 main → E
fetch 后:  本地 main → C,  origin/main → E
            （你还是在 C，但知道远程有 E 了）
\`\`\`

> \`git pull\` = \`git fetch\` + \`git merge\`。想精确控制时，可以先 fetch 再决定是否 merge。

试试 fetch，然后用 \`git status\` 看看有什么变化。`,
      task: { prompt: '请输入: <code>git fetch origin</code>' },
      highlights: []
    },
    {
      id: 'ch5-pull',
      chapter: 5,
      title: 'git pull',
      content: `## git pull — 拉取并合并

使用 pull 前，需要先配置远程仓库地址（如果还没配置过）：
\`\`\`
git remote add origin git@github.com:user/repo.git
git pull origin main
\`\`\`
\`origin\` 是远程仓库名，\`main\` 是分支名。\`git pull\` = \`git fetch\` + \`git merge\`。

pull 先从远程下载 commit，然后在 local repo 里合并分支，最后根据合并结果更新工作区的文件。日常开发中，开始工作前先 \`git pull\` 是个好习惯。

\`\`\`
本地:  A -- B -- C
远程:  A -- B -- D -- E

pull 后: A -- B -- C -- M (merge commit)
                  \\      /
                   D -- E
\`\`\`

到这里，你已经掌握了 Git 的核心工作流：
**add → commit → push & pull**

这四个命令覆盖了日常开发 90% 的场景。后面的章节是进阶内容，希望你接下来能在实践中练习`,
      task: { prompt: '请输入: <code>git pull origin main</code>' },
      highlights: []
    },

    // Chapter 6: 撤销与修正
    {
      id: 'ch6-reset',
      chapter: 6,
      title: 'git reset',
      content: `## git reset — 重置

\`git reset\` 撤销 commit，有三种模式，区别在于撤销的范围：

### --soft（软重置）
只撤销 commit。修改保留在暂存区，可以直接重新 commit。
适用场景：commit 信息写错了，想重新写。

### --mixed（默认）
撤销 commit 和 add。修改保留在工作区，需要重新 add。
适用场景：想把几个 commit 合并成一个。

### --hard（硬重置）
彻底回到某个 commit 的状态。**危险操作，未提交的修改会丢失！**
适用场景：当前改动完全不要了，回到干净的状态。

\`\`\`
git reset --soft HEAD~1   # 撤销最后一次 commit
git reset --mixed HEAD~1  # 撤销 commit 和 add
git reset --hard HEAD~1   # 彻底回退
\`\`\`

\`HEAD~1\` 表示「上一个 commit」，\`HEAD~2\` 表示「上两个 commit」，以此类推。`,
      task: null,
      highlights: []
    },
    {
      id: 'ch6-revert',
      chapter: 6,
      title: 'git revert',
      content: `## git revert — 撤销提交

\`git revert <commit-hash>\` 创建一个新的 commit，内容是「撤销指定 commit 的修改」。

和 \`reset\` 的区别：
- \`reset\` 是**删除**历史（改写已有的 commit）
- \`revert\` 是**新增**历史（创建一个反向 commit）

\`\`\`
原来:       A -- B -- C
revert B:   A -- B -- C -- B'
                       (B' 把 B 的改动反向做了一遍)
\`\`\`

> **黄金法则**：commit 已经 push 到远程并被其他人使用了，**用 revert，不用 reset**。reset 改写历史会导致其他人的代码出问题。`,
      task: null,
      highlights: []
    },

    // Chapter 7: 进阶工具
    {
      id: 'ch7-rebase',
      chapter: 7,
      title: 'git rebase',
      content: `## git rebase — 变基

\`git rebase main\` 把当前分支的 commit 逐个「移植」到 main 的最新 commit 之后。

**rebase vs merge：**

假设你在 dev 分支上有两个 commit（D、E），main 上也有新 commit（B、C）：

用 merge 合并：
\`\`\`
main:  A ── B ── C ── M   (M 是合并 commit，有两个父 commit)
              \\      /
dev:           D ── E
\`\`\`
历史保留了分叉结构，但多了一个 M。

用 rebase 合并：
\`\`\`
main:  A ── B ── C
                 \\
dev:              D' ── E'   (D' 和 E' 是 D、E 的副本，哈希不同)
\`\`\`
历史变成一条直线，没有合并 commit。

rebase 的本质：把你的 commit 摘下来，接到目标分支的最新位置，像「嫁接」一样。

> **黄金法则**：**不要 rebase 已经 push 到远程的 commit！** rebase 会改写 commit 的哈希值，导致其他人的代码出问题。只在 push 之前 rebase 本地 commit。`,
      task: null,
      highlights: []
    },
    {
      id: 'ch7-stash',
      chapter: 7,
      title: 'git stash',
      content: `## git stash — 临时保存

\`git stash\` 把当前工作区和暂存区的修改「藏起来」，让工作区恢复干净。

场景：你在 feature 分支开发到一半，突然需要切到 main 修复 bug。但你的修改还没法 commit。这时候 stash 就派上用场了。

**用法：**
- \`git stash\` — 保存当前修改
- \`git stash list\` — 查看所有 stash
- \`git stash pop\` — 恢复最近一次 stash 并删除记录
- \`git stash apply\` — 恢复但保留记录

\`\`\`
git stash          # 藏起来
git switch main    # 切到 main 修 bug
git switch feature # 切回来
git stash pop      # 恢复之前的工作
\`\`\``,
      task: null,
      highlights: []
    },
    {
      id: 'ch7-cherry-pick',
      chapter: 7,
      title: 'git cherry-pick',
      content: `## git cherry-pick — 拣选提交

\`git cherry-pick <commit-hash>\` 把某个 commit 的**改动内容（diff）**提取出来，在当前分支重新应用一遍。

场景：你在 dev 分支修了一个 bug（commit D），但不想合并整个 dev，只想把这个修复拿到 main 上。

\`\`\`
dev:   A ── B ── C ── D    (D 改了 login.py 的第 10 行)
main:  A ── B

git switch main
git cherry-pick D
main:  A ── B ── D'         (D' 也改了 login.py 的第 10 行)
\`\`\`

cherry-pick 不是复制文件快照，而是提取「改了什么」，在当前位置重新改一遍。所以 D' 和 D 的哈希不同，但改动内容相同。

> 注意：这是「复制改动」不是「移动」。dev 上的 D 仍然存在。`,
      task: null,
      highlights: []
    },
    {
      id: 'ch7-tag',
      chapter: 7,
      title: 'git tag',
      content: `## git tag — 标签

标签用于标记发布版本（v1.0, v2.0, ...），方便以后快速找到这个版本。

标签和分支类似，都是指向 commit 的标记。区别是：
- **分支**会随着新 commit 往前移动
- **标签**永远固定在创建时的 commit 上

\`\`\`
git tag v1.0              # 给当前 commit 打标签
git tag                   # 列出所有标签
git show v1.0             # 查看标签对应的 commit
git tag -d v1.0           # 删除标签
\`\`\`

轻量标签（上面用的）只是一个标记。还有一种**附注标签**（\`git tag -a v1.0 -m "message"\`），包含作者信息和说明，适合正式发布。`,
      task: null,
      highlights: []
    },
    {
      id: 'ch7-rm',
      chapter: 7,
      title: 'git rm',
      content: `## git rm — 删除文件

\`git rm <file>\` 从工作区和暂存区同时删除文件，并记录这次删除。之后 commit 即可。

\`\`\`
git rm readme.md       # 删除文件 + 暂存删除操作
git commit -m "Remove readme"
\`\`\`

和手动删除的区别：
- 手动删除文件后，需要 \`git add\` 告诉 Git 你删了什么
- \`git rm\` 一步到位：删文件 + 暂存删除操作

如果只想从 Git 跟踪中移除（保留本地文件）：
\`\`\`
git rm --cached <file>
\`\`\`
适用场景：不小心把 \`.env\` 之类的文件 add 进去了，想从跟踪中移除。`,
      task: null,
      highlights: []
    },
    {
      id: 'ch7-blame',
      chapter: 7,
      title: 'git blame',
      content: `## git blame — 追溯修改

\`git blame <file>\` 逐行显示文件的最后修改者和 commit。

输出格式：
\`\`\`
a1b2c3d (Alice 2025-01-15) def login():
b2c3d4e (Bob   2025-02-01)     check_token()
\`\`\`
每行前面显示：commit 哈希、作者、日期、内容。

用途：排查某行代码是谁改的、为什么改。配合 \`git log\` 和 \`git show\` 可以追溯完整上下文。

\`\`\`
git blame login.py         # 查看整个文件
git blame -L 10,20 login.py  # 只看第 10-20 行
\`\`\``,
      task: null,
      highlights: []
    },

    // Chapter 8: 工作流总览
    {
      id: 'ch8-workflow',
      chapter: 8,
      title: '日常开发流程',
      content: `## 日常开发流程

一个典型的 Git 工作日：

\`\`\`
# 1. 拉取最新代码
git pull origin main

# 2. 创建功能分支
git switch -c feature/login

# 3. 开发、提交
git add .
git commit -m "Add login form"

# 4. 推送到远程
git push origin feature/login

# 5. 创建 Pull Request（在 GitHub 上）

# 6. 代码审查后合并到 main

# 7. 切回 main，拉取最新
git switch main
git pull origin main

# 8. 删除功能分支
git branch -d feature/login
\`\`\`

核心循环就是：**修改 → add → commit → push → PR → merge**`,
      task: null
    },
    {
      id: 'ch8-gitflow',
      chapter: 8,
      title: 'Git Flow',
      content: `## Git Flow 工作流

Git Flow 是一种流行的分支管理策略：

- **main** — 永远是生产环境的代码
- **develop** — 开发主线
- **feature/*** — 功能分支，从 develop 分出
- **release/*** — 发布准备分支
- **hotfix/*** — 紧急修复分支

\`\`\`
main:     A --------- M --------- R
           \\         ^           ^
dev:        D -- F -- D -- F --- D
               ^    ^
feature:      f1   f2
\`\`\`

小团队可能不需要这么复杂。简单的策略：
- main 保持可部署
- 每个功能一个分支
- 通过 PR 合并

> 选择适合你团队的工作流，不要为了流程而流程。`,
      task: null
    }
  ];

  // Build chapters from flat list
  var chapters = [];
  var chapterNames = [
    'Git 是什么',
    '初始化与配置',
    '日常基础',
    '分支操作',
    '远程协作',
    '撤销与修正',
    '进阶工具',
    '工作流总览'
  ];

  for (var i = 0; i < chapterNames.length; i++) {
    var ch = {
      title: chapterNames[i],
      cards: []
    };
    for (var j = 0; j < tutorials.length; j++) {
      if (tutorials[j].chapter === i + 1) {
        ch.cards.push(tutorials[j]);
      }
    }
    chapters.push(ch);
  }

  // Expose
  GitTutorial.tutorials = tutorials;
  GitTutorial.chapters = chapters;
  window.GitTutorial = GitTutorial;
})();
