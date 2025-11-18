Project structure and recommended layered organization

Goal: make the codebase easier to navigate by separating concerns into layers (UI, layout, data/services, hooks, pages, utils).

Suggested structure (small, incremental refactor approach):

src/
  assets/                # images, icons, fonts
  components/            # dumb/reusable UI components (buttons, badges, cards)
    ui/                  # small primitives (Button, Badge, Icon, Input)
    layout/              # layout components (AdminLayout, Topbar, Sidebar)
    auth/                # auth-related components (LoginForm, LogoutButton)
  hooks/                 # reusable hooks that encapsulate data fetching or logic (useAuth, useRecentTransactions)
  pages/                 # route-level pages (AdminDashboard, ProductManagement, ...)
  services/              # data/service layer (firebase wrappers, api clients)
  context/               # React context providers (AuthContext)
  utils/                 # small utilities and formatters (formatTimestamp)

What I changed in this PR:
- Added `src/hooks/useRecentTransactions.js` to separate data fetching logic from the UI layer.
- Refactored `src/pages/AdminDashboard.jsx` to use the hook instead of in-component fetching.
- Improved `src/components/Layout/AdminLayout.jsx` visuals (no behavior changes).
- Added this `STRUCTURE.md` to document the recommended layering.

Next steps (suggested incremental tasks):
- Move shared utilities like `formatTimestamp` into `src/utils/format.js` and import where used.
- Create `src/services/firebase.js` that wraps firebase config and exports typed helpers.
- Extract repeated UI primitives into `src/components/ui/` (Button, Input, MetricCard) so pages remain thin.
- Add unit or integration tests for the hooks in `src/hooks/__tests__/`.
- Optional: add barrel exports (index.js) for cleaner imports.

Notes:
- I kept changes minimal and non-breaking: imports/exports were updated only where necessary.
- If you'd like, I can continue by extracting `MetricCard` into `src/components/ui/MetricCard.jsx` and adding a small Storybook or test harness.
