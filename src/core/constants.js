/**
 * 包格式 v2 的跨模块常量。对应 docs/SPEC.md §8。
 * 只放稳定常量，不放可配置项（可配置项属于 Config / 高级选项）。
 */

/** 迁移包格式版本（manifest.schemaVersion）。 */
export const SCHEMA_VERSION = 2

/** 迁移包扩展名。 */
export const PACK_EXTENSION = '.dshpack'

/** 包内固定文件名。 */
export const MANIFEST_NAME = 'manifest.json'
export const README_NAME = 'README.txt'

/** 包内目录名。 */
export const SESSIONS_DIR = 'sessions'
export const ATTACHMENTS_DIR = 'attachments'
export const WORKSPACES_DIR = 'workspaces'

/** 导出阶段（进度协议与 UI 共用）。 */
export const EXPORT_STAGES = Object.freeze([
  'scan',
  'preflight',
  'pack-sessions',
  'pack-workspaces',
  'verify',
  'done',
])

/** 导入阶段（进度协议与 UI 共用）。 */
export const IMPORT_STAGES = Object.freeze([
  'verify',
  'preflight',
  'restore-sessions',
  'restore-attachments',
  'restore-workspaces',
  'register',
  'done',
])
