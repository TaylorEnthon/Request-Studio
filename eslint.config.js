import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['out/**', 'node_modules/**', 'docs/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['src/**/*.{ts,tsx}'], rules: { '@typescript-eslint/no-explicit-any': 'off', '@typescript-eslint/no-empty-object-type': 'off' } },
  { files: ['scripts/**/*.{js,mjs}'], languageOptions: { globals: { process: 'readonly', console: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' } } }
)
