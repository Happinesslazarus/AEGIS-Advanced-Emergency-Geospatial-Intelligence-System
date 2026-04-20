/**
 * useWebAuthn custom React hook (web authn logic).
 *
 * How it connects:
 * - Used by React components that need this functionality */

import { useState, useCallback, useEffect } from 'react'

// Types

export interface WebAuthnCredential {
  id: string
  name: string
  createdAt: string
  lastUsed: string | null
  deviceType: 'platform' | 'cross-platform' | 'unknown'
}

export interface UseWebAuthnOptions {
  /** Base URL for WebAuthn API endpoints */
  apiBase?: string
  /** Called when passkey registration succeeds */
  onRegisterSuccess?: (credential: WebAuthnCredential) => void
  /** Called when passkey authentication succeeds */
  onAuthSuccess?: (user: { id: string; email: string; role: string }) => void
  /** Called on any error */
  onError?: (error: Error) => void
}

export interface UseWebAuthnResult {
  /** Whether WebAuthn is supported by the browser */
  isSupported: boolean
  /** Whether a platform authenticator (biometric) is available */
  isPlatformAvailable: boolean
  /** Loading state during registration/authentication */
  isLoading: boolean
  /** Error message if any */
  error: string | null
  /** User's registered credentials */
  credentials: WebAuthnCredential[]
  /** Register a new passkey */
  registerPasskey: (name?: string) => Promise<boolean>
  /** Authenticate with passkey */
  authenticateWithPasskey: () => Promise<boolean>
  /** Delete a registered passkey */
  deletePasskey: (credentialId: string) => Promise<boolean>
  /** Check if user has passkeys registered */
  hasPasskeys: boolean
  /** Clear error state */
  clearError: () => void
}

// Helpers

// bufferToBase64url: converts raw binary (ArrayBuffer) to Base64URL encoding.
// Base64URL is like regular Base64 but replaces + with -, / with _, and drops
// the trailing = padding so the string is safe to use in a URL or JSON without
// percent-encoding.  WebAuthn uses Base64URL for exchanging credential IDs and
// challenge bytes between the browser and the server.
function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let str = ''
  bytes.forEach(b => str += String.fromCharCode(b))
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

