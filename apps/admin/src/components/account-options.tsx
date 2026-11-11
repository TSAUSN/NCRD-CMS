'use client'

import { createContext, useContext, type ReactNode } from 'react'

const PasswordSignIn = createContext(false)

/** Tells signed-in screens whether this installation signs people in with a password. */
export function AccountOptions({ passwordSignIn, children }: { passwordSignIn: boolean; children: ReactNode }) {
  return <PasswordSignIn.Provider value={passwordSignIn}>{children}</PasswordSignIn.Provider>
}

export function usePasswordSignIn(): boolean {
  return useContext(PasswordSignIn)
}
