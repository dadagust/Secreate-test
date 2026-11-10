import js from '@eslint/js'
import babel from '@babel/eslint-parser'

export default [
  { ignores: ['dist/**'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { parser: babel, parserOptions: { requireConfigFile: false, babelOptions: { plugins: ['@babel/plugin-syntax-jsx', ['@babel/plugin-syntax-typescript', { isTSX: true }]] } }, globals: { document: 'readonly', fetch: 'readonly', Headers: 'readonly', btoa: 'readonly', crypto: 'readonly', window: 'readonly', URLSearchParams: 'readonly', RequestInit: 'readonly', Response: 'readonly' } },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-restricted-syntax': ['error',
        { selector: "JSXAttribute[name.name='style']", message: 'Используйте семантические классы из src/styles.' },
        { selector: "MemberExpression[property.name='style']", message: 'Используйте семантические классы из src/styles.' },
      ],
    },
  },
]
