import { Monitor } from 'lucide-react'
import { Mascot } from './Mascot'

/*
 * The phone door.
 *
 * Ribbit is a two-panels-and-a-timeline tool driven by a pointer. There is no
 * honest way to fold that onto a 390px screen, and a squashed version would
 * just be a worse first impression than a straight answer. So below the tablet
 * breakpoint the editor never mounts at all and this stands in its place.
 *
 * Mounting matters: gating with `hidden lg:flex` would still boot the store,
 * hydrate IndexedDB and spin up the WebGL viewport behind the note, which is a
 * lot of phone battery spent rendering something nobody can see.
 *
 * Same reasoning governs the frog: it is the still SVG until someone presses
 * it, and only then does the Rive runtime get fetched. Nobody pays for an
 * animation on the way out the door.
 */

export function SmallScreen() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-5 bg-(--panel2) px-8 text-center text-(--tx)">
      <Mascot size={72} awaken="contact" />

      <div>
        <h1 className="t-headline text-(--tx)">Ribbit</h1>
        <p className="mt-1.5 t-body text-(--tx3)">A personal toolkit for visual work</p>
      </div>

      <p className="max-w-sm t-body text-(--tx2)">
        It's built for a wide screen and a pointer. Panels either side of the canvas, a
        timeline underneath. That doesn't fold down to a phone honestly, so it doesn't
        pretend to.
      </p>

      <div className="flex items-center gap-2 rounded-full border border-(--line) bg-(--raised) px-4 py-2 t-body-sm text-(--tx2)">
        <Monitor size={15} strokeWidth={1.8} />
        Open it on a laptop or desktop
      </div>
    </div>
  )
}
