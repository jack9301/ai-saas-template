import Stripe from 'stripe'
import { env } from '@/env'
import { logger } from '@/lib/logger'

let stripeClient: Stripe | undefined

/**
 * 创建 Stripe 客户端。
 *
 * 这里刻意不在模块顶层执行 `new Stripe(...)`：`next build` 会导入每一个路由模块来
 * 收集页面数据，模块顶层的构造在密钥缺失时会直接抛错
 * （Neither apiKey nor config.authenticator provided），让构建以
 * "Failed to collect page data for /api/payments/create-checkout-session"
 * 这种完全指不到根因的形式失败。
 *
 * 改为惰性创建后，构建期不再依赖任何运行时密钥；真正调用支付接口时才会以
 * 明确的错误信息快速失败。
 */
function createStripeClient(): Stripe {
  const apiKey = env.STRIPE_SECRET_KEY
  if (!apiKey) {
    throw new Error(
      'STRIPE_SECRET_KEY 未配置：请设置 Stripe 私钥（sk_test_ / sk_live_），否则无法调用支付接口。'
    )
  }

  return new Stripe(apiKey, {
    apiVersion: '2026-03-25.dahlia',
    typescript: true,
    appInfo: {
      name: 'AI SaaS Template',
      version: '1.0.0',
    },
  })
}

// 服务端Stripe实例（首次使用时创建并缓存）
export function getServerStripe(): Stripe {
  if (!stripeClient) {
    stripeClient = createStripeClient()
  }
  return stripeClient
}

/**
 * 兼容旧用法：`import { stripe } from '@/lib/stripe'`。
 * 通过 Proxy 惰性转发到真正的 Stripe 实例，首次访问属性时才创建客户端。
 */
export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, property) {
    const instance = getServerStripe()
    const value = Reflect.get(instance, property, instance)
    return typeof value === 'function' ? value.bind(instance) : value
  },
})

// Stripe webhook签名验证
export function verifyStripeWebhook(
  body: string,
  signature: string
): Stripe.Event {
  const endpointSecret = env.STRIPE_WEBHOOK_SECRET

  try {
    const event = stripe.webhooks.constructEvent(
      body,
      signature,
      endpointSecret
    )
    return event
  } catch (error) {
    logger.error('Stripe webhook签名验证失败:', error as Error)
    throw new Error('Invalid signature')
  }
}

// 创建客户
export async function createStripeCustomer(params: {
  email: string
  name?: string
  userId: string
  metadata?: Record<string, string>
}): Promise<Stripe.Customer> {
  try {
    const customer = await stripe.customers.create({
      email: params.email,
      name: params.name,
      metadata: {
        userId: params.userId,
        ...params.metadata,
      },
    })

    logger.info(`Stripe客户创建成功: ${customer.id}`)
    return customer
  } catch (error) {
    logger.error('创建Stripe客户失败:', error as Error)
    throw error
  }
}

// 创建订阅
export async function createStripeSubscription(params: {
  customerId: string
  priceId: string
  metadata?: Record<string, string>
  trialPeriodDays?: number
}): Promise<Stripe.Subscription> {
  try {
    const subscription = await stripe.subscriptions.create({
      customer: params.customerId,
      items: [{ price: params.priceId }],
      metadata: params.metadata,
      trial_period_days: params.trialPeriodDays,
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
    })

    logger.info(`Stripe订阅创建成功: ${subscription.id}`)
    return subscription
  } catch (error) {
    logger.error('创建Stripe订阅失败:', error as Error)
    throw error
  }
}

// 创建结账会话
export async function createStripeCheckoutSession(params: {
  priceId: string
  customerId?: string
  customerEmail?: string
  successUrl: string
  cancelUrl: string
  metadata?: Record<string, string>
  mode?: 'payment' | 'subscription'
  allowPromotionCodes?: boolean
}): Promise<Stripe.Checkout.Session> {
  try {
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: params.mode || 'subscription',
      line_items: [
        {
          price: params.priceId,
          quantity: 1,
        },
      ],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      metadata: params.metadata,
      allow_promotion_codes: params.allowPromotionCodes ?? true,
      billing_address_collection: 'auto',
      customer_update: {
        address: 'auto',
        name: 'auto',
      },
    }

    if (params.customerId) {
      sessionParams.customer = params.customerId
    } else if (params.customerEmail) {
      sessionParams.customer_email = params.customerEmail
    }

    if (params.mode === 'subscription') {
      sessionParams.subscription_data = {
        metadata: params.metadata,
      }
    }

    const session = await stripe.checkout.sessions.create(sessionParams)

    logger.info(`Stripe结账会话创建成功: ${session.id}`)
    return session
  } catch (error) {
    logger.error('创建Stripe结账会话失败:', error as Error)
    throw error
  }
}

