import { createRoot } from 'react-dom/client';
import App from './App';
import { applyStoredTheme } from './lib/theme';
import './styles.css';

applyStoredTheme();

createRoot(document.getElementById('root')!).render(<App />);
