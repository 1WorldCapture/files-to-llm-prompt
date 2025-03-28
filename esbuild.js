const esbuild = require("esbuild");
const { copy } = require('esbuild-plugin-copy');
const fs = require('fs');
const path = require('path');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// 确保目标目录存在
function ensureDirectoryExists(dirPath) {
	if (!fs.existsSync(dirPath)) {
		fs.mkdirSync(dirPath, { recursive: true });
	}
}

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
			// 确保 dist/webview 目录存在
			const webviewDist = path.join(__dirname, 'dist', 'webview');
			ensureDirectoryExists(webviewDist);
		});

		build.onEnd((result) => {
			// 验证构建结果
			if (result.errors.length > 0) {
				result.errors.forEach(({ text, location }) => {
					console.error(`✘ [ERROR] ${text}`);
					console.error(`    ${location.file}:${location.line}:${location.column}:`);
				});
			}
			
			// 验证 webview 文件是否正确复制
			const webviewDist = path.join(__dirname, 'dist', 'webview');
			const webviewSrc = path.join(__dirname, 'src', 'webview');
			
			if (fs.existsSync(webviewDist)) {
				const distFiles = fs.readdirSync(webviewDist);
				const srcFiles = fs.existsSync(webviewSrc) ? fs.readdirSync(webviewSrc) : [];
				
				console.log('[build] Webview files copied successfully:');
				console.log(`  - Source files: ${srcFiles.length}`);
				console.log(`  - Copied files: ${distFiles.length}`);
				
				if (distFiles.length === 0) {
					console.warn('[build] Warning: dist/webview directory is empty');
				}
			} else {
				console.error('[build] Error: dist/webview directory was not created');
			}
			
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	// 确保目标目录存在
	ensureDirectoryExists(path.join(__dirname, 'dist'));
	
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			copy({
				// Copy tiktoken wasm file to dist
				assets: [
					{
						from: './node_modules/tiktoken/tiktoken_bg.wasm',
						to: './tiktoken_bg.wasm',
					},
					// Copy webview files to dist
					{
						from: ['./src/webview/*'],  // 使用通配符匹配所有文件
						to: ['./webview'],     // 指定完整的目标路径
					}
				]
			}),
			esbuildProblemMatcherPlugin,
		],
	});
	if (watch) {
		await ctx.watch();
	} else {
		await ctx.rebuild();
		await ctx.dispose();
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
