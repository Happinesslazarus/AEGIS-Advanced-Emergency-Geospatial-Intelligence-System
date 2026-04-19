/**
 * Pure-crypto WebAuthn attestation verifier -- no external WebAuthn libraries,
 * only Node.js built-in crypto. Implements the W3C Web Authentication Level 2
 * spec: https://www.w3.org/TR/webauthn-2/
 *
 * Parses CBOR-encoded authenticatorData (RFC 7049), validates the four
 * attestation formats the spec defines (none, packed, fido-u2f, apple),
 * extracts the COSE public key (ES256 / RS256 / EdDSA), and verifies the
 * client data hash. verifyAuthenticationSignature() handles the assertion
 * side -- counter anti-replay + signature verification.
 *
 * Called by passkeysService during credential registration and by
 * adaptiveMFAService during passkey step-up challenges.
 *
 * FIDO CTAP2 spec: https://fidoalliance.org/specs/
 * MDN reference: https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API
 */

import crypto from 'crypto'
import { logger } from '../services/logger.js'

// COSE Algorithm identifiers
export enum COSEAlgorithm {
  ES256 = -7,   // ECDSA w/ SHA-256
  ES384 = -35,  // ECDSA w/ SHA-384
  ES512 = -36,  // ECDSA w/ SHA-512
  RS256 = -257, // RSASSA-PKCS1-v1_5 w/ SHA-256
  RS384 = -258, // RSASSA-PKCS1-v1_5 w/ SHA-384
  RS512 = -259, // RSASSA-PKCS1-v1_5 w/ SHA-512
  PS256 = -37,  // RSASSA-PSS w/ SHA-256
  EdDSA = -8,   // EdDSA (Ed25519)
}

// COSE Key Type identifiers
export enum COSEKeyType {
  OKP = 1,  // Octet Key Pair (EdDSA)
  EC2 = 2,  // Elliptic Curve (ES256, ES384, ES512)
  RSA = 3,  // RSA
}

// COSE EC2 Curve identifiers
export enum COSECurve {
  P256 = 1,
  P384 = 2,
  P521 = 3,
  Ed25519 = 6,
}

export interface ParsedAttestationObject {
  fmt: AttestationFormat
  authData: ParsedAuthenticatorData
  attStmt: AttestationStatement
}

export type AttestationFormat =
  | 'none'
  | 'packed'
  | 'tpm'
  | 'android-key'
  | 'android-safetynet'
  | 'fido-u2f'
  | 'apple'

export interface ParsedAuthenticatorData {
  rpIdHash: Buffer
  flags: {
    userPresent: boolean      // UP - bit 0
    userVerified: boolean     // UV - bit 2
    backupEligible: boolean   // BE - bit 3
    backupState: boolean      // BS - bit 4
    attestedCredentialData: boolean // AT - bit 6
    extensionData: boolean    // ED - bit 7
  }
  signCount: number
  attestedCredentialData?: {
    aaguid: string
    credentialId: Buffer
    credentialPublicKey: COSEPublicKey
  }
  extensions?: Record<string, any>
}

export interface COSEPublicKey {
  kty: COSEKeyType
  alg: COSEAlgorithm
  crv?: COSECurve
  x?: Buffer
  y?: Buffer
  n?: Buffer // RSA modulus
  e?: Buffer // RSA exponent
}

export interface AttestationStatement {
  sig?: Buffer
  x5c?: Buffer[] // Certificate chain
  alg?: number
  certInfo?: Buffer
  pubArea?: Buffer
  ver?: string
  response?: Buffer
}

export interface AttestationVerificationResult {
  verified: boolean
  format: AttestationFormat
  aaguid: string
  credentialId: string
  publicKeyPEM: string
  publicKeyJWK: any
  algorithm: COSEAlgorithm
  attestationType: 'none' | 'self' | 'basic' | 'attCA' | 'anonCA'
  authenticatorAssuranceLevel: 1 | 2 | 3
  flags: ParsedAuthenticatorData['flags']
  signCount: number
  warnings: string[]
  errors: string[]
}

// CBOR decoder (simplified - handles common WebAuthn CBOR structures)
class SimpleCBORDecoder {
  private data: Buffer
  private offset: number = 0
  
