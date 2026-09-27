import { useContext } from 'react';
import { ThemeContext } from './ThemeContextCore';

export const useTheme = () => useContext(ThemeContext);
