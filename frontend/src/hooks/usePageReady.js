import { useEffect, useRef } from 'react'
import { useLoading } from '../context/LoadingContext'

export function usePageReady(isReady) {
  const { ready } = useLoading()
  const called = useRef(false)
  useEffect(() => {
    if (isReady && !called.current) {
      called.current = true
      ready()
    }
  }, [isReady, ready])
}
