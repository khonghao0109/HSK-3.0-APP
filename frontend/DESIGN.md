# HSK Content Workbench — Design Brief V1

## Product and audience

The interface is an operational workbench for HSK content administrators. Its
single job in V1 is to let an authenticated administrator inspect
`LessonExercise` inventory and revision details quickly, without implying that
authoring, publishing, imports, or media operations are available in the UI.

## Information architecture

```text
Login
└── Admin shell
    ├── Exercises
    │   ├── Server-filtered, paginated inventory
    │   └── Exercise detail and revision history
    └── Media — Coming later, non-interactive

Forbidden and session-expired states sit outside the protected admin shell.
```

The URL is the source of truth for page, lesson, topic, type, and status. The
desktop table becomes a labelled record list on narrow screens rather than a
horizontally scrolling table.

## Visual direction

**Concept:** HSK Content Workbench. The visual language borrows from ink,
annotated study material, and editorial proofing without using ornamental
Chinese clichés.

- **Signature:** a restrained CJK serif `汉` mark beside the HSK 3.0 wordmark,
  paired with mono/tabular metadata for content IDs and versions.
- **Palette:** ink navy for navigation, jade for active/focus states, rice-paper
  neutral for the canvas, white paper for work surfaces, and amber/red only for
  named warning/error states.
- **Typography:** `Noto Serif SC`/`Songti SC` fallbacks for the small brand mark;
  `Noto Sans`/system UI for operational copy; system monospace for identifiers
  and canonical JSON.
- **Density:** compact enough for content operations while preserving 44px
  interactive targets and a 4/8px spacing rhythm.
- **Shape:** modest 6–12px radii, hairline borders, and one low elevation level;
  no decorative gradients or card mosaics.
- **Motion:** 150–200ms state transitions and a quiet loading skeleton. All
  non-essential motion is disabled by `prefers-reduced-motion`.

## Token architecture

Tokens follow three layers in `src/app/styles.css`:

1. **Primitive:** raw ink, jade, rice, neutral, spacing, type, radius, shadow,
   and duration values.
2. **Semantic:** canvas, surface, text, border, action, status, focus, and layout
   meanings.
3. **Component:** button, input, navigation, table, badge, panel, and skeleton
   aliases.

Components consume semantic or component tokens, never raw hex values.

## Accessibility and responsive contract

- WCAG AA foreground/background pairs and a visible 3px focus indicator.
- Skip link, semantic header/navigation/main landmarks, sequential headings,
  explicit form labels, inline errors, and status text in addition to color.
- Keyboard-only login, filters, pagination, navigation, detail, and logout.
- No hidden content behind sticky chrome and no horizontal page overflow.
- Verified target widths: 390px, 768px, 1024px, and 1440px.

## Explicit exclusions

- No Exercise create/review/publish/archive/import controls.
- No working Media link, upload, or library.
- No dashboard analytics or marketing hero.
- No dark theme in V1.
