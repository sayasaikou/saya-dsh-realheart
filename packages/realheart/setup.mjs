#!/usr/bin/env node
/**
 * realheart 装配脚本（也负责摘下来）
 *
 * 为什么需要它：`dsh plugin add` 只是 pnpm 的转发器（`dsh plugin --help` 自己写的），
 * 装完**不会**把包名加进 profile 的 `dsh.profile.bundles`。
 * 不在那个列表里，插件自带的 cordis.patch.yml 就不会被应用 ——
 * 表现是"装了、没报错、一点反应没有"，这是排查里最容易浪费时间的一种。
 *
 * 卸的时候同一个坑反着来：`dsh plugin remove` 把包删了，那行**可能还挂着**。
 * 挂着但包不在 → 启动时报一个看不懂的错。所以摘行也得有个正经入口，
 * 不能靠人记得去手改 JSON。
 *
 * 用法：
 *   node node_modules/realheart/setup.mjs                     # 加进当前目录的 profile
 *   node node_modules/realheart/setup.mjs ~/.dsh/profiles/xx  # 指定 profile
 *   node node_modules/realheart/setup.mjs --remove <profile>   # 从 bundles 摘掉
 *
 * 选项：
 *   --remove   摘掉，不是装上
 *   --dry-run  只打印要做什么，一个字节都不写
 *
 * 安全边界：只改带 `dsh.profile` 字段的 package.json。改到别的文件上比不改更糟。
 * 写之前一定先备份 —— 「改一次配置多一个 .bak」是发布判据之一，不能靠人工记得。
 */

import { existsSync, mkdirSync, writeFileSync, chmodSync, copyFileSync } from 'node:fs';
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';

const PKG = 'realheart';

function fail(msg) {
  console.error(`[realheart] ${msg}`);
  process.exit(1);
}

const args = process.argv.slice(2);
const REMOVE = args.includes('--remove');
const DRY = args.includes('--dry-run');
const positional = args.filter((a) => !a.startsWith('--'));

const dir = resolve(positional[0] || process.env.INIT_CWD || process.cwd());
const pkgPath = join(dir, 'package.json');

if (!existsSync(pkgPath)) {
  fail(`这个目录里没有 package.json：${dir}\n（应该在 dsh profile 目录里跑，或者把路径当参数传进来）`);
}

let data;
let raw;
try {
  raw = await readFile(pkgPath, 'utf8');
  data = JSON.parse(raw);
} catch (err) {
  fail(`package.json 解析失败：${err?.message ?? err}`);
}

if (!data?.dsh?.profile) {
  fail(`${pkgPath} 里没有 dsh.profile —— 这看起来不是个 dsh profile 目录，不动它。`);
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); // 20261030-140349
const bakPath = `${pkgPath}.bak-${stamp}`;

data.dsh.profile.bundles = Array.isArray(data.dsh.profile.bundles) ? data.dsh.profile.bundles : [];
const has = data.dsh.profile.bundles.includes(PKG);

