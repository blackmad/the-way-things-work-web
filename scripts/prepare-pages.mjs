#!/usr/bin/env node
import { copyFile, mkdir, writeFile } from 'node:fs/promises'

await mkdir('dist/classic', { recursive: true })
await copyFile('dist/index.html', 'dist/classic/index.html')
await writeFile('dist/.nojekyll', '')
