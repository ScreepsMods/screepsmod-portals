import typescript from '@rollup/plugin-typescript'
import commonjs from '@rollup/plugin-commonjs'
import resolve from '@rollup/plugin-node-resolve'

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
		typescript({
			tsconfig: './tsconfig.json',
			target: 'es2018',
		}),
	],
};
