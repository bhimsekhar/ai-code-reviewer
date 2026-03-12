const esbuild = require('esbuild')

const watch = process.argv.includes('--watch')

const buildOptions = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  platform: 'node',
  format: 'cjs',
  minify: false,
  sourcemap: true,
  target: 'node16',
  logLevel: 'info'
}

if (watch) {
  esbuild
    .context(buildOptions)
    .then(ctx => ctx.watch())
    .catch(err => {
      console.error(err)
      process.exit(1)
    })
} else {
  esbuild
    .build(buildOptions)
    .catch(err => {
      console.error(err)
      process.exit(1)
    })
}
