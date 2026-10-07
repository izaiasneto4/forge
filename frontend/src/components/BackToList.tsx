import { useWorkspace } from '../workspace/context'
import { Icon } from './Icon'

// Only visible in the single-pane layout, where the list is hidden while a PR is open.
export function BackToList() {
  const { mailbox, goToMailbox } = useWorkspace()

  return (
    <button type="button" className="tb-btn back-btn" title="Back to list" aria-label="Back to list" onClick={() => goToMailbox(mailbox)}>
      <Icon name="chevLeft" />
    </button>
  )
}
