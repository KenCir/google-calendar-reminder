import common from 'eslint-config-neon/common';
import node from 'eslint-config-neon/node';
import prettier from 'eslint-config-neon/prettier';
import typescript from 'eslint-config-neon/typescript';

const config = [
	{
		ignores: ['src/gql/**'],
	},
	...common,
	...node,
	...typescript,
	...prettier,
	{
		languageOptions: {
			parserOptions: {
				project: ['./tsconfig.eslint.json'],
			},
		},
		rules: {
			'no-restricted-globals': 0,
			'import/extensions': 0,
		},
	},
];

export default config;
