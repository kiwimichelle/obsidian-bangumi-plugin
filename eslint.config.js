import esbuild from 'esbuild';
import { readFileSync, writeFileSync } from 'fs';
import postcss from 'postcss';
import atImport from 'postcss-import';

// 构建 CSS 的异步函数
async function buildCss() {
  const inputCss = readFileSync('styles/index.css', 'utf8');
  const result = await postcss([atImport()]).process(inputCss, {
    from: 'styles/index.css',
    to: 'styles.css',
  });
  writeFileSync('styles.css', result.css);
  console.log('✅ CSS built: styles.css');
}

// 主构建
async function main() {
  // 1. 构建 TypeScript → main.js
  const context = await esbuild.context({
    entryPoints: ['src/main.ts'],
    bundle: true,
    outfile: 'main.js',
    platform: 'node',
    external: ['obsidian'],
    sourcemap: 'linked',
    target: 'es2020',
    logLevel: 'info',
  });

  // 2. 构建 CSS
  await buildCss();

  // 3. 监听模式（开发时使用）
  if (process.argv.includes('--watch')) {
    await context.watch();
    console.log('👀 Watching for changes...');
  } else {
    await context.rebuild();
    await context.dispose();
    console.log('✅ Build complete');
  }
}

main().catch(err => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});