/** 写回。只在真的要改的时候调用，且一定先备份。 */
async function commit(note) {
  if (DRY) {
    console.log(`[realheart] [dry-run] 会写 ${pkgPath}（${note}），备份到 ${bakPath}`);
    return;
  }
  await copyFile(pkgPath, bakPath);
  await writeFile(pkgPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  console.log(`[realheart] ${note}：${pkgPath}`);
  console.log(`[realheart] 原文件已备份：${bakPath}`);
}

if (REMOVE) {
  if (!has) {
    console.log(`[realheart] bundles 里本来就没有 ${PKG}，不用摘：${pkgPath}`);
  } else {
    data.dsh.profile.bundles = data.dsh.profile.bundles.filter((x) => x !== PKG);
    await commit(`已从 bundles 摘掉 ${PKG}`);
  }
} else {
  if (has) {
    console.log(`[realheart] 已经在 bundles 里了：${pkgPath}`);
  } else {
    data.dsh.profile.bundles.push(PKG);
    await commit(`已加进 bundles`);
  }
  if (DRY) {
    console.log('[realheart] [dry-run] 什么都没写。真跑的话这一步之后要重启 dsh 才生效。');
  } else {
    console.log('[realheart] 重启 dsh 生效。装好之后第一次启动会打印三条前提，只打一次。');
  }
}

// ── 依赖自检（2026-10-28 加）──
//
// 为什么放进装配脚本，而不是只写在 README 里：
// 缺 zstd 的后果是**静默的** —— 页面照常开、心情照常记，只有「他说的话」那一路永远空着。
// 这种事不能靠人记得去查文档，得在装的那一刻当面说出来。
// 缺了不挡安装：插件本体（工具 + 注入）不依赖这两样。
//
// 卸的时候不查 —— 卸载不需要 python，别在拆东西的时候拦一道无用的检查。
if (!REMOVE) {
  function has2(cmd, argv) {
    try {
      execFileSync(cmd, argv, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  const py = has2('python3', ['-V']);
  const zstd = has2('zstd', ['--version']);
  console.log(`[realheart] 依赖自检：python3 ${py ? '有' : '缺'} · zstd ${zstd ? '有' : '缺'}`);
  if (!py) console.log('[realheart]   没有 python3 ⇒ 观测页起不来（她自己的工具和每轮注入照常工作）');
  if (!zstd) {
    console.log('[realheart]   没有 zstd ⇒ 观测页里「他说的话」那一路全空。');
    console.log('[realheart]   注意这个是静默的：页面照常显示、不报错。装：apt install zstd / pacman -S zstd / brew install zstd');
  }
}

// ── 给她（他的 agent）一份说明书（2026-11-02 加）──
//
// 工具 schema 只说「怎么调」，不说「什么时候该调、什么时候不该」。
// 这份 skill 是写给**那个 agent** 的 —— 怎么用这些工具、心情要不要每轮记、
// 为什么状态不该被说出来、以及怎么写出自己那份人格。
//
// 装到 profile 的 skills/ 下面，它会自己找到（dsh 的 skill 目录约定）。
// 已经存在就不覆盖 —— 用户可能照着它改过，改过的那份才是他的。
if (!REMOVE) {
  try {
    const here = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
    const src = join(decodeURIComponent(here), 'skills', 'realheart', 'SKILL.md');
    if (existsSync(src)) {
      const dstDir = join(dir, 'skills', 'realheart');
      const dst = join(dstDir, 'SKILL.md');
      if (existsSync(dst)) {
        console.log('[realheart] skill 已存在（可能是你自己改过的），没动它：' + dst);
      } else {
        mkdirSync(dstDir, { recursive: true });
        copyFileSync(src, dst);
        console.log('[realheart] 给她写了份用法说明：' + dst);
        console.log('[realheart]   那是写给「那个 agent」的，不是给你的 —— 里面写着什么时候该记、什么时候不该。');
      }
    }
  } catch (err) {
    console.log(`[realheart] skill 没铺下来（${err?.message ?? err}）—— 不影响工具本身能不能用`);
  }
}

// ── 叫醒她的排程（2026-11-02 加）──
//
// 为什么要生成这一套：自由时间一直靠三样**手搓**的东西在跑 ——
//   systemd timer（几点醒）+ 一个独立 profile（她自己的时间）+ 一个 wrapper（prompt 从哪来）。
// 三样都不在包里。所以新机上装完插件，她不会自己醒 —— 她只会等你说话。
// 那就不像一个人，像一个应答机。
//
// 为什么不直接装：装 systemd 单元要 root，而 setup 跑在用户态。
// 为什么不写 crontab：cron 不要 root，但改别人的 crontab 属于「动了没被允许动的东西」。
// 所以这里只铺文件、打命令。要启用就照着粘 —— 不启用也能用，只是她不会自己醒。
if (!REMOVE) {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || homedir();
    const dir = join(home, '.dsh', 'realheart', 'schedule');
    mkdirSync(dir, { recursive: true });

    const wrapper = join(dir, 'freetime-run.sh');
    writeFileSync(wrapper, [
      '#!/bin/sh',
      '# 自由时间的入口。',
      '#',
      '# prompt 的真本在插件里（FREE_PROMPT），插件启动时写到 free-prompt.txt。',
      '# 这里只负责读它 —— 读不到用兜底原文。**不能因为文件没了就叫不醒她**，那是最糟的结果。',
      'set -e',
      '',
      `PROMPT_FILE=${home}/.dsh/realheart/free-prompt.txt`,
      '',
      "FALLBACK='现在是你的自由时间。这段时间没人找你，也不用回谁的话。做点自己的东西，或者什么都不干，就让它过去。'",
      '',
      "PROMPT=''",
      '[ -s "$PROMPT_FILE" ] && PROMPT=$(cat "$PROMPT_FILE")',
      '[ -n "$PROMPT" ] || PROMPT=$FALLBACK',
      '',
      'exec /usr/bin/dsh --profile freetime "$PROMPT"',
      '',
    ].join('\n'), { mode: 0o755 });
    chmodSync(wrapper, 0o755);

    writeFileSync(join(dir, 'realheart-freetime.service'), [
      '[Unit]',
      'Description=realheart free time - let her have a stretch of nobody time',
      'After=network-online.target',
      'Wants=network-online.target',
      '',
      '[Service]',
      'Type=oneshot',
      `User=${process.env.USER || 'ubuntu'}`,
      '# ⚠️ 工作目录必须定：不定的话她会用相对路径把产物写到 $HOME 下面。',
      `WorkingDirectory=${home}`,
      'TimeoutStartSec=5400',
      `ExecStart=${wrapper}`,
      '',
    ].join('\n'));

    writeFileSync(join(dir, 'realheart-freetime.timer'), [
      '[Unit]',
      'Description=Wake her for free time',
      '',
      '[Timer]',
      'OnCalendar=*-*-* 09:00:00',
      'OnCalendar=*-*-* 14:30:00',
      'OnCalendar=*-*-* 20:30:00',
      'RandomizedDelaySec=5400',
      'Persistent=true',
      '',
      '[Install]',
      'WantedBy=timers.target',
      '',
    ].join('\n'));

    console.log('[realheart] 排程文件铺好了：' + dir);
    console.log('[realheart]   想让「她自己醒」这件事生效，执行这三条（要 sudo）：');
    console.log(`[realheart]     sudo cp ${dir}/realheart-freetime.* /etc/systemd/system/`);
    console.log('[realheart]     sudo systemctl daemon-reload');
    console.log('[realheart]     sudo systemctl enable --now realheart-freetime.timer');
    console.log('[realheart]   不装也能用 —— 只是她不会自己动，只会等你说话。');
    console.log('[realheart]   短唤醒（每隔一阵醒一次、看有没有想说的）见 README 的 ping-run.sh。');
  } catch (err) {
    console.log(`[realheart] 排程文件没铺下来（${err?.message ?? err}）—— 她还是会工作，只是不会自己醒`);
  }
}
