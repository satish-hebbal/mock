/**
 * The one place shortcuts are described. `App.tsx` implements them and this
 * catalog documents them, so the guide can never list a key we don't handle
 * (or miss one we do) as long as both sides are edited together.
 */

export type ShortcutScope = 'global' | 'studio' | 'shots' | 'draw'

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
      { keys: 'Alt+3', desc: 'Switch to Draw' },
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
      { keys: 'Ctrl+L', desc: 'Loopify: make the last frame match the first' },
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
      { keys: 'F', desc: 'Frame the devices: recentre and fit, keeping the angle' },
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
  {
    title: 'Draw · tools',
    scope: 'draw',
    items: [
      { keys: '1 … 0', desc: 'Select, rectangle, diamond, ellipse, arrow, line, draw, text, image, eraser' },
      { keys: 'V / R / D / O', desc: 'Selection, rectangle, diamond, ellipse' },
      { keys: 'A / L / X / T', desc: 'Arrow, line, freehand, text' },
      { keys: 'E', desc: 'Eraser (Export moves to Ctrl+Shift+E on this canvas)' },
      { keys: 'H / Space', desc: 'Pan the canvas' },
      { keys: 'P / N / F', desc: 'Pencil, pen, fineliner' },
      { keys: 'M / G / B / K', desc: 'Marker, highlighter, brush, fountain pen' },
      { keys: '[ / ]', desc: 'Nib smaller / bigger' },
    ],
  },
  {
    title: 'Draw · canvas',
    scope: 'draw',
    items: [
      { keys: 'Ctrl+Z', desc: 'Undo' },
      { keys: 'Ctrl+Shift+Z / Ctrl+Y', desc: 'Redo' },
      { keys: 'Ctrl+A', desc: 'Select everything' },
      { keys: 'Ctrl+D', desc: 'Duplicate the selection' },
      { keys: 'Ctrl+C / Ctrl+X / Ctrl+V', desc: 'Copy, cut and paste, across tabs too' },
      { keys: 'Delete', desc: 'Delete the selection' },
      { keys: 'Ctrl+Shift+E', desc: 'Export the drawing' },
      { keys: 'Ctrl + wheel', desc: 'Zoom about the pointer' },
      { keys: 'Ctrl+0', desc: 'Reset to 100%' },
      { keys: 'Shift+1', desc: 'Fit the drawing to the window' },
      { keys: 'Shift (while drawing)', desc: 'Lock to the nearest of eight directions' },
      { keys: 'Shift (while dragging)', desc: 'Constrain to one axis' },
      { keys: 'Alt (while drawing)', desc: 'Draw a shape from its centre' },
      { keys: 'Alt (while dragging)', desc: 'Drag out a copy and leave the original' },
      { keys: 'Double-click', desc: 'Start a label, or edit the one under the pointer' },
      { keys: "'", desc: 'Show / hide the grid' },
    ],
  },
]
