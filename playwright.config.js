import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./tests/browser',use:{baseURL:'http://127.0.0.1:4173/MMI-LIMS/'},webServer:{command:'npm run dev -- --host 127.0.0.1 --port 4173',url:'http://127.0.0.1:4173/MMI-LIMS/',reuseExistingServer:false,env:{VITE_SUPABASE_URL:'http://localhost:54321',VITE_SUPABASE_ANON_KEY:'browser-test-key'}}});
