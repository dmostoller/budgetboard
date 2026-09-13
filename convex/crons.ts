import { cronJobs } from 'convex/server'
import { internal } from './_generated/api'

const crons = cronJobs()

/**
 * Materialize the next occurrence of every live recurring series.
 *
 * Runs shortly after midnight UTC. Completing a bill also rolls its series
 * immediately, so this job exists for the other case: an occurrence whose
 * date simply passed without anyone touching it. Next month's rent should
 * appear whether or not this month's got marked paid.
 */
crons.daily('roll recurring series', { hourUTC: 5, minuteUTC: 0 }, internal.cards.rollAllSeries, {})

/**
 * Move upcoming expenses into Due once their date arrives. The board also
 * promotes a user's own cards the moment it loads, so this exists only for
 * boards nobody has open when the due date rolls around.
 */
crons.interval('promote due cards', { hours: 1 }, internal.cards.promoteAllDueCards, {})

/**
 * Weekly briefing from the assistant — one observation about the week ahead,
 * for users who have not turned it off.
 */
crons.weekly(
  'weekly budget briefing',
  { dayOfWeek: 'sunday', hourUTC: 14, minuteUTC: 0 },
  internal.insights.generateForAllUsers,
  {},
)

export default crons
