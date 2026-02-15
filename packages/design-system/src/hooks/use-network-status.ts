"use client"

import * as React from "react"

const POLL_INTERVAL_MS = 5_000

/** Module-level state shared across all hook consumers on the same page. */
let isOnline = true
const listeners = new Set<() => void>()
let refCount = 0
let intervalId: ReturnType<typeof setInterval> | null = null

function notify() {
  for (const listener of listeners) {
    listener()
  }
}

async function checkConnectivity() {
  if (!navigator.onLine) {
    if (isOnline) {
      isOnline = false
      notify()
    }
    return
  }
  try {
    await fetch(`/favicon.ico?_=${Date.now()}`, {
      method: "HEAD",
      cache: "no-store",
    })
    if (!isOnline) {
      isOnline = true
      notify()
    }
  } catch {
    if (isOnline) {
      isOnline = false
      notify()
    }
  }
}

function handleOnline() {
  isOnline = true
  notify()
}

function handleOffline() {
  isOnline = false
  notify()
}

function startPolling() {
  isOnline = navigator.onLine
  window.addEventListener("online", handleOnline)
  window.addEventListener("offline", handleOffline)
  checkConnectivity()
  intervalId = setInterval(checkConnectivity, POLL_INTERVAL_MS)
}

function stopPolling() {
  window.removeEventListener("online", handleOnline)
  window.removeEventListener("offline", handleOffline)
  if (intervalId !== null) {
    clearInterval(intervalId)
    intervalId = null
  }
}

function subscribe(callback: () => void) {
  listeners.add(callback)
  refCount++
  if (refCount === 1) {
    startPolling()
  }
  return () => {
    listeners.delete(callback)
    refCount--
    if (refCount === 0) {
      stopPolling()
    }
  }
}

function getSnapshot() {
  return isOnline
}

function getServerSnapshot() {
  return true
}

/**
 * Returns `true` if the browser has network connectivity.
 *
 * Combines `navigator.onLine` events with periodic HEAD requests (every 5 s)
 * to detect false-positive "online" states (e.g. captive portals).
 *
 * SSR-safe: always returns `true` on the server.
 * Multiple consumers share a single polling interval via a module-level singleton.
 */
export function useNetworkStatus(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
