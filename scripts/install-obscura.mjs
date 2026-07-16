#!/usr/bin/env node
/**
 * Download Obscura binary (headless browser engine used by Playwright over CDP).
 * https://github.com/h4ckf0r0day/obscura
 *
 * Usage: node scripts/install-obscura.mjs
 * Binary: .obscura/obscura
 */
import { createWriteStream, existsSync, mkdirSync, chmodSync } from 'node:fs'
import { pipeline } from 'node:stream/promises'
import { execFileSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, '.obscura')
const bin = join(outDir, 'obscura')

const { platform, arch } = process
const asset =
  platform === 'linux' && arch === 'x64'
    ? 'obscura-x86_64-linux.tar.gz'
    : platform === 'linux' && arch === 'arm64'
      ? 'obscura-aarch64-linux.tar.gz'
      : platform === 'darwin' && arch === 'arm64'
        ? 'obscura-aarch64-macos.tar.gz'
        : platform === 'darwin' && arch === 'x64'
          ? 'obscura-x86_64-macos.tar.gz'
          : null

if (!asset) {
  console.error(`Unsupported platform: ${platform}/${arch}`)
  process.exit(1)
}

if (existsSync(bin) && !process.env.OBSCURA_FORCE_INSTALL) {
  console.log(`Obscura already installed: ${bin}`)
  process.exit(0)
}

mkdirSync(outDir, { recursive: true })
const url = `https://github.com/h4ckf0r0day/obscura/releases/latest/download/${asset}`
const archive = join(outDir, asset)

console.log(`Downloading ${url}`)
const res = await fetch(url)
if (!res.ok) {
  console.error(`Download failed: ${res.status} ${res.statusText}`)
  process.exit(1)
}
await pipeline(Readable.fromWeb(res.body), createWriteStream(archive))

console.log('Extracting…')
execFileSync('tar', ['xzf', archive, '-C', outDir], { stdio: 'inherit' })
chmodSync(bin, 0o755)
console.log(`Installed ${bin}`)
