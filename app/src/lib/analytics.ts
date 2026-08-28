import type { PostHog } from 'posthog-js'

/**
 * Where product analytics go.
 *
 * The project API key is public by design. PostHog's ingest endpoint only ever
 * accepts events *into* the one project the key names and cannot read anything
 * back out, which is why it sits here in plain sight rather than in an env var,
 * on the same reasoning as the feedback key in FeedbackDialog: Vite inlines env
 * vars into the bundle anyway, so hiding it would be theatre with an extra
 * deploy step attached.
 *
 * Find it under Settings > Project > Project API key (it starts with `phc_`).
 * Left empty, every function below is a no-op, so a clone with no project of
 * its own still builds and runs with nothing phoning home.
 */
const KEY = 'phc_wo7tWWhhzQEvGa3aQqVmdSUEMiiPpCwR2Qfbqa2AoQyi'

/** `https://eu.i.posthog.com` if the project was created in the EU region. */
const HOST = 'https://us.i.posthog.com'

/**
 * Every event this app raises.
 *
 * A closed set on purpose. Analytics rot the moment two call sites disagree
 * about whether it is `export_done` or `export_complete`, and by the time that
 * shows up in a chart the old rows are already unmergeable.
 */
export type AnalyticsEvent =
  | 'mode_changed'
  | 'project_created'
  | 'media_imported'
  | 'device_added'
  | 'template_applied'
  | 'animation_preset_applied'
  | 'studio_look_applied'
  | 'export_started'
  | 'export_completed'
  | 'export_failed'
  | 'feedback_sent'
  | 'theme_changed'

type Props = Record<string, string | number | boolean | null | undefined>

let ph: PostHog | null = null
let started = false

/*
 * Events raised before the SDK has finished loading.
 *
 * The import is dynamic so posthog-js stays out of the entry chunk, because a
 * 3D editor that already ships three.js should not spend first-paint budget on
 * telemetry. The cost of that is a window on every cold load where there is
 * nothing to call, and the events most worth having (the first mode switch, the
 * first import) are precisely the ones that land in it, so they wait here
 * instead of being dropped. Capped because an SDK that never arrives must leak
 * nothing.
 */
const pending: { event: AnalyticsEvent; props?: Props }[] = []
const MAX_PENDING = 50

/** Analytics are for shipped builds, and never at the cost of the app running. */
const enabled = () => !!KEY && import.meta.env.PROD

/**
 * Load posthog-js and start a session. Safe to call more than once.
 */
export function initAnalytics() {
  /*
   * Dev is deliberately silent. The free plan is one project per organization,
   * so there is no separate bucket to put development noise in, and rows from
   * whoever is editing the app would be indistinguishable from real use. To
   * watch events actually arrive, build and serve: `npm run build && npm run
   * preview`.
   */
  if (!enabled() || started) return
  started = true

  void import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(KEY, {
        api_host: HOST,
        /*
         * Autocapture off. It records a click on every element in the page,
         * and this is a dense editor: one session is thousands of toolbar,
         * swatch and slider clicks arriving as anonymous `$autocapture` rows
         * that no chart can be read out of. The named events above are the
         * questions actually worth asking.
         */
        autocapture: false,
        /*
         * Replay on, because it was picked at onboarding and this project has
         * its own free tier to spend.
         *
         * One thing to know before reading a recording: the viewport is a
         * canvas, and rrweb does not record canvas pixels unless asked to, so
         * the 3D stage and both 2D boards replay as empty rectangles while
         * every panel, dialog and toolbar around them replays normally. That
         * is the privacy-preserving default and worth keeping: whatever
         * someone drags into a mockup tool is their own screenshot, and it has
         * no business being uploaded a second time as a recording.
         */
        disable_session_recording: false,
        /*
         * Nobody signs in here, so every visitor is anonymous. `identified_only`
         * is what keeps that from minting a person profile per visitor and
         * spending the profile quota on rows that will never be looked up.
         */
        person_profiles: 'identified_only',
      })
      ph = posthog
      for (const p of pending) posthog.capture(p.event, p.props)
      pending.length = 0
    })
    .catch(() => {
      // A blocked or failed SDK is not an app error. Drop what queued up so a
      // long session does not sit on events that now have nowhere to go.
      pending.length = 0
    })
}

/**
 * Record one product event.
 *
 * Never pass anything the user wrote or opened: no note bodies, no file names,
 * no project titles. Ids, formats, counts and sizes only.
 */
export function track(event: AnalyticsEvent, props?: Props) {
  // Hidden behind the console's Verbose level, so instrumentation is checkable
  // while you work on it without adding noise to an ordinary dev session.
  if (import.meta.env.DEV) console.debug('[analytics]', event, props ?? {})
  if (!enabled()) return
  if (ph) ph.capture(event, props)
  else if (pending.length < MAX_PENDING) pending.push({ event, props })
}