// base64urlToBuffer: reverse of bufferToBase64url.
// The server sends challenge bytes as Base64URL strings; the browser requires
// raw ArrayBuffers for the WebAuthn API calls.
function base64urlToBuffer(base64url: string): ArrayBuffer {
  // Restore URL-safe characters back to standard Base64.
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/')
  // Add back the = padding that Base64URL stripped (length must be a multiple of 4).
  const padding = '='.repeat((4 - base64.length % 4) % 4)
  const binary = atob(base64 + padding)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

// Hook

export function useWebAuthn(options: UseWebAuthnOptions = {}): UseWebAuthnResult {
  const { apiBase = '', onRegisterSuccess, onAuthSuccess, onError } = options
  
  const [isSupported, setIsSupported] = useState(false)
  const [isPlatformAvailable, setIsPlatformAvailable] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [credentials, setCredentials] = useState<WebAuthnCredential[]>([])
  
  // Check WebAuthn (Web Authentication API) support on mount.
  // WebAuthn = W3C standard for passwordless login using hardware tokens
  // (USB security keys like YubiKey) or platform authenticators (built-in
  // biometrics: fingerprint, Face ID, Windows Hello).
  useEffect(() => {
    const checkSupport = async () => {
      // PublicKeyCredential is the browser entry point for WebAuthn.
      // Older browsers (IE, some mobile) do not expose this object at all.
      const supported = typeof window !== 'undefined' && 
        !!window.PublicKeyCredential &&
        typeof window.PublicKeyCredential === 'function'
      
      setIsSupported(supported)
      
      if (supported) {
        try {
          // isUserVerifyingPlatformAuthenticatorAvailable(): returns true if the
          // device has a built-in biometric authenticator (Touch ID, Face ID,
          // Windows Hello).  False means only external keys (USB) are available.
          const platformAvailable = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
          setIsPlatformAvailable(platformAvailable)
        } catch {
          setIsPlatformAvailable(false)
        }
      }
    }
    
    checkSupport()
  }, [])
  
  // Fetch user's registered credentials
  const fetchCredentials = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/auth/webauthn/credentials`, {
        credentials: 'include',
      })
      
      if (res.ok) {
        const data = await res.json()
        setCredentials(data.credentials || [])
      }
    } catch {
      // Silently fail - user may not be authenticated
    }
  }, [apiBase])
  
  useEffect(() => {
    fetchCredentials()
  }, [fetchCredentials])
  
  // RegisterPasskey implements the WebAuthn "registration ceremony" (two steps):
  // 1. GET registration OPTIONS from server (server generates a challenge).
  // 2. Browser shows biometric prompt — user verifies identity.
  // 3. Send the resulting PUBLIC KEY attestation back to the server for storage.
  // After this, the user can sign in by proving possession of the private key
  // without ever sending a password over the network.
  const registerPasskey = useCallback(async (name?: string): Promise<boolean> => {
    if (!isSupported) {
      setError('WebAuthn is not supported in this browser')
      return false
    }
    
    setIsLoading(true)
    setError(null)
    
    try {
      // Step 1: Ask the server for a challenge nonce (random value that proves
      // this registration attempt is fresh and not replayed from an old session).
      const optionsRes = await fetch(`${apiBase}/api/auth/webauthn/register/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: name || 'Passkey' }),
      })
      
      if (!optionsRes.ok) {
        throw new Error('Failed to get registration options')
      }
      
      const optionsData = await optionsRes.json()
      
      // 2. Convert server options to WebAuthn format
      const publicKeyOptions: PublicKeyCredentialCreationOptions = {
        challenge: base64urlToBuffer(optionsData.challenge),
        rp: optionsData.rp,
        user: {
          id: base64urlToBuffer(optionsData.user.id),
          name: optionsData.user.name,
          displayName: optionsData.user.displayName,
        },
        pubKeyCredParams: optionsData.pubKeyCredParams,
        timeout: optionsData.timeout || 60000,
        attestation: optionsData.attestation || 'none',
        authenticatorSelection: {
          authenticatorAttachment: isPlatformAvailable ? 'platform' : undefined,
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
        excludeCredentials: (optionsData.excludeCredentials || []).map((c: { id: string; type: string }) => ({
          id: base64urlToBuffer(c.id),
          type: c.type,
        })),
      }
      
      // 3. Create credential with browser API
      const credential = await navigator.credentials.create({
        publicKey: publicKeyOptions,
      }) as PublicKeyCredential | null
      
      if (!credential) {
        throw new Error('Credential creation was cancelled')
      }
      
      const attestationResponse = credential.response as AuthenticatorAttestationResponse
      
      // 4. Send credential to server for verification
      const verifyRes = await fetch(`${apiBase}/api/auth/webauthn/register/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: credential.id,
          rawId: bufferToBase64url(credential.rawId),
          type: credential.type,
          response: {
            clientDataJSON: bufferToBase64url(attestationResponse.clientDataJSON),
            attestationObject: bufferToBase64url(attestationResponse.attestationObject),
          },
          name: name || 'Passkey',
        }),
      })
      
      if (!verifyRes.ok) {
        const errorData = await verifyRes.json()
        throw new Error(errorData.error || 'Failed to verify credential')
      }
      
      const newCredential = await verifyRes.json()
      setCredentials(prev => [...prev, newCredential])
      onRegisterSuccess?.(newCredential)
      
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed'
      setError(message)
      onError?.(err instanceof Error ? err : new Error(message))
      return false
    } finally {
      setIsLoading(false)
    }
  }, [isSupported, isPlatformAvailable, apiBase, onRegisterSuccess, onError])
  
  // Authenticate with passkey
  const authenticateWithPasskey = useCallback(async (): Promise<boolean> => {
    if (!isSupported) {
      setError('WebAuthn is not supported in this browser')
      return false
    }
    
    setIsLoading(true)
    setError(null)
    
    try {
      // 1. Get authentication options from server
      const optionsRes = await fetch(`${apiBase}/api/auth/webauthn/authenticate/options`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      })
      
      if (!optionsRes.ok) {
        throw new Error('Failed to get authentication options')
      }
      
      const optionsData = await optionsRes.json()
      
      // 2. Convert server options to WebAuthn format
      const publicKeyOptions: PublicKeyCredentialRequestOptions = {
        challenge: base64urlToBuffer(optionsData.challenge),
        timeout: optionsData.timeout || 60000,
        rpId: optionsData.rpId,
        userVerification: optionsData.userVerification || 'preferred',
        allowCredentials: (optionsData.allowCredentials || []).map((c: { id: string; type: string; transports?: string[] }) => ({
          id: base64urlToBuffer(c.id),
          type: c.type,
          transports: c.transports,
        })),
      }
      
      // 3. Get assertion from authenticator
      const credential = await navigator.credentials.get({
        publicKey: publicKeyOptions,
      }) as PublicKeyCredential | null
      
      if (!credential) {
        throw new Error('Authentication was cancelled')
      }
      
      const assertionResponse = credential.response as AuthenticatorAssertionResponse
      
      // 4. Verify assertion with server
      const verifyRes = await fetch(`${apiBase}/api/auth/webauthn/authenticate/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          id: credential.id,
          rawId: bufferToBase64url(credential.rawId),
          type: credential.type,
          response: {
            clientDataJSON: bufferToBase64url(assertionResponse.clientDataJSON),
            authenticatorData: bufferToBase64url(assertionResponse.authenticatorData),
            signature: bufferToBase64url(assertionResponse.signature),
            userHandle: assertionResponse.userHandle 
              ? bufferToBase64url(assertionResponse.userHandle) 
              : null,
          },
        }),
      })
      
      if (!verifyRes.ok) {
        const errorData = await verifyRes.json()
        throw new Error(errorData.error || 'Authentication failed')
      }
      
      const userData = await verifyRes.json()
      onAuthSuccess?.(userData.user)
      
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Authentication failed'
      setError(message)
      onError?.(err instanceof Error ? err : new Error(message))
      return false
    } finally {
      setIsLoading(false)
    }
  }, [isSupported, apiBase, onAuthSuccess, onError])
  
  // Delete passkey
  const deletePasskey = useCallback(async (credentialId: string): Promise<boolean> => {
    setIsLoading(true)
    setError(null)
    
    try {
      const res = await fetch(`${apiBase}/api/auth/webauthn/credentials/${credentialId}`, {
        method: 'DELETE',
        credentials: 'include',
      })
      
      if (!res.ok) {
        throw new Error('Failed to delete passkey')
      }
      
      setCredentials(prev => prev.filter(c => c.id !== credentialId))
      return true
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Delete failed'
      setError(message)
      onError?.(err instanceof Error ? err : new Error(message))
      return false
    } finally {
      setIsLoading(false)
    }
  }, [apiBase, onError])
  
  const clearError = useCallback(() => setError(null), [])
  
  return {
    isSupported,
    isPlatformAvailable,
    isLoading,
    error,
    credentials,
    registerPasskey,
    authenticateWithPasskey,
    deletePasskey,
    hasPasskeys: credentials.length > 0,
    clearError,
  }
}
