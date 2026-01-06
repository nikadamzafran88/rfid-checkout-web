import React, { useEffect } from 'react'

export default function PaymentSuccess() {
  useEffect(() => {
    try {
      if (window.opener && !window.opener.closed) {
        // Only send to same-origin opener.
        window.opener.postMessage({ type: 'PAYMENT_SUCCESS' }, window.location.origin)
      }
    } catch {
      // ignore
    }

    const t = setTimeout(() => {
      try {
        window.close()
      } catch {
        // ignore
      }
    }, 1500)

    return () => clearTimeout(t)
  }, [])

  return (
    <div style={{ textAlign: 'center', padding: 50 }}>
      <h1 style={{ color: 'green' }}>Payment Successful!</h1>
      <p>Closing window...</p>
    </div>
  )
}