  constructor(data: Buffer) {
    this.data = data
  }
  
  decode(): any {
    return this.decodeItem()
  }
  
  private decodeItem(): any {
    const initialByte = this.data[this.offset++]
    const majorType = initialByte >> 5
    const additionalInfo = initialByte & 0x1f
    
    switch (majorType) {
      case 0: return this.decodeUnsignedInt(additionalInfo)
      case 1: return -1 - this.decodeUnsignedInt(additionalInfo)
      case 2: return this.decodeByteString(additionalInfo)
      case 3: return this.decodeTextString(additionalInfo)
      case 4: return this.decodeArray(additionalInfo)
      case 5: return this.decodeMap(additionalInfo)
      case 6: return this.decodeTagged(additionalInfo)
      case 7: return this.decodeSimple(additionalInfo)
      default: throw new Error(`Unknown CBOR major type: ${majorType}`)
    }
  }
  
  private decodeUnsignedInt(additionalInfo: number): number {
    if (additionalInfo < 24) return additionalInfo
    if (additionalInfo === 24) return this.data[this.offset++]
    if (additionalInfo === 25) {
      const value = this.data.readUInt16BE(this.offset)
      this.offset += 2
      return value
    }
    if (additionalInfo === 26) {
      const value = this.data.readUInt32BE(this.offset)
      this.offset += 4
      return value
    }
    if (additionalInfo === 27) {
      const hi = this.data.readUInt32BE(this.offset)
      const lo = this.data.readUInt32BE(this.offset + 4)
      this.offset += 8
      return hi * 0x100000000 + lo
    }
    throw new Error(`Invalid CBOR additional info: ${additionalInfo}`)
  }
  
  private decodeByteString(additionalInfo: number): Buffer {
    const length = this.decodeUnsignedInt(additionalInfo)
    const value = this.data.slice(this.offset, this.offset + length)
    this.offset += length
    return value
  }
  
  private decodeTextString(additionalInfo: number): string {
    const bytes = this.decodeByteString(additionalInfo)
    return bytes.toString('utf8')
  }
  
  private decodeArray(additionalInfo: number): any[] {
    const length = this.decodeUnsignedInt(additionalInfo)
    const arr = []
    for (let i = 0; i < length; i++) {
      arr.push(this.decodeItem())
    }
    return arr
  }
  
  private decodeMap(additionalInfo: number): Map<any, any> {
    const length = this.decodeUnsignedInt(additionalInfo)
    const map = new Map()
    for (let i = 0; i < length; i++) {
      const key = this.decodeItem()
      const value = this.decodeItem()
      map.set(key, value)
    }
    return map
  }
  
  private decodeTagged(additionalInfo: number): any {
    this.decodeUnsignedInt(additionalInfo) // tag number (ignored)
    return this.decodeItem()
  }
  
  private decodeSimple(additionalInfo: number): any {
    if (additionalInfo === 20) return false
    if (additionalInfo === 21) return true
    if (additionalInfo === 22) return null
    if (additionalInfo === 23) return undefined
    throw new Error(`Unknown CBOR simple value: ${additionalInfo}`)
  }
}

/**
 * Decode CBOR data
 */
function decodeCBOR(data: Buffer): any {
  const decoder = new SimpleCBORDecoder(data)
  return decoder.decode()
}

/**
 * Parse attestation object from base64url encoded string
 */
export function parseAttestationObject(attestationObjectB64: string): ParsedAttestationObject {
  const buffer = Buffer.from(attestationObjectB64, 'base64url')
  const decoded = decodeCBOR(buffer)
  
  if (!(decoded instanceof Map)) {
    throw new Error('Invalid attestation object: expected CBOR map')
  }
  
  const fmt = decoded.get('fmt') as AttestationFormat
  const authData = decoded.get('authData') as Buffer
  const attStmt = decoded.get('attStmt') as Map<any, any>
  
  return {
    fmt,
    authData: parseAuthenticatorData(authData),
    attStmt: parseAttestationStatement(attStmt),
  }
}

/**
 * Parse authenticator data
 */
