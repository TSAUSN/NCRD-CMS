'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export function SiteHostingNotice({ status }: { status?: string }) {
  const router = useRouter()
  useEffect(() => {
    if (status !== 'preparing') return
    const timer = setInterval(() => router.refresh(), 15_000)
    return () => clearInterval(timer)
  }, [status, router])
  if (status === 'preparing')
    return (
      <p className="notice" role="status">
        Your secure test address is being prepared. You can keep editing while it connects. This page will update
        automatically.
      </p>
    )
  if (status === 'error')
    return (
      <p className="notice notice-error" role="alert">
        The test address needs attention from your CMS operator. Your drafts are saved and you can keep editing.
      </p>
    )
  return null
}
