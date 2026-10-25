#!/usr/bin/env node
/**
 * 显式数据库迁移脚本
 *
 * 默认不执行任何迁移。只有显式设置 RUN_DB_MIGRATIONS=true 才会真正运行，
 * 避免构建流程或误操作自动改动数据库结构。
 *
 * 用法：
 *   RUN_DB_MIGRATIONS=true pnpm db:migrate:prod
 *
 * 该脚本不会自动挂接到构建流程中；如需在部署时自动执行迁移，
 * 请在确认目标数据库后手动运行本命令，或在 CI 中显式调用。
 */
import { spawnSync } from 'node:child_process'

if (process.env.RUN_DB_MIGRATIONS !== 'true') {
  console.log(
    '[db-migrate] RUN_DB_MIGRATIONS 未开启，跳过数据库迁移。' +
      '如需执行迁移，请使用: RUN_DB_MIGRATIONS=true pnpm db:migrate:prod'
  )
  process.exit(0)
}

if (!process.env.DATABASE_URL) {
  console.error('[db-migrate] 缺少 DATABASE_URL，无法执行数据库迁移')
  process.exit(1)
}

console.log('[db-migrate] 开始执行数据库迁移...')

const result = spawnSync('pnpm', ['db:migrate'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
})

if (result.error) {
  console.error('[db-migrate] 迁移进程启动失败:', result.error.message)
  process.exit(1)
}

if (result.status !== 0) {
  console.error(`[db-migrate] 迁移失败，退出码 ${result.status}`)
  process.exit(result.status ?? 1)
}

console.log('[db-migrate] 数据库迁移完成')