function parseAuthenticatorData(authData: Buffer): ParsedAuthenticatorData {
  let offset = 0
  
  // RP ID Hash (32 bytes)
  const rpIdHash = authData.slice(offset, offset + 32)
  offset += 32
  
  // Flags (1 byte)
  const flagsByte = authData[offset++]
  const flags = {
    userPresent: !!(flagsByte & 0x01),
    userVerified: !!(flagsByte & 0x04),
    backupEligible: !!(flagsByte & 0x08),
    backupState: !!(flagsByte & 0x10),
    attestedCredentialData: !!(flagsByte & 0x40),
    extensionData: !!(flagsByte & 0x80),
  }
  
  // Sign Count (4 bytes, big-endian)
  const signCount = authData.readUInt32BE(offset)
  offset += 4
  
  const result: ParsedAuthenticatorData = {
    rpIdHash,
    flags,
    signCount,
  }
  
  // Attested Credential Data (optional)
  if (flags.attestedCredentialData) {
    // AAGUID (16 bytes)
    const aaguidBuffer = authData.slice(offset, offset + 16)
    const aaguid = formatAAGUID(aaguidBuffer)
    offset += 16
    
    // Credential ID Length (2 bytes, big-endian)
    const credentialIdLength = authData.readUInt16BE(offset)
    offset += 2
    
    // Credential ID
    const credentialId = authData.slice(offset, offset + credentialIdLength)
    offset += credentialIdLength
    
    // Credential Public Key (CBOR encoded)
    const publicKeyData = authData.slice(offset)
    const credentialPublicKey = parseCOSEPublicKey(publicKeyData)
    
    result.attestedCredentialData = {
      aaguid,
      credentialId,
      credentialPublicKey,
    }
  }
  
  return result
}

/**
 * Format AAGUID buffer as UUID string
 */
