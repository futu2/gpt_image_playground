import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const DEFAULT_DIST_DIR = 'dist'
const DEFAULT_OUTPUT_FILE = 'release/gpt-image-playground.html'

function readAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}=(["'])(.*?)\\1`, 'i'))
  return match?.[2] ?? null
}

function hasRel(tag, value) {
  const rel = readAttribute(tag, 'rel')
  return rel?.split(/\s+/).some((part) => part.toLowerCase() === value) ?? false
}

function isExternalUrl(url) {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')
}

function assetPath(distDir, rawUrl) {
  if (isExternalUrl(rawUrl)) {
    throw new Error(`Cannot inline non-local asset URL: ${rawUrl}`)
  }

  const [pathname] = rawUrl.split(/[?#]/)
  const relativePath = decodeURIComponent(pathname).replace(/^\/+/, '').replace(/^\.\//, '')
  const resolvedDistDir = resolve(distDir)
  const resolvedAssetPath = resolve(resolvedDistDir, relativePath)

  if (resolvedAssetPath !== resolvedDistDir && !resolvedAssetPath.startsWith(`${resolvedDistDir}${sep}`)) {
    throw new Error(`Cannot inline asset outside dist directory: ${rawUrl}`)
  }

  return resolvedAssetPath
}

function escapeStyle(contents) {
  return contents.replaceAll('</style', '<\\/style')
}

function escapeScript(contents) {
  return contents.replaceAll('</script', '<\\/script')
}

function mimeTypeForAsset(filePath) {
  switch (extname(filePath).toLowerCase()) {
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.ico':
      return 'image/x-icon'
    default:
      return 'application/octet-stream'
  }
}

async function inlineStylesheets(html, distDir) {
  const tags = html.match(/<link\b[^>]*>/gi) ?? []
  let nextHtml = html

  for (const tag of tags) {
    if (!hasRel(tag, 'stylesheet')) continue

    const href = readAttribute(tag, 'href')
    if (!href) throw new Error(`Cannot inline stylesheet without href: ${tag}`)

    const css = await readFile(assetPath(distDir, href), 'utf8')
    nextHtml = nextHtml.replace(tag, () => `<style>\n${escapeStyle(css)}\n</style>`)
  }

  return nextHtml
}

async function inlineScripts(html, distDir) {
  const tags = html.match(/<script\b[^>]*\bsrc=(["']).*?\1[^>]*>\s*<\/script>/gis) ?? []
  let nextHtml = html

  for (const tag of tags) {
    const src = readAttribute(tag, 'src')
    if (!src) continue

    const js = await readFile(assetPath(distDir, src), 'utf8')
    nextHtml = nextHtml.replace(tag, () => `<script type="module">\n${escapeScript(js)}\n</script>`)
  }

  return nextHtml
}

function removePreloadHints(html) {
  return html.replace(/^\s*<link\b[^>]*\brel=(["'])modulepreload\1[^>]*>\s*$/gim, '')
}

async function inlineDocumentResourceLinks(html, distDir) {
  const tags = html.match(/<link\b[^>]*>/gi) ?? []
  let nextHtml = html

  for (const tag of tags) {
    if (hasRel(tag, 'manifest')) {
      nextHtml = nextHtml.replace(tag, () => '')
      continue
    }

    if (!hasRel(tag, 'icon') && !hasRel(tag, 'apple-touch-icon')) continue

    const href = readAttribute(tag, 'href')
    if (!href || isExternalUrl(href) || href.startsWith('data:')) continue

    const iconPath = assetPath(distDir, href)
    const icon = await readFile(iconPath)
    const dataUrl = `data:${mimeTypeForAsset(iconPath)};base64,${icon.toString('base64')}`
    nextHtml = nextHtml.replace(tag, () => tag.replace(/\shref=(["']).*?\1/i, ` href="${dataUrl}"`))
  }

  return nextHtml
}

export async function bundleDistHtml({
  distDir = DEFAULT_DIST_DIR,
  outputFile = DEFAULT_OUTPUT_FILE,
} = {}) {
  let html = await readFile(resolve(distDir, 'index.html'), 'utf8')

  html = await inlineStylesheets(html, distDir)
  html = await inlineScripts(html, distDir)
  html = await inlineDocumentResourceLinks(html, distDir)
  html = removePreloadHints(html)

  await mkdir(dirname(outputFile), { recursive: true })
  await writeFile(outputFile, html)
}

function parseArgs(argv) {
  const options = {
    distDir: DEFAULT_DIST_DIR,
    outputFile: DEFAULT_OUTPUT_FILE,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--dist-dir') {
      options.distDir = argv[++index]
    } else if (arg === '--output') {
      options.outputFile = argv[++index]
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return options
}

if (import.meta.url === pathToFileURL(fileURLToPath(import.meta.url)).href && process.argv[1] === fileURLToPath(import.meta.url)) {
  await bundleDistHtml(parseArgs(process.argv.slice(2)))
}
