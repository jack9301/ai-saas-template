import { fetchRequestHandler } from '@trpc/server/adapters/fetch'
import type { NextRequest } from 'next/server'
import { appRouter } from '@/server/root'
import { createTRPCContext } from '@/server/server'

// tRPC 的 sendMessage 是一个 subscription，会持续推送 AI 流式响应，
// 执行时间可能远超 Vercel 默认的函数超时上限，这里显式放宽。
export const maxDuration = 300
export const dynamic = 'force-dynamic'

const handler = (req: NextRequest) =>
  fetchRequestHandler({
    endpoint: '/api/trpc',
    req,
    router: appRouter,
    createContext: () => createTRPCContext({ req }),
    onError:
      process.env.NODE_ENV === 'development'
        ? ({ path, error }) => {
            console.error(
              `❌ tRPC failed on ${path ?? '<no-path>'}: ${error.message}`
            )
          }
        : undefined,
  })

export { handler as GET, handler as POST }
