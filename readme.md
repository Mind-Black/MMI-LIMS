# MMI-LIMS (Laboratory Information Management System)

A comprehensive Laboratory Information Management System built with React, Vite, Tailwind CSS, and Supabase. This application helps manage laboratory resources, bookings, users, and analytics.

## Features

- **Authentication**: Secure user authentication and session management using Supabase Auth.
- **Dashboard**: Centralized hub for quick access to key metrics and recent activities.
- **Booking Management**: 
  - Interactive calendar for viewing and managing bookings.
  - Create, update, and delete bookings.
  - Conflict detection and resolution.
- **Tool Management**: Inventory system for laboratory tools and equipment.
- **User Management**: Administration interface for managing user roles and permissions.
- **Analytics**: Visual insights into tool usage and booking trends.
- **Responsive Design**: Optimized for various screen sizes using Tailwind CSS.

## Tech Stack

- **Frontend Framework**: [React](https://react.dev/)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **Backend & Database**: [Supabase](https://supabase.com/)
- **Icons**: [Lucide React](https://lucide.dev/)

## Prerequisites

Before you begin, ensure you have the following installed:
- [Node.js](https://nodejs.org/) (v16 or higher)
- [npm](https://www.npmjs.com/) (usually comes with Node.js)

## Installation

1.  **Clone the repository**
    ```bash
    git clone <repository-url>
    cd MMI-LIMS
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Environment Setup**
    Create a `.env` file in the root directory and add your Supabase credentials:
    ```env
    VITE_SUPABASE_URL=your_supabase_url
    VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
    ```

4.  **Run the development server**
    ```bash
    npm run dev
    ```

## Scripts

- `npm run dev`: Starts the development server.
- `npm run build`: Builds the app for production.
- `npm run lint`: Runs ESLint to check for code quality issues.
- `npm run preview`: Locally preview the production build.

## Project Structure

```
src/
├── assets/         # Static assets (images, etc.)
├── components/     # Reusable UI components
├── context/        # React Context providers (Theme, Toast)
├── hooks/          # Custom React hooks
├── utils/          # Utility functions
├── App.jsx         # Main application component
├── main.jsx        # Entry point
└── supabaseClient.js # Supabase client configuration
```
