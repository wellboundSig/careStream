import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ClerkProvider } from '@clerk/react';

import './index.css';
import { applyFont } from './utils/fontUtility.js';
import { ThemeContextProvider } from './utils/ThemeContext.jsx';
import { UserPreferencesProvider } from './context/UserPreferencesContext.jsx';
import ThemeProvider from './utils/ThemeProvider.jsx';
import { PatientDrawerProvider } from './context/PatientDrawerContext.jsx';
import App from './App.jsx';

applyFont();

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!publishableKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env');
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ClerkProvider afterSignOutUrl="/sign-in">
      <BrowserRouter>
        <ThemeContextProvider>
          <ThemeProvider>
            <UserPreferencesProvider>
              <PatientDrawerProvider>
                <App />
              </PatientDrawerProvider>
            </UserPreferencesProvider>
          </ThemeProvider>
        </ThemeContextProvider>
      </BrowserRouter>
    </ClerkProvider>
  </StrictMode>
);
