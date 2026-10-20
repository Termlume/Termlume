import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt as scryptCallback,
} from 'node:crypto'
import { z } from 'zod'
import type { HostProfile, Settings, SshIdentity } from '../../shared/contracts'
import { hostSchema, settingsSchema, sshIdentitySchema } from '../../shared/schemas'
import { AppError } from '../../shared/errors'

const scrypt = (passphrase: string, salt: Buffer, options: { N: number; r: number; p: number }) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCallback(passphrase, salt, 32, { ...options, maxmem: 256 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  )
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024
const KDF = { N: 2 ** 17, r: 8, p: 1, keyLength: 32 } as const

export interface PortableData {
  hosts: HostProfile[]
  identities: SshIdentity[]
  settings: Settings
  knownHosts: Record<string, string>
  secrets: Record<string, string>
}

const payloadSchema = z
  .object({
    hosts: z.array(hostSchema).max(10000),
    identities: z.array(sshIdentitySchema).max(10000),
    settings: settingsSchema,
    knownHosts: z.record(z.string().max(500), z.string().max(5000)),
    secrets: z.record(z.string().min(1).max(200), z.string().max(16384)),
  })
  .strict()
  .superRefine((data, context) => {
    const hostIds = new Set<string>(),
      identityIds = new Set<string>()
    for (const host of data.hosts) {
      if (hostIds.has(host.id)) context.addIssue({ code: 'custom', message: 'Duplicate host ID' })
      hostIds.add(host.id)
    }
    for (const identity of data.identities) {
      if (identityIds.has(identity.id))
        context.addIssue({ code: 'custom', message: 'Duplicate identity ID' })
      identityIds.add(identity.id)
    }
    for (const host of data.hosts)
      if (host.protocol === 'ssh' && host.identityId && !identityIds.has(host.identityId))
        context.addIssue({ code: 'custom', message: 'Host references a missing SSH identity' })
  })

type Archive = {
  format: 'personal-terminal-backup'
  version: 1
  kdf: { name: 'scrypt'; N: number; r: number; p: number }
  cipher: 'aes-256-gcm'
  salt: string
  nonce: string
  tag: string
  ciphertext: string
}

export async function encodePortableBackup(
  value: PortableData,
  passphrase: string,
): Promise<Buffer> {
  if (passphrase.length < 8 || passphrase.length > 1024)
    throw new AppError(
      'backup-passphrase',
      'Пароль резервной копии должен содержать от 8 до 1024 символов',
    )
  const payload = payloadSchema.parse(value),
    salt = randomBytes(16),
    nonce = randomBytes(12),
    key = await scrypt(passphrase, salt, { N: KDF.N, r: KDF.r, p: KDF.p }),
    cipher = createCipheriv('aes-256-gcm', key, nonce)
  try {
    const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(payload), 'utf8'),
        cipher.final(),
      ]),
      archive: Archive = {
        format: 'personal-terminal-backup',
        version: 1,
        kdf: { name: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p },
        cipher: 'aes-256-gcm',
        salt: salt.toString('base64'),
        nonce: nonce.toString('base64'),
        tag: cipher.getAuthTag().toString('base64'),
        ciphertext: ciphertext.toString('base64'),
      },
      result = Buffer.from(JSON.stringify(archive), 'utf8')
    if (result.length > MAX_ARCHIVE_BYTES)
      throw new AppError('backup-size', 'Архив резервной копии слишком велик')
    return result
  } finally {
    key.fill(0)
  }
}

export async function decodePortableBackup(
  input: Buffer,
  passphrase: string,
): Promise<PortableData> {
  if (!Buffer.isBuffer(input) || input.length < 100 || input.length > MAX_ARCHIVE_BYTES)
    throw new AppError('backup-invalid', 'Файл резервной копии повреждён или слишком велик')
  try {
    const archive = z
      .object({
        format: z.literal('personal-terminal-backup'),
        version: z.literal(1),
        kdf: z
          .object({
            name: z.literal('scrypt'),
            N: z.literal(KDF.N),
            r: z.literal(KDF.r),
            p: z.literal(KDF.p),
          })
          .strict(),
        cipher: z.literal('aes-256-gcm'),
        salt: z.string(),
        nonce: z.string(),
        tag: z.string(),
        ciphertext: z.string(),
      })
      .strict()
      .parse(JSON.parse(input.toString('utf8'))) as Archive
    const salt = decodeBase64(archive.salt, 16),
      nonce = decodeBase64(archive.nonce, 12),
      tag = decodeBase64(archive.tag, 16),
      ciphertext = decodeBase64(archive.ciphertext),
      key = await scrypt(passphrase, salt, { N: KDF.N, r: KDF.r, p: KDF.p })
    try {
      const decipher = createDecipheriv('aes-256-gcm', key, nonce)
      decipher.setAuthTag(tag)
      const clear = Buffer.concat([decipher.update(ciphertext), decipher.final()])
      try {
        const text = clear.toString('utf8'),
          parsed: unknown = JSON.parse(text)
        if (containsPrivateKeyMaterial(parsed))
          throw new AppError('backup-invalid', 'Архив содержит запрещённые данные ключа')
        return payloadSchema.parse(parsed)
      } finally {
        clear.fill(0)
      }
    } finally {
      key.fill(0)
    }
  } catch (error) {
    if (error instanceof AppError && error.code === 'backup-invalid') throw error
    throw new AppError(
      'backup-authentication',
      'Не удалось открыть архив: проверьте пароль и целостность файла',
    )
  }
}

function decodeBase64(value: string, length?: number) {
  if (
    value.length > MAX_ARCHIVE_BYTES ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  )
    throw new Error('invalid base64')
  const result = Buffer.from(value, 'base64')
  if (result.toString('base64') !== value || (length !== undefined && result.length !== length))
    throw new Error('invalid base64 length')
  return result
}

function containsPrivateKeyMaterial(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return value.some(containsPrivateKeyMaterial)
  return Object.entries(value).some(
    ([key, child]) =>
      ['privatekey', 'privatekeybytes', 'keybytes', 'privatekeydata'].includes(key.toLowerCase()) ||
      containsPrivateKeyMaterial(child),
  )
}