// 创建客户门户会话
export async function createStripePortalSession(params: {
  customerId: string
  returnUrl: string
}): Promise<Stripe.BillingPortal.Session> {
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: params.customerId,
      return_url: params.returnUrl,
    })

    logger.info(`Stripe客户门户会话创建成功: ${session.id}`)
    return session
  } catch (error) {
    logger.error('创建Stripe客户门户会话失败:', error as Error)
    throw error
  }
}

// 取消订阅
export async function cancelStripeSubscription(
  subscriptionId: string,
  options?: {
    cancelAtPeriodEnd?: boolean
    prorate?: boolean
  }
): Promise<Stripe.Subscription> {
  try {
    const subscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: options?.cancelAtPeriodEnd ?? true,
      proration_behavior: options?.prorate ? 'create_prorations' : 'none',
    })

    logger.info(`Stripe订阅取消成功: ${subscription.id}`)
    return subscription
  } catch (error) {
    logger.error('取消Stripe订阅失败:', error as Error)
    throw error
  }
}

// 获取客户订阅
export async function getStripeCustomerSubscriptions(
  customerId: string
): Promise<Stripe.Subscription[]> {
  try {
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: 'all',
      expand: ['data.default_payment_method'],
    })

    return subscriptions.data
  } catch (error) {
    logger.error('获取Stripe客户订阅失败:', error as Error)
    throw error
  }
}

// 获取客户支付记录
export async function getStripeCustomerPayments(
  customerId: string,
  limit = 10
): Promise<Stripe.PaymentIntent[]> {
  try {
    const payments = await stripe.paymentIntents.list({
      customer: customerId,
      limit,
    })

    return payments.data
  } catch (error) {
    logger.error('获取Stripe客户支付记录失败:', error as Error)
    throw error
  }
}

// 创建优惠券
export async function createStripeCoupon(params: {
  id?: string
  percentOff?: number
  amountOff?: number
  currency?: string
  duration: 'forever' | 'once' | 'repeating'
  durationInMonths?: number
  maxRedemptions?: number
  name?: string
  metadata?: Record<string, string>
}): Promise<Stripe.Coupon> {
  try {
    const coupon = await stripe.coupons.create({
      id: params.id,
      percent_off: params.percentOff,
      amount_off: params.amountOff,
      currency: params.currency,
      duration: params.duration,
      duration_in_months: params.durationInMonths,
      max_redemptions: params.maxRedemptions,
      name: params.name,
      metadata: params.metadata,
    })

    logger.info(`Stripe优惠券创建成功: ${coupon.id}`)
    return coupon
  } catch (error) {
    logger.error('创建Stripe优惠券失败:', error as Error)
    throw error
  }
}

// 获取产品和价格
export async function getStripeProducts(): Promise<{
  products: Stripe.Product[]
  prices: Stripe.Price[]
}> {
  try {
    const [productsResponse, pricesResponse] = await Promise.all([
      stripe.products.list({ active: true }),
      stripe.prices.list({ active: true, expand: ['data.product'] }),
    ])

    return {
      products: productsResponse.data,
      prices: pricesResponse.data,
    }
  } catch (error) {
    logger.error('获取Stripe产品和价格失败:', error as Error)
    throw error
  }
}

// 格式化Stripe金额（从分转换为元）
export function formatStripeAmount(amount: number, currency = 'usd'): number {
  const zeroDecimalCurrencies = ['jpy', 'krw', 'vnd']
  return zeroDecimalCurrencies.includes(currency.toLowerCase())
    ? amount
    : amount / 100
}

// 转换金额为Stripe格式（从元转换为分）
export function toStripeAmount(amount: number, currency = 'usd'): number {
  const zeroDecimalCurrencies = ['jpy', 'krw', 'vnd']
  return zeroDecimalCurrencies.includes(currency.toLowerCase())
    ? Math.round(amount)
    : Math.round(amount * 100)
}

// Stripe事件类型守卫
export const isStripeEvent = (event: unknown): event is Stripe.Event => {
  return typeof event === 'object' && event !== null && 'type' in event
}

// 获取Stripe错误信息
export function getStripeErrorMessage(error: unknown): string {
  if (error instanceof Stripe.errors.StripeError) {
    return error.message
  }
  if (error instanceof Error) {
    return error.message
  }
  return '未知的Stripe错误'
}
