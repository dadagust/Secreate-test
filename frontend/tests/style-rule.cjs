const { ESLint } = require('eslint')
;(async () => {
  const eslint = new ESLint()
  const [result] = await eslint.lintText('export const Demo = () => <div style={{color: "red"}} />', { filePath: 'src/style-check.tsx' })
  if (!result.messages.some(message => message.ruleId === 'no-restricted-syntax')) throw new Error('JSX style was not rejected')
  console.log('ESLint rejects JSX style')
})().catch(error => { console.error(error); process.exitCode = 1 })
