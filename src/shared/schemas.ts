import { MONITOR_ITEMS, DEFAULT_MONITOR_ITEMS } from './monitoring-items'
import { SHORTCUT_IDS, shortcutBindingsError } from './keyboard-shortcuts'
import { z } from 'zod'
import { DEFAULT_HIGHLIGHT_RULES, highlightRuleError } from './highlight-rules'
export const highlightRulesSchema = z
  .array(
    z
      .object({
        id: z.string().min(1).max(100),
        name: z.string().trim().min(1).max(80),
        pattern: z.string().min(1).max(256),
        mode: z.enum(['literal', 'regex']),
        color: z.string().regex(/^#[0-9a-f]{6}$/i),
        caseSensitive: z.boolean(),
        wholeLine: z.boolean(),
        enabled: z.boolean(),
      })
      .superRefine((rule, context) => {
        const error = highlightRuleError(rule)
        if (error) context.addIssue({ code: 'custom', message: error })
      }),
  )
  .max(30)
  .superRefine((rules, context) => {
    if (new Set(rules.map((rule) => rule.id)).size !== rules.length)
      context.addIssue({ code: 'custom', message: 'Повторяющийся идентификатор правила.' })
  })
const id = z.uuid()
export const fileDragSchema = z
  .object({
    sessionId: id,
    path: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !value.includes('\0')),
    size: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    modifiedAt: z.number().finite().min(0),
  })
  .strict()
