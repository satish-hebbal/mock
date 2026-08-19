/**
 * The one place shortcuts are described. `App.tsx` implements them and this
 * catalog documents them, so the guide can never list a key we don't handle
 * (or miss one we do) as long as both sides are edited together.
 */

export type ShortcutScope = 'global' | 'studio' | 'shots'

export interface Shortcut {
  /** key combo, or a mouse gesture written out */
  keys: string
  desc: string
}

export interface ShortcutGroup {
  title: string
  scope: ShortcutScope
  items: Shortcut[]
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'App',
    scope: 'global',
    items: [
      { keys: 'Alt+1', desc: 'Switch to 3D Studio' },
      { keys: 'Alt+2', desc: 'Switch to Shots' },
      { keys: 'Ctrl+Z', desc: 'Undo' },
      { keys: 'Ctrl+Shift+Z / Ctrl+Y', desc: 'Redo' },
      { keys: 'E', desc: 'Export dialog' },
      { keys: 'Shift + /', desc: 'Open / close this shortcut guide' },
      { keys: 'Esc', desc: 'Close dialog, else clear selection' },
      { keys: '[', desc: 'Toggle the left tool panel' },
      { keys: ']', desc: 'Toggle the inspector panel' },
      { keys: '\\', desc: 'Expand / collapse the timeline' },
      { keys: 'Shift+D', desc: 'Toggle dark / light theme' },
    ],
  },
  {
    title: 'Project · Studio',
    scope: 'studio',
    items: [
      { keys: 'Alt+N', desc: 'New project' },
      { keys: 'Ctrl+O', desc: 'Open a .mockup.json project' },
      { keys: 'Ctrl+S', desc: 'Save project to a file' },
      { keys: 'T', desc: 'Templates' },
      { keys: 'Ctrl+V', desc: 'Paste a screenshot into the selected device' },
    ],
  },
  {
    title: 'Playback · Studio',
    scope: 'studio',
    items: [
      { keys: 'Space / K', desc: 'Play / pause' },
      { keys: '← / →', desc: 'Step one frame (with nothing selected)' },
      { keys: 'Shift+← / →', desc: 'Step ten frames' },
      { keys: 'Home / End', desc: 'Jump to start / end' },
      { keys: 'L', desc: 'Toggle loop' },
    ],
  },
  {
    title: 'Keyframes · Studio',
    scope: 'studio',
    items: [
      { keys: 'I', desc: 'Add keyframes for all camera properties' },
      { keys: 'Ctrl+A', desc: 'Select every keyframe' },
      { keys: '← / →', desc: 'Nudge selected keyframes one frame' },
      { keys: 'Shift+← / →', desc: 'Nudge selected keyframes ten frames' },
      { keys: 'Delete / Backspace', desc: 'Delete selection (keyframe, overlay, device)' },
      { keys: 'Ctrl+L', desc: 'Loopify — make the last frame match the first' },
      { keys: 'Drag on a lane', desc: 'Box-select keyframes' },
      { keys: 'Shift+drag', desc: 'Add to the selection' },
      { keys: 'Alt (while dragging)', desc: 'Disable snapping' },
      { keys: 'Double-click a lane', desc: 'Add a keyframe there' },
      { keys: 'Double-click a diamond', desc: 'Delete that keyframe' },
    ],
  },
  {
    title: 'Canvas · Studio',
    scope: 'studio',
    items: [
      { keys: 'Drag', desc: 'Orbit the camera' },
      { keys: 'Right-drag', desc: 'Pan' },
      { keys: 'Scroll', desc: 'Zoom' },
      { keys: 'F', desc: 'Frame the devices — recentre and fit, keeping the angle' },
      { keys: 'G', desc: 'Move gizmo on the selected device (press again to hide)' },
      { keys: 'R', desc: 'Rotate gizmo' },
      { keys: 'S', desc: 'Scale gizmo' },
    ],
  },
  {
    title: 'Shots',
    scope: 'shots',
    items: [
      { keys: '1 … 5', desc: 'Select that screen' },
      { keys: 'U', desc: 'Upload a screenshot' },
      { keys: 'R', desc: 'Randomize the background' },
      { keys: 'M', desc: 'Apply a Magic background from the image colors' },
      { keys: '← ↑ → ↓', desc: 'Nudge the shot (Shift for bigger steps)' },
      { keys: '+ / −', desc: 'Scale the shot up / down' },
      { keys: ', / .', desc: 'Rotate 1° left / right' },
      { keys: 'Delete', desc: 'Remove the selected screen' },
    ],
  },
]
