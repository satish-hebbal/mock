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
export const KF_MARK = 'block h-[9px] w-[9px] rotate-45 rounded-[2px] transition-colors'