const base = {
  highlightRules: highlightRulesSchema.optional(),
  monitoringItems: z
    .array(z.enum(MONITOR_ITEMS))
    .max(MONITOR_ITEMS.length)
    .refine((items) => new Set(items).size === items.length)
    .optional(),
  tags: z
    .array(z.string().trim().max(40))
    .max(30)
    .default([])
    .transform((values) => [
      ...new Set(
        values
          .map((value) => value.replace(/^#+/, '').trim().replace(/\s+/g, '-').toLocaleLowerCase())
          .filter(Boolean),
      ),
    ]),
  id,
  name: z.string().trim().min(1).max(100),
  group: z.string().max(100).default(''),
  favorite: z.boolean().default(false),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
}
const host = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine((value) => !/[\s\x00]/.test(value))
const port = z.number().int().min(1).max(65535)
export const hostSchema = z.discriminatedUnion('protocol', [
  z.object({
    ...base,
    protocol: z.literal('ssh'),
    host,
    port: port.default(22),
    username: z.string().min(1).max(100),
    auth: z.enum(['password', 'key']),
    identityId: id.optional(),
    agentEndpoint: z.string().max(4096).optional(),
    agentFingerprint: z.string().max(256).optional(),
    keyPath: z.string().max(4096).optional(),
    secretRef: id.optional(),
    monitoringEnabled: z.boolean().default(true),
    x11Forwarding: z.boolean().default(false),
  }),
  z.object({
    ...base,
    protocol: z.literal('sftp'),
    host,
    port: port.default(22),
    username: z.string().min(1).max(100),
    auth: z.enum(['password', 'key']),
    identityId: id.optional(),
    agentEndpoint: z.string().max(4096).optional(),
    agentFingerprint: z.string().max(256).optional(),
    keyPath: z.string().max(4096).optional(),
    secretRef: id.optional(),
  }),
  z.object({
    ...base,
    protocol: z.literal('ftp'),
    host,
    port: port.default(21),
    username: z.string().min(1).max(100),
    security: z.enum(['none', 'explicit-tls', 'implicit-tls']).default('explicit-tls'),
    secretRef: id.optional(),
  }),
  z.object({
    ...base,
    protocol: z.literal('telnet'),
    host,
    port: port.default(23),
    encoding: z.enum(['utf8', 'windows-1251', 'cp866']).default('utf8'),
  }),
  z.object({ ...base, protocol: z.literal('wsl'), distribution: z.string().min(1).max(200) }),
])
export const shortcutBindingsSchema = z
  .partialRecord(z.enum(SHORTCUT_IDS), z.string().max(80))
  .superRefine((value, context) => {
    const message = shortcutBindingsError(value)
    if (message) context.addIssue({ code: 'custom', message })
  })
export const terminalMacroSchema = z.object({
  id: z.string().min(1).max(100),
  name: z
    .string()
    .trim()
    .min(1, 'Укажите имя макроса.')
    .max(40)
    .regex(/^[\p{L}\p{N}_-]+$/u, 'Имя: буквы, цифры, дефис или подчёркивание.'),
  command: z
    .string()
    .min(1, 'Укажите команду макроса.')
    .max(4096)
    .refine(
      (value) => value.trim().length > 0 && !/[\x00-\x1f\x7f]/.test(value),
      'Команда должна занимать одну строку.',
    ),
  description: z.string().max(200).default(''),
  category: z.string().trim().max(60).optional(),
  hostIds: z.array(z.string().min(1).max(100)).max(1000).optional(),
})
export const terminalMacrosSchema = z
  .array(terminalMacroSchema)
  .max(100)
  .superRefine((items, context) => {
    if (new Set(items.map((item) => item.name.toLocaleLowerCase())).size !== items.length)
      context.addIssue({ code: 'custom', message: 'Имена макросов должны быть уникальными.' })
    if (new Set(items.map((item) => item.id)).size !== items.length)
      context.addIssue({ code: 'custom', message: 'Повторяющийся идентификатор макроса.' })
  })
export const settingsSchema = z.object({
  x11Autostart: z.boolean().default(true),
  x11Clipboard: z.boolean().default(true),
  followTerminalDirectory: z.boolean().default(true),
  lastUsername: z.string().trim().min(1).max(100).optional(),
  highlightRules: highlightRulesSchema.default(DEFAULT_HIGHLIGHT_RULES),
  downloadDirectory: z.string().max(4096).optional(),
  askDownloadDirectory: z.boolean().optional(),
  macros: terminalMacrosSchema.default([]),
  dismissedUpdateVersion: z.string().max(100).optional(),
  updateChannelPolicy: z.literal(1).optional(),
  monitoringOrder: z
    .array(z.enum(MONITOR_ITEMS))
    .max(MONITOR_ITEMS.length)
    .refine((items) => new Set(items).size === items.length)
    .optional(),
  monitoringItems: z
    .array(z.enum(MONITOR_ITEMS))
    .max(MONITOR_ITEMS.length)
    .refine((items) => new Set(items).size === items.length)
    .default(DEFAULT_MONITOR_ITEMS),
  connectionsCollapsed: z.boolean().default(false),
  collapsedHostGroups: z.array(z.string().max(220)).max(1000).default([]),
  hostGroupOrder: z.array(z.string().max(100)).max(1000).default([]),
  monitoringPlacement: z.enum(['sidebar', 'under-terminal']).default('sidebar'),
  updateChannel: z.enum(['stable', 'prerelease']).default('stable'),
  shortcutBindings: shortcutBindingsSchema.optional(),
  themeId: z
    .enum([
      'catppuccin-mocha',
      'catppuccin-macchiato',
      'catppuccin-frappe',
      'catppuccin-latte',
      'vscode-dark-modern',
      'vscode-light-modern',
      'tokyo-night',
      'one-dark',
    ])
    .default('catppuccin-mocha'),
  terminalFont: z.string().min(1).max(200).default('Cascadia Code, Consolas, monospace'),
  terminalFontSize: z.number().int().min(10).max(32).default(14),
  sidebarWidth: z.number().min(200).max(500).default(260),
  monitoringIntervalSeconds: z.number().int().min(1).max(60).default(3),
  monitorWidth: z.number().min(220).max(450).default(280),
  sftpWidth: z.number().min(280).max(900).default(380),
  sftpHeight: z.number().min(180).max(600).default(300),
  windowBounds: z
    .object({ width: z.number().min(900).max(8000), height: z.number().min(600).max(8000) })
    .default({ width: 1440, height: 900 }),
  sftpMode: z.enum(['two-panel', 'remote-only']).default('remote-only'),
  mouseAction: z
    .enum(['select-copy-right-paste', 'context-menu', 'manual'])
    .default('select-copy-right-paste'),
  localShell: z.enum(['powershell', 'cmd']).default('powershell'),
  smoothInput: z.boolean().default(false),
})
// Zod 4 applies defaults even inside partial() fields. IPC patches must contain
// only supplied values, otherwise unrelated updates overwrite saved preferences.
export const settingsPatchSchema = z.object({
  x11Autostart: settingsSchema.shape.x11Autostart.removeDefault().optional(),
  x11Clipboard: settingsSchema.shape.x11Clipboard.removeDefault().optional(),
  followTerminalDirectory: settingsSchema.shape.followTerminalDirectory.removeDefault().optional(),
  lastUsername: settingsSchema.shape.lastUsername,
  highlightRules: settingsSchema.shape.highlightRules.removeDefault().optional(),
  downloadDirectory: settingsSchema.shape.downloadDirectory,
  askDownloadDirectory: settingsSchema.shape.askDownloadDirectory,
  macros: settingsSchema.shape.macros.removeDefault().optional(),
  dismissedUpdateVersion: settingsSchema.shape.dismissedUpdateVersion,
  updateChannelPolicy: settingsSchema.shape.updateChannelPolicy,
  monitoringOrder: settingsSchema.shape.monitoringOrder,
  monitoringItems: settingsSchema.shape.monitoringItems.removeDefault().optional(),
  connectionsCollapsed: settingsSchema.shape.connectionsCollapsed.removeDefault().optional(),
  collapsedHostGroups: settingsSchema.shape.collapsedHostGroups.removeDefault().optional(),
  hostGroupOrder: settingsSchema.shape.hostGroupOrder.removeDefault().optional(),
  monitoringPlacement: settingsSchema.shape.monitoringPlacement.removeDefault().optional(),
  updateChannel: settingsSchema.shape.updateChannel.removeDefault().optional(),
  shortcutBindings: settingsSchema.shape.shortcutBindings,
  themeId: settingsSchema.shape.themeId.removeDefault().optional(),
  terminalFont: settingsSchema.shape.terminalFont.removeDefault().optional(),
  terminalFontSize: settingsSchema.shape.terminalFontSize.removeDefault().optional(),
  sidebarWidth: settingsSchema.shape.sidebarWidth.removeDefault().optional(),
  monitoringIntervalSeconds: settingsSchema.shape.monitoringIntervalSeconds
    .removeDefault()
    .optional(),
  monitorWidth: settingsSchema.shape.monitorWidth.removeDefault().optional(),
  sftpWidth: settingsSchema.shape.sftpWidth.removeDefault().optional(),
  sftpHeight: settingsSchema.shape.sftpHeight.removeDefault().optional(),
  windowBounds: settingsSchema.shape.windowBounds.removeDefault().optional(),
  sftpMode: settingsSchema.shape.sftpMode.removeDefault().optional(),
  mouseAction: settingsSchema.shape.mouseAction.removeDefault().optional(),
  localShell: settingsSchema.shape.localShell.removeDefault().optional(),
  smoothInput: settingsSchema.shape.smoothInput.removeDefault().optional(),
})
export const sshIdentitySchema = z.object({
  id,
  name: z.string().trim().min(1).max(150),
  username: z.string().trim().min(1).max(100).optional(),
  method: z.enum(['password', 'key', 'agent']),
  secretRef: z.string().max(200).optional(),
  keyPath: z.string().max(4096).optional(),
  agentEndpoint: z.string().max(4096).optional(),
  agentFingerprint: z.string().max(256).optional(),
})
export const requestSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('app.openUrl'),
    url: z
      .url()
      .max(4096)
      .refine((value) => /^https?:\/\//i.test(value)),
  }),
  z.object({ action: z.literal('x11.status') }),
  z.object({ action: z.literal('x11.start') }),
  z.object({ action: z.literal('x11.stop') }),
  z.object({ action: z.literal('updates.status') }),
  z.object({ action: z.literal('updates.check') }),
  z.object({ action: z.literal('updates.download') }),
  z.object({ action: z.literal('updates.install') }),
  z.object({ action: z.literal('monitoring.setVisible'), sessionId: id, visible: z.boolean() }),
  z.object({ action: z.literal('monitoring.retry'), sessionId: id }),
  z.object({ action: z.literal('files.transfers') }),
  z.object({ action: z.literal('files.cancel'), id }),
  z.object({
    action: z.literal('files.retry'),
    id,
    overwrite: z.boolean().default(false),
    targetVersion: z
      .object({ size: z.number().nonnegative(), modifiedAt: z.number().nonnegative() })
      .optional(),
  }),
  z.object({
    action: z.literal('files.enqueue'),
    batchId: id.optional(),
    sessionId: id,
    direction: z.enum(['upload', 'download']),
    source: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !value.includes('\u0000')),
    target: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !value.includes('\u0000')),
    overwrite: z.boolean().default(false),
    targetVersion: z
      .object({ size: z.number().nonnegative(), modifiedAt: z.number().nonnegative() })
      .optional(),
  }),
  z.object({ action: z.literal('files.localRoot') }),
  z.object({ action: z.literal('files.downloadDestination'), choose: z.boolean().optional() }),
  z.object({ action: z.literal('files.showLocal'), path: z.string().min(1).max(4096) }),
  z.object({ action: z.literal('files.chooseLocal') }),
  z.object({ action: z.literal('files.chooseUpload') }),
  z.object({
    action: z.literal('files.enqueueDropped'),
    paths: z
      .array(
        z
          .string()
          .min(1)
          .max(4096)
          .refine((value) => !value.includes('\u0000')),
      )
      .min(1)
      .max(100),
    sessionId: id,
    targetDirectory: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !value.includes('\u0000')),
  }),
  z.object({
    action: z.literal('files.stageDrag'),
    sessionId: id,
    path: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !value.includes('\u0000')),
  }),
  z.object({ action: z.literal('files.clearCompleted'), sessionId: id }),
  z.object({
    action: z.literal('files.openRemote'),
    mode: z.enum(['default', 'choose', 'text']).optional(),
    sessionId: id,
    path: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !value.includes('\u0000')),
  }),
  z.object({
    action: z.literal('files.openBrowserLocal'),
    mode: z.enum(['default', 'choose', 'text']).optional(),
    path: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !value.includes('\u0000')),
  }),
  z.object({
    action: z.literal('files.openLocal'),
    path: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !value.includes('\u0000')),
  }),
  z.object({
    action: z.literal('files.list'),
    side: z.enum(['local', 'remote']),
    path: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !value.includes('\u0000')),
    sessionId: id.optional(),
  }),
  z.object({
    action: z.literal('files.move'),
    side: z.enum(['local', 'remote']),
    sessionId: id.optional(),
    path: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !value.includes('\u0000')),
    destination: z
      .string()
      .min(1)
      .max(4096)
      .refine((value) => !value.includes('\u0000')),
  }),
  z
    .object({
      action: z.literal('files.mutate'),
      side: z.enum(['local', 'remote']),
      path: z
        .string()
        .min(1)
        .max(4096)
        .refine((value) => !value.includes('\u0000')),
      sessionId: id.optional(),
      operation: z.enum(['mkdir', 'rename', 'remove', 'chmod', 'chown']),
      name: z.string().max(255).optional(),
      fileType: z.enum(['file', 'empty-directory']).optional(),
      permissions: z.number().int().min(0).max(0o7777).optional(),
      owner: z
        .string()
        .max(128)
        .regex(/^(?:[A-Za-z_][A-Za-z0-9_.-]*|[0-9]+)$/)
        .optional(),
      group: z
        .string()
        .max(128)
        .regex(/^(?:[A-Za-z_][A-Za-z0-9_.-]*|[0-9]+)$/)
        .optional(),
    })
    .refine((request) => request.operation !== 'chmod' || request.permissions !== undefined)
    .refine((request) => request.operation !== 'chown' || (!!request.owner && !!request.group)),
  z.object({
    action: z.literal('sessions.answer'),
    challengeId: id,
    answer: z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('auth'),
        password: z.string().max(16384).optional(),
        passphrase: z.string().max(16384).optional(),
        remember: z.boolean(),
      }),
      z.object({ kind: z.literal('trust'), accept: z.boolean(), replaceExisting: z.boolean() }),
    ]),
  }),
  z.object({ action: z.literal('wsl.list') }),
  z.object({ action: z.literal('logs.settings') }),
  z.object({
    action: z.literal('logs.configure'),
    patch: z.object({
      folder: z
        .string()
        .min(1)
        .max(4096)
        .refine((v) => !v.includes('\u0000'))
        .optional(),
      auto: z.boolean().optional(),
      hostIds: z.array(id).max(10000).optional(),
      retentionDays: z.number().int().min(1).max(3650).optional(),
      maxSizeMb: z.number().int().min(1).max(1024).optional(),
    }),
  }),
  z.object({ action: z.literal('logs.chooseFolder') }),
  z.object({ action: z.literal('logs.list') }),
  z.object({ action: z.literal('logs.start'), sessionId: id }),
  z.object({ action: z.literal('logs.stop'), sessionId: id }),
  z.object({ action: z.literal('logs.read'), id }),
  z.object({ action: z.literal('logs.bookmark'), id, bookmarked: z.boolean() }),
  z.object({ action: z.literal('logs.export'), id }),
  z.object({ action: z.literal('wsl.inventory') }),
  z.object({
    action: z.literal('sessions.openTemporary'),
    profile: hostSchema,
    secret: z.string().max(16384).optional(),
  }),
  z.object({ action: z.literal('hosts.list') }),
  z.object({ action: z.literal('identities.list') }),
  z.object({
    action: z.literal('identities.save'),
    identity: sshIdentitySchema,
    secret: z.string().max(65536).optional(),
  }),
  z.object({
    action: z.literal('identities.remove'),
    id,
    replacementId: id.optional(),
    detach: z.boolean().optional(),
    confirmMerge: z.boolean().optional(),
  }),
  z.object({ action: z.literal('identity.chooseKey') }),
  z.object({ action: z.literal('ssh.discoverIdentities') }),
  z.object({ action: z.literal('hosts.save'), profile: hostSchema }),
  z.object({ action: z.literal('hosts.remove'), id }),
  z.object({ action: z.literal('hosts.setSecret'), id, value: z.string().min(1).max(16384) }),
  z.object({ action: z.literal('settings.get') }),
  z.object({ action: z.literal('settings.update'), patch: settingsPatchSchema }),
  z.object({ action: z.literal('data.export'), passphrase: z.string().min(8).max(1024) }),
  z.object({ action: z.literal('data.previewImport'), passphrase: z.string().min(8).max(1024) }),
  z.object({
    action: z.literal('data.commitImport'),
    token: id,
    strategy: z.enum(['merge', 'replace']),
  }),
  z.object({ action: z.literal('sessions.open'), profileId: id }),
  z.object({ action: z.literal('sessions.openLocal'), shell: z.enum(['powershell', 'cmd']) }),
  z.object({ action: z.literal('sessions.close'), id }),
  z.object({ action: z.literal('sessions.write'), id, data: z.string().max(1048576) }),
  z.object({
    action: z.literal('sessions.resize'),
    id,
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
  }),
  z.object({ action: z.literal('sessions.ack'), id, sequence: z.number().int().min(1) }),
])
export type Request = z.infer<typeof requestSchema>
