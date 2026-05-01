import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'
import { bundleDistHtml } from './inline-dist-html.mjs'

async function withFixture(files, run) {
  const dir = await mkdtemp(join(tmpdir(), 'inline-dist-html-'))

  try {
    for (const [path, contents] of Object.entries(files)) {
      const filePath = join(dir, path)
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, contents)
    }

    return await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

describe('bundleDistHtml', () => {
  test('inlines built CSS and module scripts into one HTML file', async () => {
    await withFixture(
      {
        'index.html': [
          '<!doctype html>',
          '<html>',
          '<head>',
          '  <link rel="modulepreload" crossorigin href="./assets/vendor.js">',
          '  <link rel="stylesheet" crossorigin href="./assets/index.css">',
          '</head>',
          '<body>',
          '  <div id="root"></div>',
          '  <script type="module" crossorigin src="./assets/index.js"></script>',
          '</body>',
          '</html>',
        ].join('\n'),
        'assets/index.css': 'body { color: red; }',
        'assets/index.js': 'console.log("app");',
      },
      async (dir) => {
        const outputFile = join(dir, 'release.html')

        await bundleDistHtml({ distDir: dir, outputFile })

        const html = await readFile(outputFile, 'utf8')
        expect(html).toContain('<style>\nbody { color: red; }\n</style>')
        expect(html).toContain('<script type="module">\nconsole.log("app");\n</script>')
        expect(html).not.toContain('href="./assets/index.css"')
        expect(html).not.toContain('src="./assets/index.js"')
        expect(html).not.toContain('rel="modulepreload"')
      },
    )
  })

  test('preserves dollar replacement tokens in inlined assets', async () => {
    await withFixture(
      {
        'index.html': [
          '<!doctype html>',
          '<html>',
          '<head>',
          '  <link rel="stylesheet" href="./assets/index.css">',
          '</head>',
          '<body>',
          '  <script type="module" src="./assets/index.js"></script>',
          '</body>',
          '</html>',
        ].join('\n'),
        'assets/index.css': '.price::after { content: "$&"; }',
        'assets/index.js': 'const replacement = "$&/";',
      },
      async (dir) => {
        const outputFile = join(dir, 'release.html')

        await bundleDistHtml({ distDir: dir, outputFile })

        const html = await readFile(outputFile, 'utf8')
        expect(html).toContain('.price::after { content: "$&"; }')
        expect(html).toContain('const replacement = "$&/";')
        expect(html).not.toContain('const replacement = "<script')
      },
    )
  })

  test('fails when built HTML references non-local CSS or JS assets', async () => {
    await withFixture(
      {
        'index.html': [
          '<!doctype html>',
          '<html>',
          '<head>',
          '  <link rel="stylesheet" href="https://cdn.example.com/app.css">',
          '</head>',
          '<body>',
          '  <script type="module" src="./assets/index.js"></script>',
          '</body>',
          '</html>',
        ].join('\n'),
        'assets/index.js': 'console.log("app");',
      },
      async (dir) => {
        await expect(bundleDistHtml({ distDir: dir, outputFile: join(dir, 'release.html') })).rejects.toThrow(
          'Cannot inline non-local asset URL',
        )
      },
    )
  })

  test('removes manifest links and embeds local icon links as data URLs', async () => {
    await withFixture(
      {
        'index.html': [
          '<!doctype html>',
          '<html>',
          '<head>',
          '  <link rel="manifest" href="./manifest.webmanifest">',
          '  <link rel="icon" href="./pwa-icon.svg" type="image/svg+xml">',
          '  <link rel="apple-touch-icon" href="./pwa-icon.svg">',
          '</head>',
          '<body></body>',
          '</html>',
        ].join('\n'),
        'manifest.webmanifest': '{"name":"Example"}',
        'pwa-icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      },
      async (dir) => {
        const outputFile = join(dir, 'release.html')

        await bundleDistHtml({ distDir: dir, outputFile })

        const html = await readFile(outputFile, 'utf8')
        expect(html).not.toContain('rel="manifest"')
        expect(html).not.toContain('href="./pwa-icon.svg"')
        expect(html).toContain('href="data:image/svg+xml;base64,')
      },
    )
  })
})
