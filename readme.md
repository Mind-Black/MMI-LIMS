# MMI-LIMS (Laboratory Information Management System)

A secure, high-performance Laboratory Information Management System built with React 19, Vite, Tailwind CSS, and Supabase. This application manages laboratory resources, bookings, user authorizations, and calendar synchronization.

## Features

- **Authentication & Authorization**:
  - Secure authentication via Supabase Auth.
  - Fail-closed account state handling (Pending Approval / Active / Admin).
  - Server-enforced role-based access control and privilege escalation prevention.
- **Booking Management**:
  - Drag-and-drop interactive weekly calendar anchored in lab timezone (`Europe/Vilnius`).
  - Authoritative database-level double-booking prevention using PostgreSQL range exclusion constraints (`tstzrange` + `btree_gist`).
  - Atomic group booking updates preventing partial legacy slot deletion.
  - Idempotent normalization and preservation of legacy booking reservations.
  - Safe bounds clamping preventing invalid date crashes on drag outside day bounds.
  - Unlocked booking access for license-free equipment (`license_req = false`).
- **Calendar Feeds (ICS)**:
  - Private bearer-token calendar subscription feed.
  - Token hashes stored in private tables; tokens excluded from user directory queries.
  - RFC 5545 compliant calendar export with line folding, character escaping, and injection prevention.
- **Secure Email Notifications**:
  - Bounded, server-derived cancellation and messaging dispatch via Resend Edge Functions.
  - Database-level recipient filtering preventing unbounded fan-out.
- **Performance Optimizations**:
  - Paginated queries with windowed date ranges and race-safe refreshes.
  - Hidden-tab polling suspension via Page Visibility API.
  - Code splitting of authenticated screens and booking UI; responsive equipment thumbnails.

## Tech Stack

- **Frontend**: [React 19](https://react.dev/), [Vite](https://vitejs.dev/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Backend & Database**: [Supabase](https://supabase.com/) (PostgreSQL 15+, Row Level Security, Edge Functions)

## Prerequisites

- [Node.js](https://nodejs.org/) (`^20.19.0` or `>=22.12.0`)
- [npm](https://www.npmjs.com/) (v10 or higher)

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd MMI-LIMS
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Environment Setup**
   Create a `.env` file in the root directory:
   ```env
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

4. **Database Migrations**
   Apply migrations in `supabase/migrations/`:
   - `20231201000000_initial_schema.sql`: Full baseline schema for fresh deployments.
   - `20260927000001_security_and_constraints.sql`: Forward migration for upgrading existing deployments.

5. **Run the development server**
   ```bash
   npm run dev
   ```

6. **Password recovery**
   Add the deployed site URL (including `/MMI-LIMS/` on GitHub Pages) to Supabase Auth's allowed redirect URLs. The recovery email returns users to that route to set a new password.

## Equipment photos

Put original photos in `src/assets/tool_images/` using the equipment ID as the filename. Install Python Pillow and run `python scripts/optimize-tool-images.py` after changing photos. Commit the generated `src/assets/tool_thumbnails/` files with the source image; the site serves these small 1×/2× variants when details expand.

## Available Scripts

- `npm run dev`: Starts the Vite development server (bound to `localhost`).
- `npm run build`: Bundles the application for production.
- `npm run lint`: Runs ESLint across all JavaScript/JSX files.
- `npm test`: Runs the automated test suite (`node:test`) and booking logic assertions.
- `npm run preview`: Previews the production build locally.

## Project Structure

```
├── .github/workflows/ # CI/CD deployment workflow with lint and test gates
├── src/
│   ├── assets/        # Static assets and equipment images
│   ├── components/    # Reusable UI components (Dashboard, BookingModal, etc.)
│   ├── context/       # Theme and Toast Context providers and hooks
│   ├── hooks/         # Custom interaction hooks (useBookingInteraction)
│   ├── utils/         # Core booking, layout, collision, and timezone utilities
│   ├── App.jsx        # Main application component
│   └── supabaseClient.js # Supabase client configuration
├── supabase/
│   ├── config.toml    # Edge Function JWT configuration
│   ├── functions/     # Supabase Edge Functions (serve-ics, send-email, notify-cancellation)
│   └── migrations/    # Versioned database migrations
└── tests/             # Unit and integration test suites
```
