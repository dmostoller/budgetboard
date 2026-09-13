import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import type { Card } from '#/lib/board'

/** The board's two destructive confirmations: deleting one card, and
 * archiving every completed card at once. Both are undoable, so the copy
 * says so rather than reading like a point of no return. */
export default function BoardDialogs({
  cardToDelete,
  onCancelDelete,
  onConfirmDelete,
  completedCount,
  archiveConfirmOpen,
  onArchiveConfirmOpenChange,
  onConfirmArchive,
}: {
  cardToDelete: Card | null
  onCancelDelete: () => void
  onConfirmDelete: () => void
  completedCount: number
  archiveConfirmOpen: boolean
  onArchiveConfirmOpenChange: (open: boolean) => void
  onConfirmArchive: () => void
}) {
  return (
    <>
      <AlertDialog
        open={cardToDelete !== null}
        onOpenChange={(open) => {
          if (!open) onCancelDelete()
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete card</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{cardToDelete?.description}"? You'll have a moment to undo it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onConfirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={archiveConfirmOpen} onOpenChange={onArchiveConfirmOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive completed cards</AlertDialogTitle>
            <AlertDialogDescription>
              Archive {completedCount} completed card{completedCount === 1 ? '' : 's'}? You'll have
              a moment to undo it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirmArchive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
