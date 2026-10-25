import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
// 使用 Node 运行时：Edge Runtime 不支持 process.uptime，
// 保留 edge 会让每次构建都抛出 "A Node.js API is used ... not supported in
// the Edge Runtime" 警告，且 uptime 恒为 0。
export const runtime = 'nodejs'

/**
 * Health check endpoint for Docker and monitoring
 * Returns 200 OK if the application is running
 */
export async function GET() {
  try {
    // 基本健康检查
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime ? process.uptime() : 0,
      environment: process.env.NODE_ENV,
    }

    return NextResponse.json(health, { status: 200 })
  } catch (error) {
    return NextResponse.json(
      {
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 503 }
    )
  }
}
