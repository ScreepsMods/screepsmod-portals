import esbuild from 'rollup-plugin-esbuild';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';

export default {
	input: 'src/index.ts',
	output: {
		file: 'dist/index.js',
		format: 'cjs',
		exports: 'auto',
	},
	external: ['lodash'],
	plugins: [
		resolve(),
		commonjs(),
		esbuild({
			target: 'node10',
		}),
	],
};
