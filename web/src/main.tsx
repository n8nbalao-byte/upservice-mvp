import { createRoot } from 'react-dom/client';
import App from './App';
import Instalar from './pages/Instalar';
import { applyStoredTheme } from './lib/theme';
import './lib/install';
import './styles.css';

applyStoredTheme();

createRoot(document.getElementById('root')!).render(location.pathname === '/instalar' ? <Instalar /> : <App />);
