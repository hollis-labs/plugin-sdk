import { state } from '@example/runtime'
import { label } from '@example/ui/label'
export function render(hostState) {
  if (hostState !== state) throw new Error('Duplicate runtime')
  return label()
}