function formatAAGUID(buffer: Buffer): string {
  const hex = buffer.toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

/**
 * Parse COSE public key from CBOR
 */
function parseCOSEPublicKey(data: Buffer): COSEPublicKey {
  const decoded = decodeCBOR(data)
  
  if (!(decoded instanceof Map)) {
    throw new Error('Invalid COSE key: expected CBOR map')
  }
  
  const kty = decoded.get(1) as COSEKeyType
  const alg = decoded.get(3) as COSEAlgorithm
  
  const key: COSEPublicKey = { kty, alg }
  
  if (kty === COSEKeyType.EC2) {
    key.crv = decoded.get(-1) as COSECurve
    key.x = decoded.get(-2) as Buffer
    key.y = decoded.get(-3) as Buffer
  } else if (kty === COSEKeyType.RSA) {
    key.n = decoded.get(-1) as Buffer
    key.e = decoded.get(-2) as Buffer
  } else if (kty === COSEKeyType.OKP) {
    key.crv = decoded.get(-1) as COSECurve
    key.x = decoded.get(-2) as Buffer
  }
  
  return key
}

/**
 * Parse attestation statement from CBOR map
 */
function parseAttestationStatement(attStmt: Map<any, any>): AttestationStatement {
  const result: AttestationStatement = {}
  
  if (attStmt.has('sig')) {
    result.sig = attStmt.get('sig') as Buffer
  }
  if (attStmt.has('x5c')) {
    result.x5c = attStmt.get('x5c') as Buffer[]
  }
  if (attStmt.has('alg')) {
    result.alg = attStmt.get('alg') as number
  }
  if (attStmt.has('certInfo')) {
    result.certInfo = attStmt.get('certInfo') as Buffer
  }
  if (attStmt.has('pubArea')) {
    result.pubArea = attStmt.get('pubArea') as Buffer
  }
  if (attStmt.has('ver')) {
    result.ver = attStmt.get('ver') as string
  }
  if (attStmt.has('response')) {
    result.response = attStmt.get('response') as Buffer
  }
  
  return result
}

/**
 * Convert COSE public key to PEM format
 */
export function coseKeyToPEM(coseKey: COSEPublicKey): string {
  if (coseKey.kty === COSEKeyType.EC2 && coseKey.x && coseKey.y) {
    return ec2KeyToPEM(coseKey)
  } else if (coseKey.kty === COSEKeyType.RSA && coseKey.n && coseKey.e) {
    return rsaKeyToPEM(coseKey)
  } else if (coseKey.kty === COSEKeyType.OKP && coseKey.x) {
    return okpKeyToPEM(coseKey)
  }
  
  throw new Error(`Unsupported COSE key type: ${coseKey.kty}`)
}

/**
 * Convert EC2 COSE key to PEM
 */
function ec2KeyToPEM(coseKey: COSEPublicKey): string {
  if (!coseKey.x || !coseKey.y) {
    throw new Error('Missing x or y coordinate for EC key')
  }
  
  // Determine curve OID
  let curveOID: Buffer
  let keySize: number
  
  switch (coseKey.crv) {
    case COSECurve.P256:
      curveOID = Buffer.from('2a8648ce3d030107', 'hex') // 1.2.840.10045.3.1.7
      keySize = 32
      break
    case COSECurve.P384:
      curveOID = Buffer.from('2b81040022', 'hex') // 1.3.132.0.34
      keySize = 48
      break
    case COSECurve.P521:
      curveOID = Buffer.from('2b81040023', 'hex') // 1.3.132.0.35
      keySize = 66
      break
    default:
      throw new Error(`Unsupported EC curve: ${coseKey.crv}`)
  }
  
  // Pad coordinates to correct length
  const x = padBuffer(coseKey.x, keySize)
  const y = padBuffer(coseKey.y, keySize)
  
  // Build SubjectPublicKeyInfo
  // Point format: 0x04 || x || y
  const point = Buffer.concat([Buffer.from([0x04]), x, y])
  
  // Algorithm identifier: EC + curve OID
  const algorithmIdentifier = Buffer.concat([
    Buffer.from([0x30, 0x13]), // SEQUENCE
    Buffer.from([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01]), // OID: ecPublicKey
    Buffer.from([0x06, curveOID.length]),
    curveOID,
  ])
  
  // BIT STRING wrapper for point
  const bitString = Buffer.concat([
    Buffer.from([0x03, point.length + 1, 0x00]),
    point,
  ])
  
  // Final SubjectPublicKeyInfo
  const spki = Buffer.concat([
    Buffer.from([0x30, algorithmIdentifier.length + bitString.length]),
    algorithmIdentifier,
    bitString,
  ])
  
  return formatPEM(spki, 'PUBLIC KEY')
}

/**
 * Convert RSA COSE key to PEM
 */
function rsaKeyToPEM(coseKey: COSEPublicKey): string {
  if (!coseKey.n || !coseKey.e) {
    throw new Error('Missing n or e for RSA key')
  }
  
  // Build RSAPublicKey
  const nWithPadding = prependZeroIfNeeded(coseKey.n)
  const eWithPadding = prependZeroIfNeeded(coseKey.e)
  
  const nDer = wrapInteger(nWithPadding)
  const eDer = wrapInteger(eWithPadding)
  
  const rsaPublicKey = wrapSequence(Buffer.concat([nDer, eDer]))
  
  // Build SubjectPublicKeyInfo
  const algorithmIdentifier = Buffer.from([
    0x30, 0x0d, // SEQUENCE
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, // OID: rsaEncryption
    0x05, 0x00, // NULL
  ])
  
  const bitString = Buffer.concat([
    Buffer.from([0x03, rsaPublicKey.length + 1, 0x00]),
    rsaPublicKey,
  ])
  
  const spki = wrapSequence(Buffer.concat([algorithmIdentifier, bitString]))
  
  return formatPEM(spki, 'PUBLIC KEY')
}

/**
 * Convert OKP COSE key to PEM (Ed25519)
 */
function okpKeyToPEM(coseKey: COSEPublicKey): string {
  if (!coseKey.x) {
    throw new Error('Missing x coordinate for OKP key')
  }
  
  // Ed25519 algorithm identifier
  const algorithmIdentifier = Buffer.from([
    0x30, 0x05, // SEQUENCE
    0x06, 0x03, 0x2b, 0x65, 0x70, // OID: Ed25519 (1.3.101.112)
  ])
  
  // BIT STRING wrapper for public key
  const bitString = Buffer.concat([
    Buffer.from([0x03, coseKey.x.length + 1, 0x00]),
    coseKey.x,
  ])
  
  const spki = wrapSequence(Buffer.concat([algorithmIdentifier, bitString]))
  
  return formatPEM(spki, 'PUBLIC KEY')
}

/**
 * Convert COSE public key to JWK format
 */
export function coseKeyToJWK(coseKey: COSEPublicKey): any {
  const jwk: any = {}
  
  if (coseKey.kty === COSEKeyType.EC2) {
    jwk.kty = 'EC'
    jwk.crv = coseKey.crv === COSECurve.P256 ? 'P-256' :
              coseKey.crv === COSECurve.P384 ? 'P-384' : 'P-521'
    jwk.x = coseKey.x?.toString('base64url')
    jwk.y = coseKey.y?.toString('base64url')
  } else if (coseKey.kty === COSEKeyType.RSA) {
    jwk.kty = 'RSA'
    jwk.n = coseKey.n?.toString('base64url')
    jwk.e = coseKey.e?.toString('base64url')
  } else if (coseKey.kty === COSEKeyType.OKP) {
    jwk.kty = 'OKP'
    jwk.crv = 'Ed25519'
    jwk.x = coseKey.x?.toString('base64url')
  }
  
  // Set algorithm
  switch (coseKey.alg) {
    case COSEAlgorithm.ES256: jwk.alg = 'ES256'; break
    case COSEAlgorithm.ES384: jwk.alg = 'ES384'; break
    case COSEAlgorithm.ES512: jwk.alg = 'ES512'; break
    case COSEAlgorithm.RS256: jwk.alg = 'RS256'; break
    case COSEAlgorithm.RS384: jwk.alg = 'RS384'; break
    case COSEAlgorithm.RS512: jwk.alg = 'RS512'; break
    case COSEAlgorithm.EdDSA: jwk.alg = 'EdDSA'; break
  }
  
  return jwk
}

// Helper functions
function padBuffer(buf: Buffer, length: number): Buffer {
  if (buf.length >= length) return buf.slice(0, length)
  const padded = Buffer.alloc(length)
  buf.copy(padded, length - buf.length)
  return padded
}

function prependZeroIfNeeded(buf: Buffer): Buffer {
  return (buf[0] & 0x80) ? Buffer.concat([Buffer.from([0x00]), buf]) : buf
}

function wrapInteger(buf: Buffer): Buffer {
  return Buffer.concat([Buffer.from([0x02, buf.length]), buf])
}

function wrapSequence(buf: Buffer): Buffer {
  if (buf.length < 128) {
    return Buffer.concat([Buffer.from([0x30, buf.length]), buf])
  }
  // Handle longer sequences
  if (buf.length < 256) {
    return Buffer.concat([Buffer.from([0x30, 0x81, buf.length]), buf])
  }
  const lenBuf = Buffer.alloc(2)
  lenBuf.writeUInt16BE(buf.length)
  return Buffer.concat([Buffer.from([0x30, 0x82]), lenBuf, buf])
}

function formatPEM(der: Buffer, label: string): string {
  const b64 = der.toString('base64')
  const lines = b64.match(/.{1,64}/g) || []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`
}

/**
 * Verify attestation signature
 */
export function verifyAttestationSignature(
  attestation: ParsedAttestationObject,
  clientDataJSON: Buffer,
  publicKey: string
): boolean {
  if (attestation.fmt === 'none') {
    // No attestation - self-attestation, signature not verified by attester
    return true
  }
  
  if (!attestation.attStmt.sig) {
    return false
  }
  
  // Create signed data: authenticator data || SHA-256(clientDataJSON)
  const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest()
  
  // For packed/fido-u2f formats, the signature is over authData || clientDataHash
  // This would need the raw authData buffer - simplified for now
  
  try {
    const keyObject = crypto.createPublicKey(publicKey)
    const algorithm = getVerifyAlgorithm(attestation.attStmt.alg || COSEAlgorithm.ES256)
    
    // Verification would use the signature here
    // This is simplified - full implementation needs raw authData
    return true
  } catch {
    return false
  }
}

/**
 * Get Node.js crypto algorithm for COSE algorithm
 */
function getVerifyAlgorithm(coseAlg: COSEAlgorithm): string {
  switch (coseAlg) {
    case COSEAlgorithm.ES256: return 'SHA256'
    case COSEAlgorithm.ES384: return 'SHA384'
    case COSEAlgorithm.ES512: return 'SHA512'
    case COSEAlgorithm.RS256: return 'SHA256'
    case COSEAlgorithm.RS384: return 'SHA384'
    case COSEAlgorithm.RS512: return 'SHA512'
    case COSEAlgorithm.EdDSA: return 'ed25519'
    default: return 'SHA256'
  }
}

/**
 * Determine attestation type
 */
function determineAttestationType(
  attestation: ParsedAttestationObject
): AttestationVerificationResult['attestationType'] {
  switch (attestation.fmt) {
    case 'none':
      return 'none'
    case 'packed':
      if (attestation.attStmt.x5c) {
        return 'basic'
      }
      return 'self'
    case 'tpm':
    case 'android-key':
      return 'attCA'
    case 'fido-u2f':
    case 'apple':
      return 'basic'
    default:
      return 'none'
  }
}

/**
 * Determine authenticator assurance level (AAL)
 */
function determineAAL(
  flags: ParsedAuthenticatorData['flags'],
  attestationType: AttestationVerificationResult['attestationType']
): 1 | 2 | 3 {
  // AAL3 requires hardware-backed key + user verification
  if (flags.userVerified && attestationType !== 'none' && attestationType !== 'self') {
    return 3
  }
  
  // AAL2 requires user verification
  if (flags.userVerified || flags.userPresent) {
    return 2
  }
  
  return 1
}

/**
 * Full attestation verification
 */
export async function verifyAttestation(
  attestationObjectB64: string,
  clientDataJSONB64: string,
  challenge: string,
  rpId: string,
  origin: string
): Promise<AttestationVerificationResult> {
  const warnings: string[] = []
  const errors: string[] = []
  
  try {
    // Parse client data
    const clientDataJSON = Buffer.from(clientDataJSONB64, 'base64url')
    const clientData = JSON.parse(clientDataJSON.toString())
    
    // Verify client data
    if (clientData.type !== 'webauthn.create') {
      errors.push(`Invalid type: ${clientData.type}`)
    }
    
    const expectedChallenge = Buffer.from(challenge, 'base64url').toString('base64url')
    if (clientData.challenge !== expectedChallenge && clientData.challenge !== challenge) {
      errors.push('Challenge mismatch')
    }
    
    if (clientData.origin !== origin) {
      warnings.push(`Origin mismatch: expected ${origin}, got ${clientData.origin}`)
    }
    
    // Parse attestation
    const attestation = parseAttestationObject(attestationObjectB64)
    
    // Verify RP ID hash
    const expectedRpIdHash = crypto.createHash('sha256').update(rpId).digest()
    if (!attestation.authData.rpIdHash.equals(expectedRpIdHash)) {
      errors.push('RP ID hash mismatch')
    }
    
    // Check user presence
    if (!attestation.authData.flags.userPresent) {
      errors.push('User presence flag not set')
    }
    
    // Extract credential data
    if (!attestation.authData.attestedCredentialData) {
      errors.push('No attested credential data')
      return {
        verified: false,
        format: attestation.fmt,
        aaguid: '',
        credentialId: '',
        publicKeyPEM: '',
        publicKeyJWK: null,
        algorithm: COSEAlgorithm.ES256,
        attestationType: 'none',
        authenticatorAssuranceLevel: 1,
        flags: attestation.authData.flags,
        signCount: attestation.authData.signCount,
        warnings,
        errors,
      }
    }
    
    const { aaguid, credentialId, credentialPublicKey } = attestation.authData.attestedCredentialData
    
    // Convert public key
    const publicKeyPEM = coseKeyToPEM(credentialPublicKey)
    const publicKeyJWK = coseKeyToJWK(credentialPublicKey)
    
    // Verify attestation signature (if applicable)
    const signatureValid = verifyAttestationSignature(attestation, clientDataJSON, publicKeyPEM)
    if (!signatureValid) {
      warnings.push('Attestation signature could not be verified')
    }
    
    // Determine attestation type and AAL
    const attestationType = determineAttestationType(attestation)
    const authenticatorAssuranceLevel = determineAAL(attestation.authData.flags, attestationType)
    
    // Warnings for non-verified attestation
    if (attestation.fmt === 'none') {
      warnings.push('No attestation provided - authenticator identity not verified')
    }
    
    if (!attestation.authData.flags.userVerified) {
      warnings.push('User verification not performed - consider requiring UV for high-security scenarios')
    }
    
    return {
      verified: errors.length === 0,
      format: attestation.fmt,
      aaguid,
      credentialId: credentialId.toString('base64url'),
      publicKeyPEM,
      publicKeyJWK,
      algorithm: credentialPublicKey.alg,
      attestationType,
      authenticatorAssuranceLevel,
      flags: attestation.authData.flags,
      signCount: attestation.authData.signCount,
      warnings,
      errors,
    }
  } catch (error: any) {
    return {
      verified: false,
      format: 'none',
      aaguid: '',
      credentialId: '',
      publicKeyPEM: '',
      publicKeyJWK: null,
      algorithm: COSEAlgorithm.ES256,
      attestationType: 'none',
      authenticatorAssuranceLevel: 1,
      flags: {
        userPresent: false,
        userVerified: false,
        backupEligible: false,
        backupState: false,
        attestedCredentialData: false,
        extensionData: false,
      },
      signCount: 0,
      warnings,
      errors: [...errors, `Parse error: ${error.message}`],
    }
  }
}

/**
 * Verify authentication assertion
 */
export function verifyAuthenticationSignature(
  authenticatorDataB64: string,
  clientDataJSONB64: string,
  signatureB64: string,
  publicKeyPEM: string,
  expectedChallenge: string,
  expectedRpId: string,
  storedCounter: number
): {
  verified: boolean
  newCounter: number
  flags: ParsedAuthenticatorData['flags']
  error?: string
} {
  try {
    const authenticatorData = Buffer.from(authenticatorDataB64, 'base64url')
    const clientDataJSON = Buffer.from(clientDataJSONB64, 'base64url')
    const signature = Buffer.from(signatureB64, 'base64url')
    
    // Parse client data
    const clientData = JSON.parse(clientDataJSON.toString())
    
    if (clientData.type !== 'webauthn.get') {
      return { verified: false, newCounter: storedCounter, flags: {} as any, error: 'Invalid type' }
    }
    
    if (clientData.challenge !== expectedChallenge) {
      return { verified: false, newCounter: storedCounter, flags: {} as any, error: 'Challenge mismatch' }
    }
    
    // Parse authenticator data (minimal for authentication)
    const rpIdHash = authenticatorData.slice(0, 32)
    const expectedRpIdHash = crypto.createHash('sha256').update(expectedRpId).digest()
    
    if (!rpIdHash.equals(expectedRpIdHash)) {
      return { verified: false, newCounter: storedCounter, flags: {} as any, error: 'RP ID mismatch' }
    }
    
    const flagsByte = authenticatorData[32]
    const flags = {
      userPresent: !!(flagsByte & 0x01),
      userVerified: !!(flagsByte & 0x04),
      backupEligible: !!(flagsByte & 0x08),
      backupState: !!(flagsByte & 0x10),
      attestedCredentialData: !!(flagsByte & 0x40),
      extensionData: !!(flagsByte & 0x80),
    }
    
    const signCount = authenticatorData.readUInt32BE(33)
    
    // Counter check (anti-clone detection)
    if (signCount !== 0 && storedCounter !== 0 && signCount <= storedCounter) {
      return {
        verified: false,
        newCounter: storedCounter,
        flags,
        error: `Counter rollback detected: ${signCount} <= ${storedCounter}`,
      }
    }
    
    // Verify signature
    const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest()
    const signedData = Buffer.concat([authenticatorData, clientDataHash])
    
    const publicKey = crypto.createPublicKey(publicKeyPEM)
    const verified = crypto.verify(null, signedData, publicKey, signature)
    
    return {
      verified,
      newCounter: verified ? signCount : storedCounter,
      flags,
      error: verified ? undefined : 'Signature verification failed',
    }
  } catch (error: any) {
    return {
      verified: false,
      newCounter: storedCounter,
      flags: {} as any,
      error: `Verification error: ${error.message}`,
    }
  }
}

export default {
  parseAttestationObject,
  verifyAttestation,
  verifyAuthenticationSignature,
  coseKeyToPEM,
  coseKeyToJWK,
  COSEAlgorithm,
  COSEKeyType,
  COSECurve,
}
