/**
 * The keyframe mark: a rhombus with its corners taken off, not a dot.
 *
 * It appears twice (as the diamond beside an animatable property in the
 * inspector, and as a key on a timeline lane) and the two are the same object,
 * so they share one class string. They drifted apart once already: a sweep over
 * the radius tokens rounded the timeline's copy into a circle while leaving the
 * inspector's with sharp corners, and neither spot named the other.
 *
 * The radius is literal rather than a token on purpose. Linear's scale starts
 * at 4px, which is sized for panels and buttons; on a 9px square it rounds every
 * corner away and the rhombus reads as a dot.
 */
const MARK = 'block rotate-45 transition-colors'

export const KF_MARK = `${MARK} h-[9px] w-[9px] rounded-[2px]`

/**
 * The same mark, sized for a timeline lane.
 *
 * One shape, two jobs. Beside a property it is an indicator you click once, and
 * 9px is right next to a line of text. On a lane it is a thing you grab, drag,
 * shift-click and sweep a marquee over, often with its neighbour a few pixels
 * away, and at 9px that was a game of darts. The radius grows with it so the
 * corners stay the same fraction of the rhombus and it does not round off into
 * a dot at either size.
 *
 * It stops at 11 because a rhombus is as tall as its diagonal: turned 45°, an
 * 11px square already stands 15.6px high, which is as much as an 18px lane can
 * hold without the mark overhanging the bar it is pinned to.
 */
export const KF_MARK_LANE = `${MARK} h-[11px] w-[11px] rounded-[2.5px]`
