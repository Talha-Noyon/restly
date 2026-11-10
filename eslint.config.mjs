import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {ignores: ['dist/**', 'node_modules/**', '*.vsix']},
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {prefer: 'type-imports', fixStyle: 'inline-type-imports'}
      ],
      '@typescript-eslint/no-unused-vars': ['error', {argsIgnorePattern: '^_'}]
    }
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {process: 'readonly', Buffer: 'readonly', URL: 'readonly', console: 'readonly'}
    }
  }
)
