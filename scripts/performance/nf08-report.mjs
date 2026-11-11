import { writeFile } from 'node:fs/promises'
import { validateNf08Profile } from './nf08-profile-validation.mjs'

export async function writeNf08Report(file, report, maxBusinessRejectionRate = 0.01) {
  report.validity = validateNf08Profile(report, maxBusinessRejectionRate)
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  return report.validity
}
