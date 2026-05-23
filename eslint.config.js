import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// 获取当前文件的目录路径（常用于配置 tsconfig 根路径）
const __dirname = dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
	{
		// 针对所有文件或特定 TS 文件的语言选项配置
		languageOptions: {
			globals: {
				...globals.browser,
				require: 'readonly',
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir: __dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	// 引入 Obsidian 插件推荐的配置（已移除 TypeScript 类型断言）
	...obsidianmd.configs.recommended,
	{
		// 规则覆盖与自定义配置
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
			'@typescript-eslint/no-unsafe-argument': 'off',
			'@typescript-eslint/no-unnecessary-type-assertion': 'off',
			'@typescript-eslint/no-floating-promises': 'off',
			'@typescript-eslint/no-unused-vars': 'warn',
			'@typescript-eslint/no-require-imports': 'off',
			'@typescript-eslint/no-misused-promises': 'off',
			'no-useless-escape': 'off',
			'no-console': 'off',
			'no-restricted-globals': 'off',
			'no-undef': 'off',
			'import/no-nodejs-modules': 'off',
			'obsidianmd/no-static-styles-assignment': 'off',
			'obsidianmd/no-tfile-tfolder-cast': 'off',
			'obsidianmd/ui/sentence-case': 'off',
			'obsidianmd/settings-tab/no-manual-html-headings': 'off',
			'obsidianmd/commands/no-plugin-name-in-command-name': 'off',
		},
	},
	// 全局忽略路径配置
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
	]),
);